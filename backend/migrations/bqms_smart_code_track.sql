-- BQMS Smart Code-Track — per-row gap audit + heal-attempt ledger.
-- Phase G (Thang 2026-05-13): hidden continuous engine, runs every 3 min via
-- cron task 'bqms_smart_code_track'. Sits alongside (does not replace) the
-- existing 5-min `bqms_smart_rescan` and 30-min `bqms_periodic_scrape`.

CREATE TABLE IF NOT EXISTS bqms_row_gaps (
    id              BIGSERIAL PRIMARY KEY,
    rfq_number      TEXT NOT NULL,                -- e.g. QT26000123
    rfq_id          BIGINT,                       -- soft FK to bqms_rfq.id (NULL if RFQ row not yet split)
    staging_id      BIGINT,                       -- soft FK to bqms_vendor_portal_staging.id
    gap_type        TEXT NOT NULL,
    evidence        JSONB NOT NULL DEFAULT '{}'::jsonb,
    detected_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_attempt_at TIMESTAMPTZ,
    drill_attempts  INT NOT NULL DEFAULT 0,
    healed_at       TIMESTAMPTZ,
    last_error      TEXT,
    CONSTRAINT bqms_row_gaps_gap_type_chk CHECK (
        gap_type IN ('d1_metadata_null','d2_items_mismatch','d3_folder_missing',
                     'd4_subfolder_missing','d5_all_image_tiers_empty',
                     'd6_override_stale','d7_folder_name_legacy',
                     'd8_orphan_folder_old','d9_item_type_null','d10_orphan_image')
    )
);

-- Hot path: cooldown check every 3 minutes
CREATE INDEX IF NOT EXISTS idx_bqms_row_gaps_rfq_lastattempt
    ON bqms_row_gaps (rfq_number, last_attempt_at DESC);

-- Open gaps for dedup at detector layer
CREATE INDEX IF NOT EXISTS idx_bqms_row_gaps_open
    ON bqms_row_gaps (gap_type, rfq_number) WHERE healed_at IS NULL;

-- Recent heals for /data-gaps/healing-log endpoint
CREATE INDEX IF NOT EXISTS idx_bqms_row_gaps_healed
    ON bqms_row_gaps (healed_at DESC) WHERE healed_at IS NOT NULL;

COMMENT ON TABLE  bqms_row_gaps IS 'Smart Code-Track audit ledger — one row per (rfq,gap_type) detection. healed_at=NULL means still open.';
COMMENT ON COLUMN bqms_row_gaps.gap_type IS '10 known kinds — see app/services/bqms_gap_detector.py GAP_TYPES.';
COMMENT ON COLUMN bqms_row_gaps.evidence IS 'JSONB free-form: {field:..., null_count:..., file:..., suggested_match:...}';
