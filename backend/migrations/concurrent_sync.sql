-- Concurrent Sync — Optimistic Locking + Idempotency
-- Date: 2026-04-07

-- 1. Add `version` column to hot tables for optimistic locking
ALTER TABLE bqms_deliveries ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE crm_pipeline_cards ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sales_invoices_q ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE purchase_invoices_q ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE vendor_quotes ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 0;

-- 2. Trigger function to auto-bump version on UPDATE
CREATE OR REPLACE FUNCTION bump_version_on_update()
RETURNS TRIGGER AS $$
BEGIN
    NEW.version := COALESCE(OLD.version, 0) + 1;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. Attach trigger to each hot table
DO $$
DECLARE
    t TEXT;
BEGIN
    FOR t IN
        SELECT unnest(ARRAY[
            'bqms_deliveries',
            'crm_pipeline_cards',
            'sales_invoices_q',
            'purchase_invoices_q',
            'customers',
            'vendor_quotes'
        ])
    LOOP
        EXECUTE format(
            'DROP TRIGGER IF EXISTS trg_bump_version ON %I; '
            'CREATE TRIGGER trg_bump_version BEFORE UPDATE ON %I '
            'FOR EACH ROW EXECUTE FUNCTION bump_version_on_update();',
            t, t
        );
    END LOOP;
END
$$;

-- 4. Idempotency keys table (for POST endpoints)
CREATE TABLE IF NOT EXISTS idempotency_keys (
    key             TEXT PRIMARY KEY,
    user_id         UUID,
    endpoint        TEXT NOT NULL,
    response_body   JSONB,
    status_code     INTEGER NOT NULL DEFAULT 200,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours'
);

CREATE INDEX IF NOT EXISTS idx_idem_expires ON idempotency_keys(expires_at);

-- Cleanup expired keys (run via cron later)
CREATE OR REPLACE FUNCTION cleanup_expired_idempotency_keys()
RETURNS INTEGER AS $$
DECLARE
    deleted INTEGER;
BEGIN
    DELETE FROM idempotency_keys WHERE expires_at < NOW();
    GET DIAGNOSTICS deleted = ROW_COUNT;
    RETURN deleted;
END;
$$ LANGUAGE plpgsql;
