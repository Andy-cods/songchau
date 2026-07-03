-- Multi-delivery tracking per PO (Thang 2026-05-21)
--
-- 1 PO có thể được giao thành nhiều đợt (partial). Mỗi đợt = 1 dossier_job.
-- Trước đây không có cách phân biệt "đợt 1, đợt 2, đợt 3" của cùng PO →
-- thống kê khó. Migration này thêm:
--   * delivery_attempt_no — 1, 2, 3... (auto-set bởi trigger)
--   * is_partial          — sau đợt này còn pending qty không
--   * previous_dossier_id — link về đợt trước (cho UI hiển thị history)
--   * v_po_delivery_history — VIEW phẳng (mỗi PO × mỗi đợt = 1 row)
--   * idx_dossier_jobs_po_array — GIN index để query nhanh "all dossiers for PO X"

ALTER TABLE bqms_dossier_jobs
    ADD COLUMN IF NOT EXISTS delivery_attempt_no INT DEFAULT 1,
    ADD COLUMN IF NOT EXISTS is_partial          BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS previous_dossier_id BIGINT
        REFERENCES bqms_dossier_jobs(id) ON DELETE SET NULL;

-- Backfill: existing rows that share po_numbers get attempt_no in created_at order.
WITH ordered AS (
    SELECT id,
           ROW_NUMBER() OVER (
               PARTITION BY po_numbers, sev_type
               ORDER BY created_at, id
           ) AS rn
      FROM bqms_dossier_jobs
)
UPDATE bqms_dossier_jobs j
   SET delivery_attempt_no = ordered.rn
  FROM ordered
 WHERE j.id = ordered.id
   AND (j.delivery_attempt_no IS NULL OR j.delivery_attempt_no = 1);

-- Trigger to auto-set attempt_no on INSERT.
-- Counts EXISTING dossier_jobs with the SAME po_numbers array + sev_type
-- (status done|queued|running — failed jobs don't count toward attempt seq
--  so user can retry without bumping the number).
CREATE OR REPLACE FUNCTION set_dossier_attempt_no()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.delivery_attempt_no IS NULL OR NEW.delivery_attempt_no = 1 THEN
        SELECT COALESCE(MAX(delivery_attempt_no), 0) + 1
          INTO NEW.delivery_attempt_no
          FROM bqms_dossier_jobs
         WHERE po_numbers = NEW.po_numbers
           AND sev_type = NEW.sev_type
           AND status IN ('done', 'queued', 'running',
                          'invoice_ready', 'po_downloaded', 'excel_built');
        -- Auto-link to previous attempt
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

DROP TRIGGER IF EXISTS trg_dossier_attempt_no ON bqms_dossier_jobs;
CREATE TRIGGER trg_dossier_attempt_no
    BEFORE INSERT ON bqms_dossier_jobs
    FOR EACH ROW EXECUTE FUNCTION set_dossier_attempt_no();

-- View: 1 row per (PO, attempt) for easy stats + UI history panel.
-- Use unnest() to flatten the po_numbers array since 1 dossier may cover N POs.
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
WHERE j.status IN ('done', 'queued', 'running',
                   'invoice_ready', 'po_downloaded', 'excel_built');

-- GIN index — speeds up `WHERE po_numbers @> ARRAY['PO_X']` queries.
CREATE INDEX IF NOT EXISTS idx_dossier_jobs_po_array
    ON bqms_dossier_jobs USING GIN (po_numbers);

-- Helper index for ordering history per PO
CREATE INDEX IF NOT EXISTS idx_dossier_jobs_attempt
    ON bqms_dossier_jobs (sev_type, delivery_attempt_no, created_at DESC);
