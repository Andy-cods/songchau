-- ============================================================
-- procurement_v2_019_sealed_bid.sql  (Đợt 2b [SB] — Niêm phong giá tới hạn)
--
-- Sealed-bid per-batch (DEFAULT OFF): khi bật + chưa tới bid_deadline thì MỌI
-- bề mặt admin lộ đơn giá NCC (matrix, decision-sheet, get_batch_admin,
-- vendor_full_quote drawer) ẩn giá — chỉ hiện đã-nộp/chưa-nộp. Sau deadline
-- (hoặc cờ tắt) → hiện bình thường. Mục đích: chống rò giá NCC↔NCC TRƯỚC khi
-- mở thầu, anti-leak NGAY CẢ từ phía mua. Vendor KHÔNG đổi (NCC vốn chỉ thấy
-- báo giá của chính mình).
--
-- ADDITIVE, IDEMPOTENT, TRANSACTIONAL. KHÔNG ALTER TYPE (không đụng enum).
-- DEFAULT FALSE → batch cũ + solo owner KHÔNG ảnh hưởng.
--
-- Author: COOK BACKEND — Đợt 2b (2026-06-29)
-- DEPLOY: docker cp + psql -f; restart sc-api (xoá __pycache__ trước restart).
--   worker/scheduler không đọc cột này nhưng deploy code mới restart cả 3 như lệ.
-- ============================================================

BEGIN;

ALTER TABLE procurement_rfq_batches
    ADD COLUMN IF NOT EXISTS sealed_until_deadline BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN procurement_rfq_batches.sealed_until_deadline IS
    'Đợt 2b: niêm phong đơn giá NCC trên mọi bề mặt admin tới khi qua bid_deadline (anti-leak). DEFAULT FALSE.';

COMMIT;
