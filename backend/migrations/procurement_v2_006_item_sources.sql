-- ============================================================
-- procurement_v2_006_item_sources.sql  (P1 — Commercial bidding: item sources)
-- ADDITIVE, IDEMPOTENT, re-runnable via: docker cp ... && psql -f.
-- Author: Thang — 2026-06-22
-- DEPLOY: docker cp + psql -f; restart sc-api + sc-worker + sc-scheduler.
--
-- PRE-EXISTING FACTS (verified by reading migrations):
--   * procurement_rfq_items already has (vendor_bidding_phase2_lifecycle.sql):
--       maker, part_no, cis_code, moq, item_deadline, dimension,
--       specification_full, attachments_paths.
--     → specification_full ALREADY covers the "spec" need, so we DO NOT add a new
--       'spec' column (would be a redundant twin). Skipped intentionally.
--   * procurement_rfq_items already has source_bqms_rfq_id (legacy BQMS link) —
--     KEPT; we only add the generic (source_kind, source_ref_id) pair on top and
--     backfill it from the legacy column.
-- ============================================================

BEGIN;

-- ─── 1. procurement_rfq_items — generic item-source provenance ───
-- source_kind = where the line came from when building the RFQ.
-- 'spec' deliberately NOT added (specification_full already covers it).
ALTER TABLE procurement_rfq_items
    ADD COLUMN IF NOT EXISTS source_kind   TEXT DEFAULT 'manual',
    ADD COLUMN IF NOT EXISTS source_ref_id BIGINT,
    ADD COLUMN IF NOT EXISTS item_code     TEXT,
    ADD COLUMN IF NOT EXISTS product_name  TEXT,
    ADD COLUMN IF NOT EXISTS model         TEXT;

-- source_kind CHECK — guarded so re-run is a no-op.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'prfq_item_source_kind_chk'
    ) THEN
        ALTER TABLE procurement_rfq_items
            ADD CONSTRAINT prfq_item_source_kind_chk
            CHECK (source_kind IN ('catalog','paste','manual','bqms','imv','excel'));
    END IF;
END
$$;

-- ─── 2. Backfill from the legacy BQMS link column ───
-- Rows that came from a BQMS RFQ get source_kind='bqms' + source_ref_id from the
-- existing source_bqms_rfq_id. Legacy column is KEPT (not dropped).
UPDATE procurement_rfq_items
   SET source_kind   = 'bqms',
       source_ref_id = source_bqms_rfq_id
 WHERE source_bqms_rfq_id IS NOT NULL
   AND (source_kind IS DISTINCT FROM 'bqms' OR source_ref_id IS DISTINCT FROM source_bqms_rfq_id);

-- Ensure no NULL source_kind (column default only applies to new rows).
UPDATE procurement_rfq_items
   SET source_kind = 'manual'
 WHERE source_kind IS NULL;

-- ─── 3. Indexes (all IF NOT EXISTS) ───
CREATE INDEX IF NOT EXISTS idx_prfq_item_source
    ON procurement_rfq_items(source_kind, source_ref_id);
CREATE INDEX IF NOT EXISTS idx_prfq_item_item_code
    ON procurement_rfq_items(item_code);

COMMIT;

-- ─── VERIFICATION ───
SELECT 'source_kind_breakdown' AS check, source_kind, count(*) AS n
  FROM procurement_rfq_items
 GROUP BY source_kind
 ORDER BY n DESC;
SELECT 'bqms_backfilled' AS check, count(*) AS n
  FROM procurement_rfq_items
 WHERE source_kind = 'bqms' AND source_ref_id IS NOT NULL;
