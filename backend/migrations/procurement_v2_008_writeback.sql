-- ============================================================
-- procurement_v2_008_writeback.sql  (P1 — Commercial bidding:
--   write awarded prices back into the sourcing supplier-price library)
-- ADDITIVE, IDEMPOTENT, re-runnable via: docker cp ... && psql -f.
-- Author: Thang — 2026-06-22
-- DEPLOY: docker cp + psql -f; restart sc-api + sc-worker + sc-scheduler.
--
-- PRE-EXISTING FACTS (verified by reading migrations):
--   * procurement_awards (procurement_v2_002_award.sql) already has a
--     currency TEXT NOT NULL DEFAULT 'VND' column but NO currency CHECK.
--     We add the 6-set CHECK so write-back prices match
--     sourcing_supplier_prices.chk_ssp_currency.
--   * sourcing_supplier_prices.id is the target of sourcing_supplier_price_id
--     (loose BIGINT, no FK — the procurement schema is BIGINT, and we keep the
--     reference loose to avoid a hard cross-module dependency).
-- ============================================================

BEGIN;

-- ─── 1. procurement_awards — write-back provenance ───
ALTER TABLE procurement_awards
    ADD COLUMN IF NOT EXISTS written_back_to_sourcing   BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS written_back_at            TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS written_back_by            UUID REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS sourcing_supplier_price_id BIGINT;  -- loose link to sourcing_supplier_prices(id)

UPDATE procurement_awards
   SET written_back_to_sourcing = false
 WHERE written_back_to_sourcing IS NULL;

-- ─── 2. Add the 6-set currency CHECK IF a currency column exists and lacks one ───
-- Guarded: only acts when procurement_awards.currency exists AND no currency
-- CHECK is currently present. Re-run = no-op.
DO $$
DECLARE
    has_currency BOOLEAN;
    con_name     TEXT;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_name = 'procurement_awards' AND column_name = 'currency'
    ) INTO has_currency;

    IF has_currency THEN
        SELECT conname INTO con_name
          FROM pg_constraint
         WHERE conrelid = 'procurement_awards'::regclass
           AND contype = 'c'
           AND pg_get_constraintdef(oid) LIKE '%currency%';

        IF con_name IS NULL THEN
            ALTER TABLE procurement_awards
                ADD CONSTRAINT procurement_awards_currency_check
                CHECK (currency IN ('VND','JPY','USD','KRW','RMB','EUR'));
        END IF;
    END IF;
END
$$;

-- ─── 3. Partial index — awards still pending write-back (the sweep target) ───
CREATE INDEX IF NOT EXISTS idx_pa_pending_writeback
    ON procurement_awards(id)
    WHERE written_back_to_sourcing = false;

COMMIT;

-- ─── VERIFICATION ───
SELECT 'awards_currency_constraint' AS check, conname, pg_get_constraintdef(oid) AS def
  FROM pg_constraint
 WHERE conrelid = 'procurement_awards'::regclass
   AND contype = 'c'
   AND pg_get_constraintdef(oid) LIKE '%currency%';
SELECT 'awards_pending_writeback' AS check, count(*) AS n
  FROM procurement_awards WHERE written_back_to_sourcing = false;
SELECT 'awards_total' AS check, count(*) AS n FROM procurement_awards;
