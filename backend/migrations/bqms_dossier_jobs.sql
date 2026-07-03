-- ============================================================
-- Migration: BQMS delivery dossier jobs (Tạo hồ sơ giao hàng)
-- Date: 2026-05-16 (Thang)
--
-- 1 job = 1 lượt user nhấn "Tạo hồ sơ" trên trang Giao hàng. Job
-- orchestrate scraper Samsung (Register Delivery → Invoice → PO PDFs)
-- + Excel builder (6 sheet template + per-PO Cam kết) + folder save.
--
-- Frontend poll GET /api/v1/bqms/deliveries/dossier-job/{id} mỗi 4s.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS bqms_dossier_jobs (
    id                      BIGSERIAL PRIMARY KEY,
    procrastinate_job_id    BIGINT,
    user_id                 UUID REFERENCES users(id),
    sev_type                TEXT NOT NULL,
                            -- 'SEV' or 'SEVT' — single company per job (multi-company rejected)
    po_numbers              TEXT[] NOT NULL,
                            -- distinct PO numbers in this batch
    delivery_row_ids        BIGINT[] NOT NULL,
                            -- bqms_deliveries.id list (target rows for shipping_no/qty update)
    form_data               JSONB NOT NULL,
                            -- full modal payload: vendor_invoice_no, invoice_date, etd,
                            -- packing_qty/unit, volume/unit, gross_weight/unit, remark,
                            -- shipping_manager, items: [{po_number, po_seq, bqms_code, shipping_qty, ...}]
    shipping_no             TEXT,
                            -- extracted from Invoice PDF (e.g. 3016050264)
    invoice_no              TEXT,
                            -- generated {DDMMYYYY}-{N} (per-day counter)
    status                  TEXT NOT NULL DEFAULT 'queued'
                            CHECK (status IN (
                                'queued','running','invoice_ready','po_downloaded',
                                'excel_built','done','failed'
                            )),
    progress_pct            INT DEFAULT 0,
    progress_step           TEXT,
                            -- human-readable current step for UI poll
    output_folder           TEXT,
                            -- absolute VPS path of created folder
    files                   JSONB,
                            -- {excel, delivery_note, po_pdfs: [{po, path, status}], warnings: []}
    error                   TEXT,
    started_at              TIMESTAMPTZ,
    finished_at             TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dossier_jobs_status
    ON bqms_dossier_jobs(status)
    WHERE status IN ('queued','running','invoice_ready','po_downloaded','excel_built');

CREATE INDEX IF NOT EXISTS idx_dossier_jobs_user
    ON bqms_dossier_jobs(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_dossier_jobs_created
    ON bqms_dossier_jobs(created_at DESC);

-- Auto-update updated_at on row mutation
CREATE OR REPLACE FUNCTION fn_dossier_jobs_touch_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_dossier_jobs_updated_at ON bqms_dossier_jobs;
CREATE TRIGGER trg_dossier_jobs_updated_at
    BEFORE UPDATE ON bqms_dossier_jobs
    FOR EACH ROW
    EXECUTE FUNCTION fn_dossier_jobs_touch_updated_at();

COMMENT ON TABLE bqms_dossier_jobs IS
    'Tạo hồ sơ giao hàng — Job orchestrate Samsung scrape (Register Delivery / PO Receipt) + Excel 6 sheet build cho 1 lượt giao hàng (multiple POs/items cùng SEV/SEVT).';
COMMENT ON COLUMN bqms_dossier_jobs.sev_type IS
    'Single company per job — multi-company batch rejected ở API.';
COMMENT ON COLUMN bqms_dossier_jobs.shipping_no IS
    'Extracted từ Delivery Note PDF qua pdfplumber regex.';
COMMENT ON COLUMN bqms_dossier_jobs.invoice_no IS
    'Generated {DDMMYYYY}-{N} với N counter theo ngày (reset 01 mỗi ngày).';

-- Extend quotation_templates check constraint to accept 'delivery_dossier'
ALTER TABLE quotation_templates DROP CONSTRAINT IF EXISTS quotation_templates_template_type_check;
ALTER TABLE quotation_templates ADD CONSTRAINT quotation_templates_template_type_check
    CHECK (template_type = ANY (ARRAY['cam_ket','commercial','gc','delivery_dossier']));

COMMIT;
