-- ============================================================
-- Migration: Dossier "Confirm before Create Delivery" checkpoint
-- Date: 2026-05-28 (Thang)
--
-- Tính năng: trước khi scraper bấm "Create Delivery" trên Samsung
-- (KHÔNG THỂ HOÀN TÁC), job tạm dừng ở status 'awaiting_confirm',
-- chụp screenshot popup đã điền + đọc lại giá trị + cảnh báo thiếu,
-- chờ user xác nhận. User confirm → bấm Save. User cancel / timeout
-- (5 phút) → đóng popup không lưu (an toàn để test).
-- ============================================================

BEGIN;

-- 1. Extend status CHECK to include awaiting_confirm + cancelled
ALTER TABLE bqms_dossier_jobs DROP CONSTRAINT IF EXISTS bqms_dossier_jobs_status_check;
ALTER TABLE bqms_dossier_jobs ADD CONSTRAINT bqms_dossier_jobs_status_check
    CHECK (status IN (
        'queued','running','awaiting_confirm','invoice_ready','po_downloaded',
        'excel_built','done','failed','cancelled'
    ));

-- 2. New columns for the confirm checkpoint
ALTER TABLE bqms_dossier_jobs
    ADD COLUMN IF NOT EXISTS confirm_signal      TEXT,          -- NULL | 'confirm' | 'cancel'
    ADD COLUMN IF NOT EXISTS confirm_preview     JSONB,         -- {screenshot, header{}, items[], warnings[]}
    ADD COLUMN IF NOT EXISTS awaiting_confirm_at TIMESTAMPTZ;   -- when checkpoint reached (for countdown)

-- 3. Attempt-no trigger: 'awaiting_confirm' counts as an active attempt
--    (cancelled does NOT count — like failed, so user can retry freely).
CREATE OR REPLACE FUNCTION set_dossier_attempt_no()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.delivery_attempt_no IS NULL OR NEW.delivery_attempt_no = 1 THEN
        SELECT COALESCE(MAX(delivery_attempt_no), 0) + 1
          INTO NEW.delivery_attempt_no
          FROM bqms_dossier_jobs
         WHERE po_numbers = NEW.po_numbers
           AND sev_type = NEW.sev_type
           AND status IN ('done', 'queued', 'running', 'awaiting_confirm',
                          'invoice_ready', 'po_downloaded', 'excel_built');
        SELECT id INTO NEW.previous_dossier_id
          FROM bqms_dossier_jobs
         WHERE po_numbers = NEW.po_numbers
           AND sev_type = NEW.sev_type
           AND delivery_attempt_no = NEW.delivery_attempt_no - 1
         ORDER BY created_at DESC LIMIT 1;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. History view: include awaiting_confirm jobs
CREATE OR REPLACE VIEW v_po_delivery_history AS
SELECT
    unnest(j.po_numbers)              AS po_number,
    j.id                              AS dossier_id,
    j.delivery_attempt_no             AS attempt_no,
    j.sev_type,
    j.shipping_no,
    j.invoice_no,
    j.status,
    j.form_data,
    j.is_partial,
    j.output_folder,
    j.previous_dossier_id,
    j.created_at,
    j.updated_at,
    j.user_id
FROM bqms_dossier_jobs j
WHERE j.status IN ('done', 'queued', 'running', 'awaiting_confirm',
                   'invoice_ready', 'po_downloaded', 'excel_built');

COMMENT ON COLUMN bqms_dossier_jobs.confirm_signal IS
    'Tín hiệu user gửi khi job ở awaiting_confirm: confirm = bấm Save, cancel = đóng popup không lưu.';
COMMENT ON COLUMN bqms_dossier_jobs.confirm_preview IS
    'Snapshot popup đã điền (screenshot filename + giá trị đọc lại + cảnh báo) để user kiểm tra 100% trước khi tạo Delivery.';

COMMIT;
