-- Phase 6: BQMS Auto-Sync fixes
-- Date: 2026-04-06

-- Fix etl_sync_log status constraint to include 'queued'
ALTER TABLE etl_sync_log DROP CONSTRAINT IF EXISTS etl_sync_log_status_check;
ALTER TABLE etl_sync_log ADD CONSTRAINT etl_sync_log_status_check
    CHECK (status IN ('queued', 'running', 'success', 'error', 'cancelled'));

-- Add missing columns to bqms_samsung_po if they don't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bqms_samsung_po' AND column_name = 'bqms_code') THEN
        ALTER TABLE bqms_samsung_po ADD COLUMN bqms_code TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bqms_samsung_po' AND column_name = 'specification') THEN
        ALTER TABLE bqms_samsung_po ADD COLUMN specification TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bqms_samsung_po' AND column_name = 'quantity') THEN
        ALTER TABLE bqms_samsung_po ADD COLUMN quantity INTEGER;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bqms_samsung_po' AND column_name = 'unit') THEN
        ALTER TABLE bqms_samsung_po ADD COLUMN unit TEXT DEFAULT 'EA';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bqms_samsung_po' AND column_name = 'buyer_name') THEN
        ALTER TABLE bqms_samsung_po ADD COLUMN buyer_name TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bqms_samsung_po' AND column_name = 'buyer_email') THEN
        ALTER TABLE bqms_samsung_po ADD COLUMN buyer_email TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bqms_samsung_po' AND column_name = 'company') THEN
        ALTER TABLE bqms_samsung_po ADD COLUMN company TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bqms_samsung_po' AND column_name = 'preferred_delivery_date') THEN
        ALTER TABLE bqms_samsung_po ADD COLUMN preferred_delivery_date DATE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'bqms_samsung_po' AND column_name = 'secure_key') THEN
        ALTER TABLE bqms_samsung_po ADD COLUMN secure_key TEXT;
    END IF;

    -- Add rows_updated to etl_sync_log if missing
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'etl_sync_log' AND column_name = 'rows_updated') THEN
        ALTER TABLE etl_sync_log ADD COLUMN rows_updated INTEGER DEFAULT 0;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'etl_sync_log' AND column_name = 'started_at') THEN
        ALTER TABLE etl_sync_log ADD COLUMN started_at TIMESTAMPTZ DEFAULT NOW();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'etl_sync_log' AND column_name = 'completed_at') THEN
        ALTER TABLE etl_sync_log ADD COLUMN completed_at TIMESTAMPTZ;
    END IF;
END
$$;
