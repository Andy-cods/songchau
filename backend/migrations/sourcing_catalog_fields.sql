-- ============================================================
-- Migration: Extend sourcing_entries with PIM catalog fields
-- Date: 2026-06-03 (Thang) — RFQ Library / Thư viện nguồn cung
--
-- Migrate ~14k rows từ Google Sheet "PIM of Thong ke hoi hang" vào DB.
-- Add 12 cột mới (catalog/brand/stage/status) + 8 indexes cho bulk-lookup
-- nhanh ≤ 200ms với 500 codes.
--
-- Pattern: extend `/sourcing` module hiện có (live 23/05) thay vì tạo
-- `rfq_library` mới. Bảo toàn CodeHistoryDrawer integration + multi-supplier
-- compare đã có sẵn.
-- ============================================================

BEGIN;

-- Extension cho trigram fuzzy search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE sourcing_entries
    ADD COLUMN IF NOT EXISTS catalog_category TEXT,
    ADD COLUMN IF NOT EXISTS brand_canonical  TEXT,
    ADD COLUMN IF NOT EXISTS part_type        TEXT,
    ADD COLUMN IF NOT EXISTS subcategory_slug TEXT,
    ADD COLUMN IF NOT EXISTS machine_model    TEXT,
    ADD COLUMN IF NOT EXISTS internal_part_no TEXT,
    ADD COLUMN IF NOT EXISTS normalized_model TEXT,
    ADD COLUMN IF NOT EXISTS catalog_status   TEXT,
    ADD COLUMN IF NOT EXISTS stage            SMALLINT,
    ADD COLUMN IF NOT EXISTS missing_fields   TEXT[],
    ADD COLUMN IF NOT EXISTS missing_count    SMALLINT DEFAULT 0,
    ADD COLUMN IF NOT EXISTS customer_id      BIGINT REFERENCES customers(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS deleted_at       TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS notes_internal   TEXT,
    -- GENERATED model_norm: UPPER + strip non-alphanumeric
    -- Dùng cho exact lookup nhanh (B-tree) + dedup
    ADD COLUMN IF NOT EXISTS model_norm       TEXT
        GENERATED ALWAYS AS (
            REGEXP_REPLACE(UPPER(COALESCE(model, '')), '[^A-Z0-9]', '', 'g')
        ) STORED;

-- CHECK constraints — chỉ add nếu chưa có (idempotent)
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'sourcing_entries_catalog_status_check'
    ) THEN
        ALTER TABLE sourcing_entries
            ADD CONSTRAINT sourcing_entries_catalog_status_check
            CHECK (catalog_status IS NULL OR catalog_status IN (
                'OK', 'NEEDS_BRAND', 'NOT_IN_CATALOG', 'PRODUCT_CANDIDATE'
            ));
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'sourcing_entries_stage_check'
    ) THEN
        ALTER TABLE sourcing_entries
            ADD CONSTRAINT sourcing_entries_stage_check
            CHECK (stage IS NULL OR stage IN (1, 2, 3));
    END IF;
END $$;

-- ─── Indexes for fast bulk-lookup + filtering ───────────────────

-- B-tree exact lookup theo model_norm (cho bulk-lookup paste 500 mã)
CREATE INDEX IF NOT EXISTS idx_se_model_norm
    ON sourcing_entries (model_norm)
    WHERE deleted_at IS NULL AND model_norm <> '';

-- B-tree composite: model_norm + inquiry_date DESC (DISTINCT ON latest)
CREATE INDEX IF NOT EXISTS idx_se_model_norm_inq
    ON sourcing_entries (model_norm, inquiry_date DESC NULLS LAST)
    WHERE deleted_at IS NULL AND model_norm <> '';

-- GIN trigram cho fuzzy search (model + product_name)
CREATE INDEX IF NOT EXISTS idx_se_model_trgm
    ON sourcing_entries USING GIN (model gin_trgm_ops)
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_se_product_name_trgm
    ON sourcing_entries USING GIN (product_name gin_trgm_ops)
    WHERE deleted_at IS NULL;

-- Filter dropdowns
CREATE INDEX IF NOT EXISTS idx_se_catalog_cat
    ON sourcing_entries (catalog_category)
    WHERE deleted_at IS NULL AND catalog_category IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_se_brand_canon
    ON sourcing_entries (brand_canonical)
    WHERE deleted_at IS NULL AND brand_canonical IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_se_stage_status
    ON sourcing_entries (stage, catalog_status)
    WHERE deleted_at IS NULL;

-- Customer link (FK lookup)
CREATE INDEX IF NOT EXISTS idx_se_customer_id
    ON sourcing_entries (customer_id, inquiry_date DESC NULLS LAST)
    WHERE deleted_at IS NULL AND customer_id IS NOT NULL;

-- Recent activity (KPI cards)
CREATE INDEX IF NOT EXISTS idx_se_recent
    ON sourcing_entries (inquiry_date DESC NULLS LAST)
    WHERE deleted_at IS NULL;

-- Update stats
ANALYZE sourcing_entries;

COMMENT ON COLUMN sourcing_entries.model_norm IS
    'GENERATED: UPPER + strip non-alphanumeric. Dùng cho bulk-lookup exact match.';
COMMENT ON COLUMN sourcing_entries.catalog_status IS
    'OK=có đủ thông tin / NEEDS_BRAND=thiếu brand / NOT_IN_CATALOG=mã rời rạc / PRODUCT_CANDIDATE=chưa enrich';
COMMENT ON COLUMN sourcing_entries.stage IS
    '1=raw RFQ, 2=enriched, 3=ready để gửi báo giá';
COMMENT ON COLUMN sourcing_entries.missing_fields IS
    'TEXT[] tên các field còn trống — auto-compute lúc INSERT/UPDATE';
COMMENT ON COLUMN sourcing_entries.deleted_at IS
    'Soft-delete. NULL = active. Filtered ra khỏi mọi index.';

COMMIT;
