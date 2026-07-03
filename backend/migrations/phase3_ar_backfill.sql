-- ============================================================
-- phase3_ar_backfill.sql
--
-- PHASE 3 (T4 / File 2) — IDEMPOTENT backfill of chain_code + công nợ (AR)
-- for sourcing_orders that were already payment-approved BEFORE the auto-AR
-- hook (payment_requests.py, gated by PHASE3_AUTO_AR_ENABLED) was switched on.
--
-- For every sourcing order whose status is 'payment_approved' (or a LATER
-- lifecycle stage: shipped / delivered) that is missing a chain_code and/or an
-- accounts_receivable row AND has a non-null customer_id, this:
--   (1) mints a revenue_chain row + chain_code if absent, and
--   (2) creates ONE accounts_receivable row (status='pending') if absent,
-- then back-links sourcing_orders.chain_code / .accounts_receivable_id.
--
-- ⚠️ STAGED MIGRATION — IDEMPOTENT + RE-RUNNABLE + NON-DESTRUCTIVE.
--    Every write is ON CONFLICT DO NOTHING / guarded by `... IS NULL`, so
--    running it twice is a safe no-op. No row is updated in place beyond
--    filling NULL chain_code / accounts_receivable_id back-references. It
--    does NOT enable any flag, drop anything, or alter a schema.
--
-- DECISIONS (owner Thang):
--   * customer_id NULL  → SKIP (accounts_receivable.customer_id is NOT NULL,
--     so an AR is impossible). Such orders are NOT backfilled here and are
--     reported by the trailing PRECHECK count. A later backfill attaches the
--     AR once a customer is linked. Approval was never blocked.
--   * status='pending'  → the ONLY valid 'awaiting' value of the payment_status
--     enum {pending, partial_paid, paid, overdue, disputed}. 'unpaid' / 'partial'
--     are INVALID and 22P02-error.
--
-- DEPENDENCIES — run AFTER both of these:
--   * phase3_chain_activation.sql  (adds sourcing_orders.chain_code /
--     .accounts_receivable_id, accounts_receivable.sourcing_order_id /
--     .chain_code, and the partial unique index uq_ar_sourcing_order).
--   * phase3_ar_sequence.sql       (creates revenue_chain_code_seq, which the
--     chain-code mint below draws via nextval).
--
-- LOAD-BEARING:
--   * Sequence name revenue_chain_code_seq MUST match phase3_ar_sequence.sql
--     and chain_service.gen_chain_code (byte-identical).
--   * ON CONFLICT (sourcing_order_id) WHERE sourcing_order_id IS NOT NULL
--     MUST repeat the EXACT predicate of uq_ar_sourcing_order, or Postgres
--     won't match the partial index and the upsert errors instead of no-op-ing.
--
-- Author: Phase 3 build (T4) — 2026-06-17
-- Run on VPS: psql -U scadmin -d songchau_erp -f phase3_ar_backfill.sql
-- ============================================================

-- ============================================================
-- PRECHECK (run manually BEFORE the backfill, read-only — NOT part of the tx).
-- Shows what the backfill WILL touch and what it WILL skip (customerless).
--
--   -- Orders eligible for backfill (have a customer, missing chain or AR):
--   SELECT count(*) AS will_backfill
--     FROM sourcing_orders so
--    WHERE so.status IN ('payment_approved','shipped','delivered')
--      AND so.deleted_at IS NULL
--      AND so.customer_id IS NOT NULL
--      AND (
--            so.chain_code IS NULL
--         OR NOT EXISTS (SELECT 1 FROM accounts_receivable ar
--                         WHERE ar.sourcing_order_id = so.id)
--          );
--
--   -- Customerless orders that will be SKIPPED (flagged, NOT backfilled):
--   SELECT count(*) AS skipped_no_customer
--     FROM sourcing_orders so
--    WHERE so.status IN ('payment_approved','shipped','delivered')
--      AND so.deleted_at IS NULL
--      AND so.customer_id IS NULL
--      AND (
--            so.chain_code IS NULL
--         OR NOT EXISTS (SELECT 1 FROM accounts_receivable ar
--                         WHERE ar.sourcing_order_id = so.id)
--          );
-- ============================================================

BEGIN;

-- Resolve a single fallback admin uuid for created_by on rows whose creator
-- can't be derived (accounts_receivable.created_by + revenue_chain.created_by).
-- Mirrors chain_service.ensure_ar_for_order's admin fallback.
-- Held in a temp table so we read it once (a plain psql \set isn't available
-- inside a -f migration body).
CREATE TEMP TABLE _phase3_backfill_admin ON COMMIT DROP AS
SELECT id AS admin_id
  FROM users
 WHERE role::text = 'admin'
 ORDER BY created_at NULLS LAST, id
 LIMIT 1;

-- ─────────────────────────────────────────────────────────────
-- 1) MINT chain_code for eligible orders that lack one.
--
--    Per row: draw nextval('revenue_chain_code_seq') ONCE (CTE materialized),
--    format RC-YYYYMM-NNNNNN, INSERT the revenue_chain row (stage 'so') and
--    stamp the code back onto the order — all guarded so a re-run is a no-op.
-- ─────────────────────────────────────────────────────────────
WITH eligible AS (
    SELECT so.id,
           so.total_value_vnd,
           -- created_by resolved to the admin-uuid fallback below (sourcing_orders
           -- only carries a BIGINT created_by_id, not the AR/chain UUID).
           ('RC-' || to_char(NOW(), 'YYYYMM') || '-'
                  || lpad(nextval('revenue_chain_code_seq')::text, 6, '0')) AS new_code
      FROM sourcing_orders so
     WHERE so.status IN ('payment_approved','shipped','delivered')
       AND so.deleted_at IS NULL
       AND so.customer_id IS NOT NULL
       AND so.chain_code IS NULL
),
ins_chain AS (
    INSERT INTO revenue_chain
        (chain_code, so_status, current_stage, revenue_vnd, created_by)
    SELECT e.new_code, 'order', 'so', e.total_value_vnd,
           (SELECT admin_id FROM _phase3_backfill_admin)
      FROM eligible e
    ON CONFLICT (chain_code) DO NOTHING
    RETURNING chain_code
)
UPDATE sourcing_orders so
   SET chain_code = e.new_code
  FROM eligible e
 WHERE so.id = e.id
   AND so.chain_code IS NULL;   -- re-run guard: only stamp once

-- ─────────────────────────────────────────────────────────────
-- 2) CREATE one accounts_receivable row per eligible order that lacks one.
--
--    NOT NULL cols all supplied: customer_id, invoice_date, due_date, amount,
--    created_by. currency cast to currency_code via a guarded CASE so a
--    sourcing_orders.currency string outside the enum {VND,USD,RMB,KRW,JPY,EUR}
--    (e.g. 'CNY') falls back to 'VND' instead of 22P02-erroring the whole tx.
--    due_date = invoice_date + parsed-net-days(payment_terms), defaulting to 30
--    and clamped to [0,365]. status='pending' (valid payment_status).
--
--    ON CONFLICT (sourcing_order_id) WHERE sourcing_order_id IS NOT NULL
--    matches uq_ar_sourcing_order EXACTLY → idempotent no-op on re-run.
-- ─────────────────────────────────────────────────────────────
INSERT INTO accounts_receivable
    (customer_id, sourcing_order_id, chain_code,
     invoice_date, due_date, amount, currency, paid_amount, status,
     notes, created_by)
SELECT
    so.customer_id,
    so.id,
    so.chain_code,
    COALESCE(so.order_date, CURRENT_DATE)                              AS invoice_date,
    COALESCE(so.order_date, CURRENT_DATE)
        + (
            -- parse first 1-3 digit run from free-text payment_terms;
            -- clamp [0,365]; default 30 when absent/zero/unparseable.
            CASE
                WHEN (substring(so.payment_terms FROM '\d{1,3}'))::int IS NULL
                     THEN 30
                WHEN (substring(so.payment_terms FROM '\d{1,3}'))::int = 0
                     THEN 30
                ELSE LEAST(GREATEST((substring(so.payment_terms FROM '\d{1,3}'))::int, 0), 365)
            END
          ) * INTERVAL '1 day'                                         AS due_date,
    COALESCE(so.total_value_vnd, 0)                                    AS amount,
    (CASE
        -- Map sourcing_orders.currency (free TEXT) onto the currency_code enum
        -- {VND,USD,RMB,KRW,JPY,EUR}; anything else (incl. NULL or 'CNY') → VND,
        -- so an out-of-enum value can never 22P02-abort the backfill.
        WHEN upper(COALESCE(so.currency, 'VND')) IN ('VND','USD','RMB','KRW','JPY','EUR')
             THEN upper(COALESCE(so.currency, 'VND'))
        ELSE 'VND'
     END)::currency_code                                              AS currency,
    0                                                                  AS paid_amount,
    'pending'::payment_status                                          AS status,
    ('Backfill AR từ đơn ' || so.order_number)                        AS notes,
    (SELECT admin_id FROM _phase3_backfill_admin)                      AS created_by
  FROM sourcing_orders so
 WHERE so.status IN ('payment_approved','shipped','delivered')
   AND so.deleted_at IS NULL
   AND so.customer_id IS NOT NULL
   AND NOT EXISTS (
         SELECT 1 FROM accounts_receivable ar
          WHERE ar.sourcing_order_id = so.id
       )
ON CONFLICT (sourcing_order_id) WHERE sourcing_order_id IS NOT NULL
DO NOTHING;

-- ─────────────────────────────────────────────────────────────
-- 3) BACK-LINK sourcing_orders.accounts_receivable_id for any eligible order
--    whose AR now exists but whose back-reference is still NULL (covers both
--    rows we just inserted and any AR created earlier by the live hook).
-- ─────────────────────────────────────────────────────────────
UPDATE sourcing_orders so
   SET accounts_receivable_id = ar.id
  FROM accounts_receivable ar
 WHERE ar.sourcing_order_id = so.id
   AND so.accounts_receivable_id IS NULL;

COMMIT;

-- ============================================================
-- POSTCHECK (run manually AFTER, read-only — NOT part of the migration):
--
--   -- Should be 0: payment_approved+ orders WITH a customer still missing AR.
--   SELECT count(*) AS still_missing_ar
--     FROM sourcing_orders so
--    WHERE so.status IN ('payment_approved','shipped','delivered')
--      AND so.deleted_at IS NULL
--      AND so.customer_id IS NOT NULL
--      AND NOT EXISTS (SELECT 1 FROM accounts_receivable ar
--                       WHERE ar.sourcing_order_id = so.id);
--
--   -- Flagged gap (expected, NON-zero ok): customerless approved orders with
--   -- no AR — these were SKIPPED by design and await a customer link.
--   SELECT count(*) AS skipped_no_customer
--     FROM sourcing_orders so
--    WHERE so.status IN ('payment_approved','shipped','delivered')
--      AND so.deleted_at IS NULL
--      AND so.customer_id IS NULL;
-- ============================================================
