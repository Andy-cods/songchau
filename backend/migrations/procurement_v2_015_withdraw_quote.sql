-- ============================================================
-- procurement_v2_015_withdraw_quote.sql  (Đợt 11 #16-P2 — Thu hồi báo giá)
-- NCC rút báo giá đã gửi khi đợt còn 'published' + còn hạn + chưa award.
-- ADDITIVE, IDEMPOTENT, re-runnable via: docker cp ... && psql -f.
-- Author: Thang — 2026-06-27
-- DEPLOY: docker cp + psql -f; restart sc-api + sc-worker + sc-scheduler
--         (xoá __pycache__ trước khi restart — bài học Đợt 9 Wave C).
--
-- PRE-EXISTING FACTS (verified by reading migrations):
--   * vendor_quotes.status is TEXT + CHECK (NOT an enum) — original inline
--     constraint from vendor_portal_001.sql is
--       CHECK (status IN ('draft','submitted','awarded','rejected'))
--     No later migration widened the STATUS check (only the CURRENCY check was
--     touched in procurement_v2_001 / _007). So widening here is a plain
--     drop+re-add of a TEXT CHECK — fully transactional, NO `ALTER TYPE`.
--   * KISS: every comparison query (matrix / award / decision-sheet) already
--     filters `vq.status = 'submitted'`, so a quote flipped to 'withdrawn'
--     drops out of EVERY comparison automatically — no query is changed.
--   * Re-quote after withdraw runs through the existing submit UPSERT keyed by
--     UNIQUE(batch_id,vendor_id,round_number): the withdrawn row is updated back
--     to status='submitted' in place — no special-case code.
-- ============================================================

BEGIN;

-- ─── 1. Audit columns (additive) ───
ALTER TABLE vendor_quotes
    ADD COLUMN IF NOT EXISTS withdrawn_at    TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS withdraw_reason TEXT;

-- ─── 2. Widen vendor_quotes.status CHECK → add 'withdrawn' ───
-- Discover the current status CHECK without hardcoding its name (it is the
-- inline vendor_quotes_status_check today, but discover defensively), drop it,
-- and re-add the widened 5-set. Guarded so re-running is a no-op.
DO $$
DECLARE
    con_name TEXT;
BEGIN
    -- Find ANY status-bearing CHECK on vendor_quotes (exclude the currency CHECK).
    SELECT conname INTO con_name
      FROM pg_constraint
     WHERE conrelid = 'vendor_quotes'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%status%'
       AND pg_get_constraintdef(oid) NOT LIKE '%currency%';

    IF con_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE vendor_quotes DROP CONSTRAINT %I', con_name);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'vendor_quotes_status_check'
    ) THEN
        ALTER TABLE vendor_quotes
            ADD CONSTRAINT vendor_quotes_status_check
            CHECK (status IN ('draft','submitted','awarded','rejected','withdrawn'));
    END IF;
END
$$;

-- ─── 3. Partial index — surface withdrawn rows cheaply (audit / admin) ───
CREATE INDEX IF NOT EXISTS idx_vq_status_withdrawn
    ON vendor_quotes(batch_id) WHERE status = 'withdrawn';

COMMIT;

-- POSTCHECK (run manually):
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conrelid='vendor_quotes'::regclass AND contype='c';
--   -- expect a status CHECK including 'withdrawn'
--   SELECT status, count(*) FROM vendor_quotes GROUP BY status;
