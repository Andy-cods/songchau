-- ============================================================
-- procurement_v2_009_foc_per_line.sql  (Đợt 7 — FOC per-line +
--   fix bug "giá 0 / không-làm-được bị tô xanh giá thấp nhất")
-- ADDITIVE, IDEMPOTENT, re-runnable via: docker cp ... && psql -f.
-- Author: Thang — 2026-06-26
-- DEPLOY: docker cp + psql -f; restart sc-api + sc-worker + sc-scheduler.
--
-- BỐI CẢNH:
--   Matrix so sánh (procurement.py get_matrix) + decision-sheet .xlsx trước đây
--   chỉ kiểm `unit_price IS NOT NULL` khi gom danh sách "priced" → một dòng NCC
--   nhập giá 0 (FOC/tặng hoặc nhập nhầm) hoặc dòng `can_do=false` (không cung
--   cấp được) vẫn bị tô XANH "giá thấp nhất" → có thể dẫn tới CHỐT THẦU SAI.
--
--   Bản vá thêm cờ `free_charge` (FOC) để phân biệt rạch ròi "miễn phí" với
--   "giá 0 vô tình", và backend giờ loại khỏi diện "thấp nhất" mọi dòng:
--     · unit_price <= 0   (giá 0/âm)
--     · can_do = false     (NCC không cung cấp được)
--     · free_charge = true (FOC — cung cấp miễn phí, không phải báo giá so sánh)
--
-- PRE-EXISTING FACTS (verified):
--   * vendor_quote_items đã có can_do, attachment_paths (magic_link),
--     offered_qty, moq, currency (procurement_v2_007). free_charge là cột MỚI
--     thực sự → ADD COLUMN IF NOT EXISTS là no-op khi chạy lại.
-- ============================================================

BEGIN;

-- ─── 1. vendor_quote_items — cờ FOC (miễn phí) per-line ───
-- NOT NULL DEFAULT false: mọi dòng cũ → false (giữ nguyên hành vi). FE/BE chỉ
-- bật true khi NCC tick "Miễn phí (FOC)" và can_do=true.
ALTER TABLE vendor_quote_items
    ADD COLUMN IF NOT EXISTS free_charge BOOLEAN NOT NULL DEFAULT false;

COMMIT;

-- ─── VERIFICATION ───
SELECT 'vqi_free_charge_col' AS check,
       EXISTS (
           SELECT 1 FROM information_schema.columns
            WHERE table_name = 'vendor_quote_items'
              AND column_name = 'free_charge'
       ) AS present;
SELECT 'vqi_foc_rows' AS check, count(*) AS n
  FROM vendor_quote_items WHERE free_charge = true;
