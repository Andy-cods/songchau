-- ============================================================
-- procurement_v2_017_vendor_reset.sql  (Đợt 1 — "Mở cửa cho NCC lạ")
-- Forgot/Reset password cho cổng Nhà Cung Cấp.
--
-- 2 cột mới TÁCH BIỆT khỏi activation_* (cố ý):
--   * activation_token/expires = LỜI MỜI lần đầu (NCC chưa từng có mật khẩu).
--   * reset_token/expires       = QUÊN mật khẩu của tài khoản ĐÃ active.
-- Trộn chung sẽ làm 1 NCC đang chờ kích hoạt mà bấm "quên mật khẩu" ghi đè
-- token mời → mất lời mời. Tách 2 cột là rẻ nhất + an toàn nhất.
--
-- ADDITIVE + IDEMPOTENT — chạy lại nhiều lần an toàn.
-- TRANSACTIONAL: chỉ ALTER TABLE + CREATE INDEX, KHÔNG có ALTER TYPE ADD VALUE
-- → KHÔNG cần rollout enum non-transactional, KHÔNG cần restart 3 service vì
-- enum. Chỉ cần sc-api reconnect/restart để asyncpg thấy 2 cột mới (worker /
-- scheduler không đụng 2 cột reset này).
-- Author: COOK BACKEND — Đợt 1
-- ============================================================

-- 1. Hai cột reset trên vendor_accounts
ALTER TABLE vendor_accounts
    ADD COLUMN IF NOT EXISTS reset_token   TEXT,
    ADD COLUMN IF NOT EXISTS reset_expires TIMESTAMPTZ;

-- 2. Lookup token nhanh + chống đụng token (cùng kiểu partial-unique như
--    activation_token ở procurement_v2_000).
CREATE UNIQUE INDEX IF NOT EXISTS uq_va_reset_token
    ON vendor_accounts(reset_token) WHERE reset_token IS NOT NULL;

-- POSTCHECK (chạy tay):
--   \d vendor_accounts   -- thấy reset_token / reset_expires
