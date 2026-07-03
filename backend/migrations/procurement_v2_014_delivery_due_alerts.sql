-- ===========================================================================
-- Đợt 10 / #17 — Cockpit cảnh báo TRƯỚC HẠN GIAO (delivery-due alerts).
-- INTERNAL-ONLY. ADDITIVE, IDEMPOTENT, re-runnable. KHÔNG backfill.
--
-- Neo dữ liệu (đã LIVE, KHÔNG cần thêm cột due-date):
--   procurement_pos.requested_delivery_date  DATE  (hạn giao)
--   procurement_pos.status                    -> 'open','partially_delivered' = chưa giao xong
--   procurement_pos.po_no / batch_id / vendor_name (đã có)
--   notification_type ENUM đã có value 'procurement_po' (procurement_v2_004) -> KHÔNG cần ALTER TYPE.
--
-- Migration này CHỈ thêm:
--   (1) cột gate idempotent  delivery_reminder_sent_at  (nhắc đúng 1 LẦN / PO — C2)
--   (2) partial index hỗ trợ sweep
--   (3) 3 app_config flag (ngưỡng N ngày — C1 / master-switch / sàn ngày)
--
-- KHÔNG đụng status machine, KHÔNG đụng tài chính (auto-AP VẪN OFF),
-- KHÔNG đụng cổng NCC (notif sẽ là recipient_vendor_id=NULL — chỉ team nội bộ).
-- 2026-06-27.
-- ===========================================================================

BEGIN;

-- (1) Idempotent-gate due-soon: mỗi PO cảnh báo đúng 1 lần (C2 — KHÔNG spam).
ALTER TABLE procurement_pos
    ADD COLUMN IF NOT EXISTS delivery_reminder_sent_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN procurement_pos.delivery_reminder_sent_at IS
    'Đợt10 #17: NULL = chưa cảnh báo hạn giao. Set NOW() khi sweep đã gửi notif nội bộ -> nhắc đúng 1 lần/PO.';

-- (2) Partial index hỗ trợ sweep (chỉ index PO còn mở + chưa nhắc).
CREATE INDEX IF NOT EXISTS idx_ppo_delivery_due
    ON procurement_pos (requested_delivery_date)
    WHERE status IN ('open', 'partially_delivered')
      AND delivery_reminder_sent_at IS NULL;

-- (3) app_config flags (key TEXT PK, value JSONB) — đổi không cần deploy.
--     procurement_delivery_due_alert_days     : ngưỡng N ngày trước hạn -> bật notif (C1, default 3).
--     procurement_delivery_due_alert_enabled  : master-switch -> deploy "im lặng" rồi bật sau.
--     procurement_delivery_due_floor_date     : sàn ngày -> KHÔNG dội notif cho PO quá hạn cũ
--                                               trước thời điểm bật feature (chống bão thông báo lần đầu).
INSERT INTO app_config (key, value)
    VALUES ('procurement_delivery_due_alert_days', '3'::jsonb)
    ON CONFLICT (key) DO NOTHING;
INSERT INTO app_config (key, value)
    VALUES ('procurement_delivery_due_alert_enabled', 'true'::jsonb)
    ON CONFLICT (key) DO NOTHING;
INSERT INTO app_config (key, value)
    VALUES ('procurement_delivery_due_floor_date', to_jsonb(CURRENT_DATE::text))
    ON CONFLICT (key) DO NOTHING;

COMMIT;

-- KHÔNG cần migration cho notifications/enum:
--   * 'procurement_po' đã có trong notification_type (procurement_v2_004:35).
--   * notifications.recipient_vendor_id đã tồn tại (procurement_v2_004:46) -> set NULL cho nội bộ.
