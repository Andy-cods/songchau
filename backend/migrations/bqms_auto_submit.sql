-- BQMS Auto-Submit (Thang 2026-05-14) — track Save Temporarily push lên sec-bqms
ALTER TABLE bqms_rfq
    ADD COLUMN IF NOT EXISTS bqms_pushed_at      TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS bqms_pushed_round   INT,
    ADD COLUMN IF NOT EXISTS bqms_push_status    TEXT,
    ADD COLUMN IF NOT EXISTS bqms_push_error     TEXT,
    ADD COLUMN IF NOT EXISTS bqms_push_job_id    TEXT,
    ADD COLUMN IF NOT EXISTS bqms_push_payload   JSONB,
    ADD COLUMN IF NOT EXISTS bqms_push_screenshot_path TEXT;

CREATE INDEX IF NOT EXISTS idx_bqms_rfq_push_status
    ON bqms_rfq(bqms_push_status) WHERE bqms_push_status IN ('queued', 'running');
