-- ============================================================
-- procurement_v2_016_rank_hint.sql  (Đợt 11 #15 — Gợi ý vị thế cạnh tranh cho NCC)
-- Endpoint vendor ĐẦU TIÊN cố ý lộ MỘT tín hiệu cạnh tranh — nhưng ở mức BĂNG MỜ
-- NHẤT: chỉ trả band chữ {dẫn đầu / nhóm giữa / cần cải thiện}. KHÔNG ordinal,
-- KHÔNG %, KHÔNG số tuyệt đối, KHÔNG giá/tên đối thủ.
--
-- ADDITIVE, IDEMPOTENT, re-runnable via: docker cp ... && psql -f.
-- Author: Thang — 2026-06-27
-- DEPLOY: docker cp + psql -f; restart sc-api (xoá __pycache__ trước khi restart).
--
-- AN TOÀN CỨNG (CẢ HAI cờ PER-BATCH, DEFAULT FALSE → endpoint trả 404 khi TẮT):
--   * rank_hint_enabled   : bật/tắt toàn bộ tính năng cho 1 đợt. OFF ⇒ /rank-hint = 404.
--   * rank_hint_round_from: vòng NHỎ NHẤT được phép lộ band. Default 9999 = "không
--     vòng nào" (an toàn). Thang đã chốt G2 = hiện MỌI vòng ⇒ khi bật, admin set =1.
--     Giữ cờ này để sau có thể giới hạn "chỉ lộ từ vòng N" mà không cần migration mới.
-- ============================================================

BEGIN;

-- ─── 1. Hai cờ per-batch (CẢ HAI default an toàn = TẮT) ───
ALTER TABLE procurement_rfq_batches
    ADD COLUMN IF NOT EXISTS rank_hint_enabled   BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS rank_hint_round_from INT    NOT NULL DEFAULT 9999;

COMMENT ON COLUMN procurement_rfq_batches.rank_hint_enabled IS
  'Đợt11 #15: bật gợi ý vị thế (band-mờ) cho NCC. Default OFF → /rank-hint trả 404. Thang bật per-batch.';
COMMENT ON COLUMN procurement_rfq_batches.rank_hint_round_from IS
  'Đợt11 #15: vòng nhỏ nhất được lộ band. Default 9999 = không vòng nào. Bật + show-mọi-vòng ⇒ set =1.';

-- ─── 2. Index hỗ trợ xếp hạng cohort cùng tiền tệ / cùng vòng ───
-- Cohort = các báo giá ĐÃ NỘP, total_amount>0, cùng (batch, vòng, tiền tệ).
CREATE INDEX IF NOT EXISTS ix_vq_rank_hint
    ON vendor_quotes (batch_id, round_number, currency, total_amount)
    WHERE status = 'submitted' AND total_amount > 0;

COMMIT;

-- POSTCHECK (run manually):
--   SELECT column_name, data_type, column_default, is_nullable
--     FROM information_schema.columns
--    WHERE table_name='procurement_rfq_batches'
--      AND column_name IN ('rank_hint_enabled','rank_hint_round_from');
--   -- expect: rank_hint_enabled boolean / false / NO ; rank_hint_round_from integer / 9999 / NO
--   SELECT indexname FROM pg_indexes WHERE indexname='ix_vq_rank_hint';
