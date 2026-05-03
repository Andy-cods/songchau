\set ON_ERROR_STOP on
BEGIN;

-- Step 1: reassign FK in bqms_samsung_po (231 rows expected)
WITH d AS (
  SELECT source_hash, MIN(id) AS keeper FROM bqms_rfq
  WHERE source_hash IS NOT NULL
  GROUP BY source_hash HAVING COUNT(*) > 1
),
mapping AS (
  SELECT r.id AS bad_id, d.keeper FROM bqms_rfq r
  JOIN d ON r.source_hash = d.source_hash
  WHERE r.id <> d.keeper
)
UPDATE bqms_samsung_po po
SET rfq_id = m.keeper
FROM mapping m
WHERE po.rfq_id = m.bad_id;

-- Step 2: delete dup rows (3877 expected)
WITH d AS (
  SELECT source_hash, MIN(id) AS keeper FROM bqms_rfq
  WHERE source_hash IS NOT NULL
  GROUP BY source_hash HAVING COUNT(*) > 1
)
DELETE FROM bqms_rfq r USING d
WHERE r.source_hash = d.source_hash AND r.id <> d.keeper;

-- Step 3: drop old non-unique hash index if exists, create unique on triple
DROP INDEX IF EXISTS idx_bqms_rfq_hash;
CREATE UNIQUE INDEX IF NOT EXISTS uq_bqms_rfq_dedup
  ON bqms_rfq (rfq_number, bqms_code, source_hash);

-- Step 4: report
SELECT 'rows_after_dedup' AS what, COUNT(*)::text AS val FROM bqms_rfq
UNION ALL SELECT 'distinct_hash', COUNT(DISTINCT source_hash)::text FROM bqms_rfq
UNION ALL SELECT 'samsung_po_bound', COUNT(*)::text FROM bqms_samsung_po WHERE rfq_id IS NOT NULL
UNION ALL SELECT 'samsung_po_orphan', COUNT(*)::text FROM bqms_samsung_po po
  WHERE rfq_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM bqms_rfq r WHERE r.id=po.rfq_id);

COMMIT;
