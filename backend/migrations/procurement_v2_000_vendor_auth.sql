-- ============================================================
-- procurement_v2_000_vendor_auth.sql  (Đợt 0 — rebuild đấu thầu NCC)
-- Harden the existing vendor login portal: add a proper account
-- status lifecycle + invite→activate token flow, migrating the old
-- boolean `is_approved`. ADDITIVE + IDEMPOTENT — safe to re-run.
-- Author: Thang — 2026-06-18
-- ============================================================

-- 1. Account status lifecycle enum (replaces the is_approved boolean)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vendor_account_status') THEN
        CREATE TYPE vendor_account_status AS ENUM ('pending', 'active', 'suspended', 'rejected');
    END IF;
END
$$;

-- 2. New columns on vendor_accounts (status + invite/activation + audit)
ALTER TABLE vendor_accounts
    ADD COLUMN IF NOT EXISTS status             vendor_account_status NOT NULL DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS invited_by         UUID REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS activation_token   TEXT,
    ADD COLUMN IF NOT EXISTS activation_expires TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_login_at      TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS rejected_reason    TEXT;

-- 3. Backfill status from the legacy is_approved boolean (one-time, idempotent:
--    only touches rows still at the default 'pending').
UPDATE vendor_accounts
   SET status = 'active'
 WHERE is_approved = true
   AND status = 'pending';

-- 4. Indexes — single-use activation token + supplier link lookup
CREATE UNIQUE INDEX IF NOT EXISTS uq_va_activation_token
    ON vendor_accounts(activation_token) WHERE activation_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_va_supplier ON vendor_accounts(supplier_id);
CREATE INDEX IF NOT EXISTS idx_va_status   ON vendor_accounts(status);

-- POSTCHECK (run manually):
--   SELECT status, count(*) FROM vendor_accounts GROUP BY status;
