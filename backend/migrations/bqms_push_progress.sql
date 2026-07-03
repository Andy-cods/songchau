-- BQMS Push Progress tracking (Thang 2026-05-15)
ALTER TABLE bqms_rfq
    ADD COLUMN IF NOT EXISTS bqms_push_progress_pct  INT DEFAULT 0,
    ADD COLUMN IF NOT EXISTS bqms_push_progress_step TEXT,
    ADD COLUMN IF NOT EXISTS bqms_push_started_at    TIMESTAMPTZ;
