-- Đợt sau-demo (Thang 2026-06-29): admin chọn FILE NÀO của mã (thư mục Raw BQMS)
-- được CHIA SẺ cho NCC xem/tải khi báo giá. Mặc định KHÔNG có dòng nào → NCC
-- không thấy file nào trừ khi admin tick. Per-item (item_id), per-file (kind+name).
--
-- Idempotent. KHÔNG ALTER TYPE (tránh restart nhạy cảm). rfq_number lưu sẵn khi
-- chia sẻ để cổng NCC tải file KHÔNG cần JOIN lại bqms_rfq (và KHÔNG lộ rfq_number).

CREATE TABLE IF NOT EXISTS procurement_rfq_shared_files (
    id          BIGSERIAL PRIMARY KEY,
    batch_id    BIGINT NOT NULL REFERENCES procurement_rfq_batches(id) ON DELETE CASCADE,
    item_id     BIGINT NOT NULL REFERENCES procurement_rfq_items(id) ON DELETE CASCADE,
    rfq_number  TEXT   NOT NULL,
    kind        TEXT   NOT NULL DEFAULT 'raw' CHECK (kind IN ('raw', 'images')),
    file_name   TEXT   NOT NULL,
    shared_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (item_id, kind, file_name)
);

CREATE INDEX IF NOT EXISTS idx_prfq_shared_files_batch ON procurement_rfq_shared_files(batch_id);
CREATE INDEX IF NOT EXISTS idx_prfq_shared_files_item ON procurement_rfq_shared_files(item_id);
