-- BQMS push-job heartbeat for the OOM-orphan watchdog (W0-07, Thang 2026-07-03).
--
-- Problem: khi sc-worker bị OOM giữa lúc đẩy 1 QT lên SEC, dòng bqms_rfq kẹt ở
-- bqms_push_status='running' (hoặc 'queued') mãi mãi — progress_pct/step đóng băng
-- nhưng KHÔNG có mốc thời gian nào cho biết job còn sống hay đã chết. bqms_push_started_at
-- chỉ set 1 lần lúc bắt đầu → không phân biệt được "chạy chậm" vs "đã chết".
--
-- Fix: thêm bqms_push_heartbeat_at. Progress callback bump cột này mỗi bước (~vài giây/bước)
-- nên watchdog (task bqms_push_watchdog, */15) có thể phát hiện job THẬT SỰ kẹt
-- (heartbeat cũ > 20') mà không đụng job đang chạy hợp lệ.
--
-- ADDITIVE / idempotent: chỉ ADD COLUMN + CREATE INDEX IF NOT EXISTS.

ALTER TABLE bqms_rfq
    ADD COLUMN IF NOT EXISTS bqms_push_heartbeat_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_bqms_push_heartbeat
    ON bqms_rfq (bqms_push_status, bqms_push_heartbeat_at)
    WHERE bqms_push_status IN ('queued', 'running');
