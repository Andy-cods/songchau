-- ============================================================
-- procurement_v2_010_delivery_docs.sql  (Đợt 8 Wave A —
--   #3 trường đóng gói/invoice trên lô giao + #2 Delivery Note PDF path)
-- ADDITIVE, IDEMPOTENT, re-runnable via: docker cp ... && psql -f.
-- Author: Thang — 2026-06-26
-- DEPLOY: docker cp + psql -f; restart sc-api + sc-worker + sc-scheduler.
--
-- BỐI CẢNH (gap analysis #2/#3): lô giao (procurement_deliveries) hiện chỉ là
-- dòng dữ liệu — thiếu (a) trường logistics để kho đối chiếu kiện/khối lượng và
-- (b) đường dẫn Phiếu Giao Nhận PDF in được. BQMS Create Delivery bắt NCC nhập
-- Vendor Invoice No / Invoice Date / Packing Qty+Unit / Gross Weight — đây là bộ
-- tối thiểu (GĐ1). Tất cả NULLABLE → migration an toàn, không phá lô giao cũ.
--
-- PRE-EXISTING (verified — vendor_bidding_phase2_lifecycle.sql:137-160):
--   procurement_deliveries đã có: delivery_no, po_id, vendor_id, delivery_method,
--   delivered_at, tracking_no, status, received_at/by, rejection_reason,
--   photos/documents JSONB, notes, created_by. KHÔNG có packing/invoice cols hay
--   delivery_note_path → các ADD dưới đây là add thật (no-op khi chạy lại).
-- ============================================================

BEGIN;

ALTER TABLE procurement_deliveries
    ADD COLUMN IF NOT EXISTS vendor_invoice_no  TEXT,        -- civNo (số hóa đơn NCC)
    ADD COLUMN IF NOT EXISTS invoice_date       DATE,        -- ngày hóa đơn
    ADD COLUMN IF NOT EXISTS packing_qty        NUMERIC,     -- số kiện
    ADD COLUMN IF NOT EXISTS packing_unit       TEXT,        -- ĐVT kiện (BOX/PALLET…)
    ADD COLUMN IF NOT EXISTS gross_weight       NUMERIC,     -- tổng khối lượng (KG)
    ADD COLUMN IF NOT EXISTS delivery_note_path TEXT;        -- relative path PDF Phiếu Giao Nhận

COMMIT;

-- ─── VERIFICATION ───
SELECT 'pdel_new_cols' AS check,
       count(*) FILTER (WHERE column_name IN
           ('vendor_invoice_no','invoice_date','packing_qty','packing_unit',
            'gross_weight','delivery_note_path')) AS n_present
  FROM information_schema.columns
 WHERE table_name = 'procurement_deliveries';
