-- ============================================================
-- procurement_v2_018_rfq_qa.sql  (Đợt 2a #12 — Q&A + Phụ lục/Addendum)
--
-- Hỏi đáp / làm rõ RFQ (table-stakes đấu thầu chính thức). Hai cơ chế:
--   1. Q&A RIÊNG per (batch, vendor): 1 NCC chỉ thấy thread của CHÍNH MÌNH với
--      Song Châu (question = NCC hỏi, answer = admin đáp riêng). KHÔNG lộ câu
--      hỏi / giá / tên NCC khác.
--   2. Addendum (phụ lục) BROADCAST: admin đăng 1 thông báo làm rõ/sửa đổi tới
--      TẤT CẢ NCC đã mời của batch (ẩn danh người hỏi — chuẩn công bằng).
--
-- ADDITIVE, IDEMPOTENT, TRANSACTIONAL.
-- KHÔNG ALTER TYPE: notif TÁI DÙNG notification_type 'procurement_quote' (đã
--   vendor-facing + deep-link /vendor-bidding/{batch_id}) → KHÔNG cần rollout
--   enum non-transactional, KHÔNG cần restart 3 service vì enum. Chỉ cần sc-api
--   reconnect để asyncpg thấy bảng mới (worker/scheduler không đụng bảng này,
--   nhưng deploy code mới vẫn restart cả 3 như thường lệ).
--
-- SHAPE (chốt MAP Shape A):
--   * addendum  → 1 row, vendor_id NULL (broadcast toàn batch). DRY: 1 row/phụ
--     lục, không nhân N row theo số NCC. Notif vẫn fan-out N row qua loop.
--   * question/answer → thread, vendor_id NOT NULL (chủ thread = NCC).
--
-- CHECK constraint = tuyến phòng thủ CỨNG (không chỉ WHERE ở tầng app):
--   * NCC không thể tạo addendum (author phải admin).
--   * NCC không thể ghi vào thread NCC khác (chk_rfq_msg_vendor_self).
--
-- Author: COOK BACKEND — Đợt 2a (2026-06-29)
-- DEPLOY: docker cp + psql -f; restart sc-api (xoá __pycache__ trước restart).
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS procurement_rfq_messages (
    id               BIGSERIAL PRIMARY KEY,
    batch_id         BIGINT NOT NULL REFERENCES procurement_rfq_batches(id) ON DELETE CASCADE,
    -- vendor_id = chủ thread (NCC). NULL CHỈ khi kind='addendum' (broadcast toàn batch).
    vendor_id        BIGINT          REFERENCES vendor_accounts(id),
    kind             TEXT   NOT NULL,                        -- 'question' | 'answer' | 'addendum'
    author_admin_id  UUID            REFERENCES users(id),           -- set khi admin gửi (answer/addendum)
    author_vendor_id BIGINT          REFERENCES vendor_accounts(id), -- set khi NCC gửi (question)
    body             TEXT   NOT NULL,
    attachments      JSONB  NOT NULL DEFAULT '[]'::jsonb,
    read_by_admin_at  TIMESTAMPTZ,
    read_by_vendor_at TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_rfq_msg_kind CHECK (kind IN ('question','answer','addendum')),
    -- addendum: broadcast → vendor_id NULL, tác giả là admin.
    -- answer:   thread    → vendor_id NOT NULL, tác giả là admin.
    -- question: thread    → vendor_id NOT NULL, tác giả là NCC.
    CONSTRAINT chk_rfq_msg_scope CHECK (
        (kind = 'addendum' AND vendor_id IS NULL     AND author_admin_id  IS NOT NULL AND author_vendor_id IS NULL)
     OR (kind = 'answer'   AND vendor_id IS NOT NULL AND author_admin_id  IS NOT NULL AND author_vendor_id IS NULL)
     OR (kind = 'question' AND vendor_id IS NOT NULL AND author_vendor_id IS NOT NULL AND author_admin_id  IS NULL)
    ),
    -- NCC chỉ tự gửi vào thread của CHÍNH MÌNH (cô lập NCC A khỏi NCC B bằng cấu trúc).
    CONSTRAINT chk_rfq_msg_vendor_self CHECK (
        author_vendor_id IS NULL OR author_vendor_id = vendor_id)
);

-- Thread per (batch, vendor) theo thời gian — phục vụ GET thread + mark-read.
CREATE INDEX IF NOT EXISTS idx_rfq_msg_thread
    ON procurement_rfq_messages (batch_id, vendor_id, created_at);

-- Addendum lookup nhanh (partial: vendor_id NULL nằm ngoài range scan hữu ích của idx trên).
CREATE INDEX IF NOT EXISTS idx_rfq_msg_addendum
    ON procurement_rfq_messages (batch_id, created_at) WHERE kind = 'addendum';

COMMENT ON TABLE procurement_rfq_messages IS
  'Đợt 2a #12: Q&A per (batch,vendor) [question/answer] + Addendum broadcast [vendor_id NULL]. Không enum mới — notif tái dùng procurement_quote.';

COMMIT;

-- POSTCHECK (chạy tay):
--   \d procurement_rfq_messages
--   -- expect: 3 CHECK constraints (kind / scope / vendor_self), 2 index.
--   SELECT conname FROM pg_constraint
--    WHERE conrelid = 'procurement_rfq_messages'::regclass AND contype = 'c';
--   SELECT indexname FROM pg_indexes WHERE tablename = 'procurement_rfq_messages';
