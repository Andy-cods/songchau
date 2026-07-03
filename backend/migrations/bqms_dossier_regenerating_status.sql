-- ============================================================
-- Migration: Dossier "regenerating" status (re-edit Excel-only)
-- Date: 2026-06-25 (Thang)
--
-- Tính năng: cho phép mở lại 1 hồ sơ ĐÃ HOÀN TẤT (status='done'),
-- sửa form_data + ảnh đã upload, rồi DỰNG LẠI CHỈ FILE EXCEL
-- (ghi đè .xlsx trong output_folder đã lưu). Trong lúc dựng lại,
-- job ở status 'regenerating'.
--
-- SAFETY: bước này KHÔNG chạy scraper Samsung, KHÔNG mở popup
-- Create Delivery (không hoàn tác — đã làm rồi), KHÔNG re-parse
-- Shipping No, KHÔNG cộng dồn actual_delivered_qty. Chỉ Excel.
--
-- Idempotent: dùng DO block + IF EXISTS, không đổi dữ liệu.
-- ============================================================

BEGIN;

DO $$
BEGIN
    -- Drop existing CHECK (tên ổn định theo convention Postgres) nếu có
    ALTER TABLE bqms_dossier_jobs
        DROP CONSTRAINT IF EXISTS bqms_dossier_jobs_status_check;

    -- Re-add với 'regenerating' bổ sung vào danh sách hiện hữu
    ALTER TABLE bqms_dossier_jobs
        ADD CONSTRAINT bqms_dossier_jobs_status_check
        CHECK (status IN (
            'queued','running','awaiting_confirm','invoice_ready','po_downloaded',
            'excel_built','done','failed','cancelled','regenerating'
        ));
END
$$;

COMMIT;
