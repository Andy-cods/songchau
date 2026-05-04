\set ON_ERROR_STOP on
BEGIN;

-- Step 1: Backup tables (snapshot for rollback)
DROP TABLE IF EXISTS bqms_rfq_archive_pre2026;
CREATE TABLE bqms_rfq_archive_pre2026 AS
  SELECT * FROM bqms_rfq
  WHERE inquiry_date IS NULL OR inquiry_date < '2026-01-01';

DROP TABLE IF EXISTS bqms_deliveries_archive_pre2026;
CREATE TABLE bqms_deliveries_archive_pre2026 AS
  SELECT * FROM bqms_deliveries
  WHERE po_date IS NULL OR po_date < '2026-01-01';

-- Step 2: NULL out FK refs from non-RFQ tables that point to soon-deleted RFQs
WITH old AS (
  SELECT id FROM bqms_rfq
  WHERE inquiry_date IS NULL OR inquiry_date < '2026-01-01'
)
UPDATE bqms_samsung_po SET rfq_id = NULL
WHERE rfq_id IN (SELECT id FROM old);

-- bqms_quote_log.rfq_id is NOT NULL, so we DELETE the 2 quote_log rows
-- pointing to soon-deleted RFQs (they were test entries during earlier
-- inline-edit testing; no business value).
WITH old AS (
  SELECT id FROM bqms_rfq
  WHERE inquiry_date IS NULL OR inquiry_date < '2026-01-01'
)
DELETE FROM bqms_quote_log
WHERE rfq_id IN (SELECT id FROM old);

-- Step 3: DELETE pre-2026 RFQ
DELETE FROM bqms_rfq
WHERE inquiry_date IS NULL OR inquiry_date < '2026-01-01';

-- Step 4: DELETE pre-2026 Deliveries
DELETE FROM bqms_deliveries
WHERE po_date IS NULL OR po_date < '2026-01-01';

-- Step 5: Report
SELECT 'archive_rfq_rows'        AS k, COUNT(*)::text AS v FROM bqms_rfq_archive_pre2026
UNION ALL SELECT 'archive_del_rows',  COUNT(*)::text FROM bqms_deliveries_archive_pre2026
UNION ALL SELECT 'remaining_rfq',     COUNT(*)::text FROM bqms_rfq
UNION ALL SELECT 'remaining_del',     COUNT(*)::text FROM bqms_deliveries
UNION ALL SELECT 'po_orphan_now',     COUNT(*)::text FROM bqms_samsung_po WHERE rfq_id IS NULL
UNION ALL SELECT 'po_with_rfq_link',  COUNT(*)::text FROM bqms_samsung_po WHERE rfq_id IS NOT NULL;

COMMIT;
