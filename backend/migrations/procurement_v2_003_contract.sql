-- ============================================================
-- procurement_v2_003_contract.sql  (Đợt 3 — Contract lifecycle + e-sign + PDF)
-- ADDITIVE, IDEMPOTENT, re-runnable via: docker cp ... && psql -f.
-- NO enum TYPE creation — status column stays TEXT + CHECK (like Đợt 1/2).
-- Author: Thang — 2026-06-18
-- DEPLOY: docker cp + psql -f; restart sc-api + sc-worker + sc-scheduler.
--
-- PRE-EXISTING FACTS (verified in vendor_bidding_phase2_lifecycle.sql 30-85;
-- NOT touched by procurement_v2_001/002 which only altered
-- procurement_rfq_invitations + vendor_quotes):
--   * procurement_contracts ALREADY has: contract_no, batch_id, vendor_id
--     (NULLABLE — legacy magic-link), vendor_name/email/phone/tax_code/address,
--     total_amount, currency, payment_terms, delivery_terms, warranty_terms,
--     status TEXT DEFAULT 'draft', contract_date, effective_date, expiry_date,
--     sent_to_vendor_at, signed_at, signed_by_vendor, signed_ip, signature_data,
--     contract_file_path, created_by UUID, created_at, updated_at, notes.
--   * status CHECK ALREADY = ('draft','sent','signed','active','completed',
--     'cancelled') — the FULL lifecycle is already allowed. There is NO enum
--     TYPE (the plan proposed pcontract_status but it was never created; status
--     stays TEXT+CHECK — we KEEP it that way, NO enum).
--   * procurement_contract_items ALREADY has the generated total_price column.
--   * procurement_audit_log exists (procurement_v2_002_award.sql).
--
-- WHAT THIS MIGRATION ACTUALLY ADDS (only the genuinely-missing pieces):
-- ============================================================

-- ─── 1. signed_by_user — admin who activated/confirmed the sign ───
ALTER TABLE procurement_contracts
    ADD COLUMN IF NOT EXISTS signed_by_user UUID REFERENCES users(id);

-- ─── 2. pdf_generated_at — when the contract PDF was last rendered ───
ALTER TABLE procurement_contracts
    ADD COLUMN IF NOT EXISTS pdf_generated_at TIMESTAMPTZ;

-- ─── 3. NO sent_at column ───
-- The table already has sent_to_vendor_at serving that exact role; the backend
-- REUSES it. We deliberately do NOT add a redundant sent_at column.

-- ─── 4. SAFETY NET — guarded discover+drop+readd of the status CHECK ───
-- The live constraint ALREADY allows the full 6-state lifecycle, so on every
-- current environment this is a NO-OP that re-adds the SAME 6 values (nothing
-- lost). It exists ONLY to repair any older/narrower CHECK in a stale
-- environment. Pattern copied from procurement_v2_001_phase1.sql §4.
DO $$
DECLARE
    con_name TEXT;
BEGIN
    SELECT conname INTO con_name
      FROM pg_constraint
     WHERE conrelid = 'procurement_contracts'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%status%';

    IF con_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE procurement_contracts DROP CONSTRAINT %I', con_name);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'procurement_contracts_status_check'
    ) THEN
        ALTER TABLE procurement_contracts
            ADD CONSTRAINT procurement_contracts_status_check
            CHECK (status IN ('draft','sent','signed','active','completed','cancelled'));
    END IF;
END
$$;

-- ─── 5. Index on signed_by_user (cheap, optional) ───
CREATE INDEX IF NOT EXISTS idx_pct_signed_user ON procurement_contracts(signed_by_user);

-- POSTCHECK (run manually):
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name='procurement_contracts'
--      AND column_name IN ('signed_by_user','pdf_generated_at');
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conrelid='procurement_contracts'::regclass AND contype='c';
