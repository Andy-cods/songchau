-- ============================================================
-- procurement_v2_001_phase1.sql  (Đợt 1 — rebuild đấu thầu NCC)
-- Make vendor bidding LOGIN-account based + round-aware + admin
-- quote-comparison matrix. SMALL, ADDITIVE, IDEMPOTENT — re-runnable
-- via: docker cp ... && psql -f.  NO enum TYPE creation here
-- (the risky TEXT→ENUM conversion is deferred to Đợt 2 because existing
-- data carries status values like 'draft' that don't match target enums).
-- This migration is PURELY FUNCTIONAL: status columns stay TEXT + CHECK.
-- Author: Thang — 2026-06-18
-- DEPLOY: docker cp + psql -f; restart sc-api + sc-worker + sc-scheduler.
-- ============================================================

-- ─── 1. procurement_rfq_invitations — add Đợt-1 columns ───
-- Table already exists (vendor_portal_001.sql): batch_id, vendor_id,
-- invited_at, viewed_at, quoted_at, email_sent, UNIQUE(batch_id,vendor_id).
ALTER TABLE procurement_rfq_invitations
    ADD COLUMN IF NOT EXISTS round_number   INT DEFAULT 1,
    ADD COLUMN IF NOT EXISTS status         TEXT DEFAULT 'invited',
    ADD COLUMN IF NOT EXISTS declined_at    TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS decline_reason TEXT,
    ADD COLUMN IF NOT EXISTS invited_by     UUID REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS email_sent_at  TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS email_status   TEXT,
    ADD COLUMN IF NOT EXISTS email_error    TEXT,
    ADD COLUMN IF NOT EXISTS email_subject  TEXT;

-- status stays TEXT in Đợt 1; legacy email_sent BOOLEAN is KEPT (new code
-- still sets it true on a successful send). Add the CHECK only if absent.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'prfq_inv_status_chk'
    ) THEN
        ALTER TABLE procurement_rfq_invitations
            ADD CONSTRAINT prfq_inv_status_chk
            CHECK (status IN ('invited','viewed','submitted','declined'));
    END IF;
END
$$;

-- ─── 2. Make invitations round-aware ───
-- Drop the old UNIQUE(batch_id,vendor_id) and replace with a round-aware
-- unique index so a vendor can be re-invited in a later round.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'procurement_rfq_invitations_batch_id_vendor_id_key'
    ) THEN
        ALTER TABLE procurement_rfq_invitations
            DROP CONSTRAINT procurement_rfq_invitations_batch_id_vendor_id_key;
    END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_prfq_inv_batch_vendor_round
    ON procurement_rfq_invitations(batch_id, vendor_id, round_number);

-- ─── 3. vendor_quotes — add round_number + round-aware unique ───
ALTER TABLE vendor_quotes
    ADD COLUMN IF NOT EXISTS round_number INT DEFAULT 1;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'vendor_quotes_batch_id_vendor_id_key'
    ) THEN
        ALTER TABLE vendor_quotes
            DROP CONSTRAINT vendor_quotes_batch_id_vendor_id_key;
    END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_vq_batch_vendor_round
    ON vendor_quotes(batch_id, vendor_id, round_number);

-- ─── 4. RELAX vendor_quotes currency CHECK to allow VND ───
-- The original CHECK only allows ('USD','RMB'). Discover its real name from
-- the catalog (it may be the inline name vendor_quotes_currency_check), drop
-- it, and re-add a 3-currency CHECK. Guarded so re-running is a no-op.
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
        SELECT 1 FROM pg_constraint WHERE conname = 'vendor_quotes_currency_check'
    ) THEN
        ALTER TABLE vendor_quotes
            ADD CONSTRAINT vendor_quotes_currency_check
            CHECK (currency IN ('USD','RMB','VND'));
    END IF;
END
$$;

-- ─── 5. Indexes (all IF NOT EXISTS) ───
CREATE INDEX IF NOT EXISTS idx_prfq_inv_vendor ON procurement_rfq_invitations(vendor_id);
CREATE INDEX IF NOT EXISTS idx_prfq_inv_batch  ON procurement_rfq_invitations(batch_id);
CREATE INDEX IF NOT EXISTS idx_prfq_inv_status ON procurement_rfq_invitations(status);
CREATE INDEX IF NOT EXISTS idx_vq_batch_round  ON vendor_quotes(batch_id, round_number);

-- ─── 6. Idempotent backfill ───
UPDATE procurement_rfq_invitations SET round_number = 1 WHERE round_number IS NULL;
UPDATE procurement_rfq_invitations
   SET status = 'submitted'
 WHERE status IS NULL AND quoted_at IS NOT NULL;
UPDATE procurement_rfq_invitations
   SET status = 'viewed'
 WHERE status IS NULL AND viewed_at IS NOT NULL;
UPDATE procurement_rfq_invitations SET status = 'invited' WHERE status IS NULL;
UPDATE vendor_quotes SET round_number = 1 WHERE round_number IS NULL;

-- POSTCHECK (run manually):
--   SELECT status, count(*) FROM procurement_rfq_invitations GROUP BY status;
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conrelid='vendor_quotes'::regclass AND contype='c';
