-- ===========================================================================
-- Đợt 10 / #4 — confirmed_qty: BUYER xác nhận số THỰC NHẬN trên dòng lô giao.
-- ADDITIVE, IDEMPOTENT, re-runnable. 3 cột NULLABLE. KHÔNG backfill.
-- confirmed_by là UUID (users.id) vì BUYER/nội bộ bấm (token_data.user_id) —
-- KHÁC delivered_qty mà NCC tự khai. KHÔNG đụng status machine / status CHECK,
-- KHÔNG đụng tài chính (auto-AP VẪN OFF — chỉ thêm 1 dòng COALESCE dormant).
-- NCC KHÔNG thấy/sửa các cột này (cổng NCC giữ delivered_qty).
-- 2026-06-27.
-- ===========================================================================

ALTER TABLE procurement_delivery_items
  ADD COLUMN IF NOT EXISTS confirmed_qty NUMERIC NULL,
  ADD COLUMN IF NOT EXISTS confirmed_by  UUID NULL REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS confirmed_at  TIMESTAMPTZ NULL;

COMMENT ON COLUMN procurement_delivery_items.confirmed_qty IS 'Số buyer XÁC NHẬN thực nhận (NULL = chưa → progress/AP fallback delivered_qty).';
COMMENT ON COLUMN procurement_delivery_items.confirmed_by  IS 'users.id (UUID) nội bộ đã xác nhận. KHÁC vendor (delivered_qty do NCC khai).';
COMMENT ON COLUMN procurement_delivery_items.confirmed_at  IS 'Thời điểm xác nhận (NULL = chưa).';

-- KHÔNG cần migration cho procurement_audit_log (action TEXT tự do → 'confirm_qty' hợp lệ ngay).
-- KHÔNG cần migration cho accounts_payable (chỉ đổi query COALESCE dormant trong chain_service).
