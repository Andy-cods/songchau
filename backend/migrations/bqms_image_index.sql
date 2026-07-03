-- Smart image index for BQMS dossier feature (M40+M41 — Thang 2026-05-18)
-- One row per (bqms_code, image_path). Crawler upserts on each scan.

CREATE TABLE IF NOT EXISTS bqms_image_index (
    id           BIGSERIAL PRIMARY KEY,
    bqms_code    TEXT NOT NULL,
    image_path   TEXT NOT NULL,
    source       TEXT NOT NULL,                   -- 'rfq', 'override', 'product', 'quote'
    rfq_number   TEXT,
    file_size    BIGINT,
    mtime        TIMESTAMPTZ,
    indexed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (bqms_code, image_path)
);

-- Fast lookup by code
CREATE INDEX IF NOT EXISTS idx_bii_bqms_code      ON bqms_image_index (bqms_code);
-- Source filter (prefer override > rfq)
CREATE INDEX IF NOT EXISTS idx_bii_source         ON bqms_image_index (source);
-- For pruning stale entries (file deleted)
CREATE INDEX IF NOT EXISTS idx_bii_indexed_at     ON bqms_image_index (indexed_at);

-- Helper view: best image per bqms_code (priority: override > quote > rfq > product)
CREATE OR REPLACE VIEW v_bqms_best_image AS
SELECT DISTINCT ON (bqms_code)
    bqms_code,
    image_path,
    source,
    rfq_number,
    file_size,
    mtime
FROM bqms_image_index
ORDER BY bqms_code,
         CASE source WHEN 'override' THEN 1
                     WHEN 'quote'    THEN 2
                     WHEN 'rfq'      THEN 3
                     WHEN 'product'  THEN 4
                     ELSE 5 END,
         mtime DESC NULLS LAST,
         file_size DESC NULLS LAST;
