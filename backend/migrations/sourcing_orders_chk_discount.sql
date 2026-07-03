-- ============================================================
-- DATA-4: prevent discount > subtotal on sourcing_orders
-- Adds CHECK so total_value_vnd can never be driven negative by
-- an over-large discount, even if the API validator is bypassed
-- (e.g. direct SQL, ETL, future endpoint that forgets to validate).
--
-- Pairs with: app/api/v1/sourcing.py @model_validator on
--   OrderCreatePayload / OrderUpdatePayload / OrderCalcPayload
--
-- Idempotent: safe to re-run.
-- Date: 2026-06-03 (Thang)
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- Pre-flight: surface any pre-existing violations so they can be
-- fixed before the constraint is enforced. If rows exist that
-- already violate the rule, ADD CONSTRAINT will fail loudly.
-- ------------------------------------------------------------
DO $$
DECLARE
    bad_count BIGINT;
BEGIN
    SELECT COUNT(*) INTO bad_count
      FROM sourcing_orders
     WHERE discount_vnd IS NOT NULL
       AND subtotal_vnd IS NOT NULL
       AND discount_vnd > subtotal_vnd;

    IF bad_count > 0 THEN
        RAISE WARNING
            'sourcing_orders has % rows where discount_vnd > subtotal_vnd. '
            'Constraint chk_so_discount_le_subtotal will REJECT these. '
            'Fix them before re-running this migration.',
            bad_count;
    END IF;
END$$;

-- ------------------------------------------------------------
-- Drop-if-exists then add — keeps the migration idempotent and
-- lets us tweak the predicate later without manual cleanup.
-- ------------------------------------------------------------
ALTER TABLE sourcing_orders
    DROP CONSTRAINT IF EXISTS chk_so_discount_le_subtotal;

ALTER TABLE sourcing_orders
    ADD CONSTRAINT chk_so_discount_le_subtotal
    CHECK (
        discount_vnd IS NULL
        OR (subtotal_vnd IS NOT NULL AND discount_vnd <= subtotal_vnd)
    );

COMMIT;
