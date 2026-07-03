-- ===========================================================================
-- Đợt 9 / Wave B — Item 3: Acknowledge PO. ADDITIVE, IDEMPOTENT, re-runnable.
-- NCC bấm "Xác nhận đã nhận đơn" → stamp 3 cột vào procurement_pos.
-- Dùng cột timestamp riêng — KHÔNG đụng status machine / status CHECK, KHÔNG
-- đụng gate giao hàng (_DELIVERABLE / _VENDOR_VISIBLE), KHÔNG backfill.
-- vendor_accounts.id là BIGSERIAL (= BIGINT) → acknowledged_by BIGINT khớp FK.
-- 2026-06-26.
-- ===========================================================================

ALTER TABLE procurement_pos
  ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS acknowledged_by BIGINT NULL REFERENCES vendor_accounts(id),
  ADD COLUMN IF NOT EXISTS ack_note TEXT NULL;

COMMENT ON COLUMN procurement_pos.acknowledged_at IS 'Thời điểm NCC xác nhận đã nhận PO (NULL = chưa xác nhận).';
COMMENT ON COLUMN procurement_pos.acknowledged_by IS 'vendor_accounts.id của NCC đã xác nhận.';
COMMENT ON COLUMN procurement_pos.ack_note IS 'Ghi chú NCC khi xác nhận (tùy chọn).';

-- KHÔNG cần migration cho procurement_audit_log (action là TEXT tự do → 'acknowledge' hợp lệ ngay).
-- KHÔNG cần migration cho notifications (chỉ thêm mapping 'po:acknowledge' trong code).
