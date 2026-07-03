-- Vendor Bidding — Magic Link extension (Thang 2026-05-14)
-- Mở rộng schema vendor_portal_001.sql để hỗ trợ mời NCC qua magic link URL,
-- không cần đăng ký tài khoản. NCC click link → form báo giá public.

-- 1. Magic link tokens — 1 token per (batch, invitee)
CREATE TABLE IF NOT EXISTS procurement_bid_tokens (
    id                  BIGSERIAL PRIMARY KEY,
    token               TEXT UNIQUE NOT NULL,                -- urlsafe 32-char random
    batch_id            BIGINT NOT NULL REFERENCES procurement_rfq_batches(id) ON DELETE CASCADE,
    -- Either tied to existing vendor_account OR ad-hoc (email only)
    vendor_id           BIGINT REFERENCES vendor_accounts(id),
    invitee_email       TEXT,
    invitee_name        TEXT,
    invitee_company     TEXT,
    invitee_phone       TEXT,
    -- Lifecycle
    created_by          UUID REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at          TIMESTAMPTZ NOT NULL,
    revoked_at          TIMESTAMPTZ,
    revoked_by          UUID REFERENCES users(id),
    -- Round info (Phase 1: only round 1; Phase 2 sẽ thêm V2/V3)
    round_number        INT NOT NULL DEFAULT 1,
    -- Tracking
    first_opened_at     TIMESTAMPTZ,
    last_opened_at      TIMESTAMPTZ,
    open_count          INT NOT NULL DEFAULT 0,
    submitted_quote_id  BIGINT REFERENCES vendor_quotes(id),
    -- Email log
    email_sent_at       TIMESTAMPTZ,
    email_subject       TEXT,
    email_status        TEXT,  -- 'sent', 'failed', 'opened'
    email_error         TEXT
);

CREATE INDEX IF NOT EXISTS idx_pbt_token        ON procurement_bid_tokens(token);
CREATE INDEX IF NOT EXISTS idx_pbt_batch        ON procurement_bid_tokens(batch_id);
CREATE INDEX IF NOT EXISTS idx_pbt_vendor       ON procurement_bid_tokens(vendor_id);
CREATE INDEX IF NOT EXISTS idx_pbt_open_active  ON procurement_bid_tokens(batch_id, expires_at) WHERE revoked_at IS NULL;

-- 2. vendor_quotes — make vendor_id nullable + support magic-link submissions
ALTER TABLE vendor_quotes
    ALTER COLUMN vendor_id DROP NOT NULL;

ALTER TABLE vendor_quotes
    ADD COLUMN IF NOT EXISTS submitted_via_token_id BIGINT REFERENCES procurement_bid_tokens(id),
    ADD COLUMN IF NOT EXISTS submitter_name  TEXT,
    ADD COLUMN IF NOT EXISTS submitter_email TEXT,
    ADD COLUMN IF NOT EXISTS submitter_phone TEXT,
    ADD COLUMN IF NOT EXISTS submitter_company TEXT,
    ADD COLUMN IF NOT EXISTS can_do BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS reject_reason TEXT;

-- Drop the UNIQUE (batch_id, vendor_id) constraint to allow magic-link submissions
-- where vendor_id is NULL — replace with partial-unique: only when vendor_id is set.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'vendor_quotes_batch_id_vendor_id_key'
    ) THEN
        ALTER TABLE vendor_quotes DROP CONSTRAINT vendor_quotes_batch_id_vendor_id_key;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_vendor_quotes_batch_vendor
    ON vendor_quotes(batch_id, vendor_id) WHERE vendor_id IS NOT NULL;

-- 3. vendor_quote_items — per-item capability + supplier attachments
ALTER TABLE vendor_quote_items
    ADD COLUMN IF NOT EXISTS can_do BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS attachment_paths JSONB NOT NULL DEFAULT '[]'::jsonb;

-- 4. procurement_rfq_items — ensure drawing tracking
ALTER TABLE procurement_rfq_items
    ADD COLUMN IF NOT EXISTS drawing_filename TEXT,
    ADD COLUMN IF NOT EXISTS images_paths JSONB NOT NULL DEFAULT '[]'::jsonb;

-- 5. procurement_rfq_batches — V2/V3 deadline columns (Phase 2 will use)
ALTER TABLE procurement_rfq_batches
    ADD COLUMN IF NOT EXISTS deadline_v1 TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS deadline_v2 TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS deadline_v3 TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS current_round INT NOT NULL DEFAULT 1;
