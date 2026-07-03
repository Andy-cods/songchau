-- Global Search Optimization (Thang 2026-05-22)
--
-- Make `/api/v1/search/global` fast for BQMS code paste lookups.
--
-- Problem before:
--   /price-lookup/search used REGEXP_REPLACE(bqms_code, ...) LIKE %...% which
--   forced a full-table scan on bqms_rfq (no index could be used because the
--   column was wrapped in a function).
--
-- Fix:
--   1. Add a generated column `bqms_code_norm` (UPPER + strip non-alnum) →
--      can be indexed for fast prefix matching.
--   2. pg_trgm extension + GIN trigram indexes for fuzzy contains-match across
--      bqms_rfq, bqms_deliveries, bqms_won_quotations, bqms_samsung_po,
--      suppliers, purchase_orders.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── bqms_rfq ────────────────────────────────────────────────────────────────
ALTER TABLE bqms_rfq
    ADD COLUMN IF NOT EXISTS bqms_code_norm TEXT
    GENERATED ALWAYS AS (
        REGEXP_REPLACE(UPPER(COALESCE(bqms_code, '')), '[^A-Z0-9]', '', 'g')
    ) STORED;

CREATE INDEX IF NOT EXISTS idx_brfq_code_norm
    ON bqms_rfq (bqms_code_norm)
    WHERE bqms_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_brfq_code_trgm
    ON bqms_rfq USING GIN (bqms_code gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_brfq_rfq_no_trgm
    ON bqms_rfq USING GIN (rfq_number gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_brfq_spec_trgm
    ON bqms_rfq USING GIN (specification gin_trgm_ops);

-- ── bqms_deliveries ────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_bdel_code_trgm
    ON bqms_deliveries USING GIN (bqms_code gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_bdel_po_trgm
    ON bqms_deliveries USING GIN (po_number gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_bdel_ship_trgm
    ON bqms_deliveries USING GIN (shipping_no gin_trgm_ops);

-- ── bqms_won_quotations ────────────────────────────────────────────────────
-- Table may not exist on all installs; wrap in DO block.
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'bqms_won_quotations') THEN
        CREATE INDEX IF NOT EXISTS idx_bwq_code_trgm
            ON bqms_won_quotations USING GIN (bqms_code gin_trgm_ops);
        CREATE INDEX IF NOT EXISTS idx_bwq_rfq_trgm
            ON bqms_won_quotations USING GIN (rfq_number gin_trgm_ops);
    END IF;
END $$;

-- ── bqms_samsung_po ────────────────────────────────────────────────────────
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'bqms_samsung_po') THEN
        CREATE INDEX IF NOT EXISTS idx_bspo_code_trgm
            ON bqms_samsung_po USING GIN (bqms_code gin_trgm_ops);
        CREATE INDEX IF NOT EXISTS idx_bspo_po_trgm
            ON bqms_samsung_po USING GIN (po_number gin_trgm_ops);
    END IF;
END $$;

-- ── suppliers ──────────────────────────────────────────────────────────────
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'suppliers') THEN
        CREATE INDEX IF NOT EXISTS idx_sup_name_trgm
            ON suppliers USING GIN (name gin_trgm_ops);
    END IF;
END $$;

-- ── ANALYZE so query planner picks up the new indexes ──────────────────────
ANALYZE bqms_rfq;
ANALYZE bqms_deliveries;
