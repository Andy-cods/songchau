-- Staging table for raw Vendor Portal scrape output.
-- Per user 2026-05-08: scraper writes here for human review BEFORE
-- merging into the canonical bqms_won_quotations / bqms_samsung_po
-- tables. Only rows with status='approved' are merged into prod.

CREATE TABLE IF NOT EXISTS bqms_vendor_portal_staging (
    id              BIGSERIAL PRIMARY KEY,
    scraped_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    scrape_run_id   UUID NOT NULL,                       -- groups rows from a single run
    module          TEXT NOT NULL,                       -- 'contract' | 'po' | 'bidding'
    rfq_number      TEXT,                                -- Request Number (Basic Info)
    contract_no     TEXT,                                -- Số Contract Subject
    contract_period TEXT,                                -- "YYYY-MM-DD ~ YYYY-MM-DD" raw
    item_code       TEXT,                                -- BQMS code per item row
    description     TEXT,
    specification   TEXT,
    quantity        NUMERIC,
    unit            TEXT,
    raw_json        JSONB NOT NULL DEFAULT '{}'::jsonb,  -- full extracted blob per row
    status          TEXT NOT NULL DEFAULT 'pending_review',  -- 'pending_review' | 'approved' | 'rejected' | 'merged'
    review_notes    TEXT,
    reviewed_by     UUID,                                -- references users(id) — soft FK
    reviewed_at     TIMESTAMPTZ,
    merged_at       TIMESTAMPTZ,                         -- when row got copied to prod
    error_message   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bvps_run    ON bqms_vendor_portal_staging (scrape_run_id);
CREATE INDEX IF NOT EXISTS idx_bvps_status ON bqms_vendor_portal_staging (status);
CREATE INDEX IF NOT EXISTS idx_bvps_module ON bqms_vendor_portal_staging (module);
CREATE INDEX IF NOT EXISTS idx_bvps_rfq    ON bqms_vendor_portal_staging (rfq_number);

COMMENT ON TABLE  bqms_vendor_portal_staging IS 'Raw scrape output from sec-bqms.com vendor portal — human-reviewed before merge.';
COMMENT ON COLUMN bqms_vendor_portal_staging.module IS 'Source area: contract | po | bidding';
COMMENT ON COLUMN bqms_vendor_portal_staging.status IS 'pending_review (default after scrape) | approved | rejected | merged';
