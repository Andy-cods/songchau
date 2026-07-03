-- ============================================================
-- procurement_v2_007_imv_quote_fields.sql  (P1 — Commercial bidding:
--   widen vendor-quote currency, per-line offer fields, deadlines + reminders)
-- ADDITIVE, IDEMPOTENT, re-runnable via: docker cp ... && psql -f.
-- Author: Thang — 2026-06-22
-- DEPLOY: docker cp + psql -f; restart sc-api + sc-worker + sc-scheduler.
--
-- ATOMIC CURRENCY WIDENING (3 parts — DB + API + FE):
--   (a) THIS migration widens vendor_quotes currency CHECK + adds
--       vendor_quote_items.currency to the 6-set
--       ('VND','JPY','USD','KRW','RMB','EUR') matching
--       sourcing_supplier_prices.chk_ssp_currency.
--   (b) app/api/vendor/quotes.py ALLOWED_CURRENCIES — VERIFIED already the
--       6-set ("VND","JPY","USD","KRW","RMB","EUR") at line 35. No change needed.
--   (c) FE currency picker — must offer the same 6 options (handled in FE work).
--
-- PRE-EXISTING FACTS (verified by reading migrations):
--   * vendor_quote_items already has can_do + attachment_paths (magic_link).
--     attachment_paths is JSONB and is REUSED by later phases — do NOT add a
--     singular attachment_path TEXT twin. moq is NOT yet on vendor_quote_items,
--     so ADD COLUMN IF NOT EXISTS moq is a real add (no-op on re-run).
--   * procurement_rfq_batches already has deadline_v1/v2/v3 TIMESTAMPTZ
--     (vendor_bidding_magic_link.sql). We add bid_deadline + deadline_round1/2/3
--     and backfill them from the legacy deadline_v1/v2/v3 if those exist.
--   * procurement_rfq_invitations.status CHECK only allows
--     ('invited','viewed','submitted','declined') — NOT touched here.
-- ============================================================

BEGIN;

-- ─── 1. Widen vendor_quotes currency CHECK → 6-set ───
-- Discover the current currency CHECK (vendor_quotes_currency_check from
-- procurement_v2_001) without hardcoding, drop it, re-add as *_check2.
DO $$
DECLARE
    con_name TEXT;
BEGIN
    SELECT conname INTO con_name
      FROM pg_constraint
     WHERE conrelid = 'vendor_quotes'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%currency%';

    IF con_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE vendor_quotes DROP CONSTRAINT %I', con_name);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'vendor_quotes_currency_check2'
    ) THEN
        ALTER TABLE vendor_quotes
            ADD CONSTRAINT vendor_quotes_currency_check2
            CHECK (currency IN ('VND','JPY','USD','KRW','RMB','EUR'));
    END IF;
END
$$;

-- ─── 2. vendor_quote_items — per-line offer fields ───
-- can_do + attachment_paths already exist (magic_link) → ADD IF NOT EXISTS no-op.
-- moq / offered_qty / currency are the genuine adds.
ALTER TABLE vendor_quote_items
    ADD COLUMN IF NOT EXISTS offered_qty NUMERIC,
    ADD COLUMN IF NOT EXISTS moq         TEXT,
    ADD COLUMN IF NOT EXISTS currency    TEXT;

-- Per-line currency CHECK (NULL allowed → inherits quote-level currency).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'vendor_quote_items_currency_chk'
    ) THEN
        ALTER TABLE vendor_quote_items
            ADD CONSTRAINT vendor_quote_items_currency_chk
            CHECK (currency IS NULL OR currency IN ('VND','JPY','USD','KRW','RMB','EUR'));
    END IF;
END
$$;

-- ─── 3. procurement_rfq_batches — bid deadline + per-round deadlines ───
ALTER TABLE procurement_rfq_batches
    ADD COLUMN IF NOT EXISTS bid_deadline    TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS deadline_round1 TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS deadline_round2 TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS deadline_round3 TIMESTAMPTZ;

-- Backfill from the legacy deadline_v1/v2/v3 IF those columns exist.
-- Guarded with a catalog check so this is safe even if they were never added.
DO $$
DECLARE
    has_v1 BOOLEAN;
    has_v2 BOOLEAN;
    has_v3 BOOLEAN;
BEGIN
    SELECT EXISTS (SELECT 1 FROM information_schema.columns
        WHERE table_name='procurement_rfq_batches' AND column_name='deadline_v1') INTO has_v1;
    SELECT EXISTS (SELECT 1 FROM information_schema.columns
        WHERE table_name='procurement_rfq_batches' AND column_name='deadline_v2') INTO has_v2;
    SELECT EXISTS (SELECT 1 FROM information_schema.columns
        WHERE table_name='procurement_rfq_batches' AND column_name='deadline_v3') INTO has_v3;

    IF has_v1 THEN
        EXECUTE 'UPDATE procurement_rfq_batches
                    SET deadline_round1 = COALESCE(deadline_round1, deadline_v1)
                  WHERE deadline_v1 IS NOT NULL';
    END IF;
    IF has_v2 THEN
        EXECUTE 'UPDATE procurement_rfq_batches
                    SET deadline_round2 = COALESCE(deadline_round2, deadline_v2)
                  WHERE deadline_v2 IS NOT NULL';
    END IF;
    IF has_v3 THEN
        EXECUTE 'UPDATE procurement_rfq_batches
                    SET deadline_round3 = COALESCE(deadline_round3, deadline_v3)
                  WHERE deadline_v3 IS NOT NULL';
    END IF;
END
$$;

-- bid_deadline = the LATEST defined round deadline (the active round), NOT
-- always round-1. deadline_round1/2/3 are added unconditionally above so they
-- always exist; picking the highest-round non-null avoids the multi-round
-- staleness that would mis-drive the reminder/auto-close sweep.
UPDATE procurement_rfq_batches
   SET bid_deadline = COALESCE(bid_deadline, deadline_round3, deadline_round2, deadline_round1)
 WHERE bid_deadline IS NULL
   AND (deadline_round1 IS NOT NULL OR deadline_round2 IS NOT NULL OR deadline_round3 IS NOT NULL);

-- ─── 4. procurement_rfq_invitations — reminder + missed-deadline tracking ───
-- (status CHECK is NOT touched here — only additive columns.)
ALTER TABLE procurement_rfq_invitations
    ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS missed_deadline  BOOLEAN DEFAULT false;

UPDATE procurement_rfq_invitations
   SET missed_deadline = false
 WHERE missed_deadline IS NULL;

-- ─── 5. Index — open batches by deadline (for the reminder sweep) ───
CREATE INDEX IF NOT EXISTS idx_prfq_batch_bid_deadline
    ON procurement_rfq_batches(bid_deadline)
    WHERE status = 'published';

COMMIT;

-- ─── VERIFICATION ───
SELECT 'vq_currency_constraint' AS check, conname, pg_get_constraintdef(oid) AS def
  FROM pg_constraint
 WHERE conrelid = 'vendor_quotes'::regclass
   AND contype = 'c'
   AND pg_get_constraintdef(oid) LIKE '%currency%';
SELECT 'batches_with_bid_deadline' AS check, count(*) AS n
  FROM procurement_rfq_batches WHERE bid_deadline IS NOT NULL;
SELECT 'invitations_total' AS check, count(*) AS n
  FROM procurement_rfq_invitations;
