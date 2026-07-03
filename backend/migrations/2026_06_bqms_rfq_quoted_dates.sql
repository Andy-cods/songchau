-- Thang 2026-06-13: per-round quote dates on bqms_rfq.
-- Track WHEN each V1/V2/V3/V4 price was submitted so UI can render chips
-- "V1: 13/06" / "V2: 18/06" etc on the BQMS table. Also feeds quote-date
-- auto-fill in XLSX templates (autofill_service writes today's date to
-- cell C4; persisting it here lets us pin the exact submission date if a
-- user re-opens an old quote).
--
-- Pattern: ADDITIVE only. No backfill from quote_log because some old V1
-- prices predate bqms_quote_log; leaving NULL = "unknown" is safe.

BEGIN;

ALTER TABLE bqms_rfq
    ADD COLUMN IF NOT EXISTS quoted_dt_v1 DATE,
    ADD COLUMN IF NOT EXISTS quoted_dt_v2 DATE,
    ADD COLUMN IF NOT EXISTS quoted_dt_v3 DATE,
    ADD COLUMN IF NOT EXISTS quoted_dt_v4 DATE;

COMMENT ON COLUMN bqms_rfq.quoted_dt_v1 IS
    'Ngày user nhấn báo giá V1 (set khi quoted_price_bqms_v1 chuyển từ NULL→giá trị). '
    'Hiển thị trên BQMS table và pinned vào cell C4 của XLSX quotation.';
COMMENT ON COLUMN bqms_rfq.quoted_dt_v2 IS 'Ngày user submit báo giá V2.';
COMMENT ON COLUMN bqms_rfq.quoted_dt_v3 IS 'Ngày user submit báo giá V3.';
COMMENT ON COLUMN bqms_rfq.quoted_dt_v4 IS 'Ngày user submit báo giá V4.';

-- Optional: backfill quoted_dt_v1 from bqms_quote_log (round=1 rows) so old
-- rows show SOMETHING instead of NULL. Use MIN() in case the user re-quoted.
UPDATE bqms_rfq r
   SET quoted_dt_v1 = sub.first_quoted_at::date
  FROM (
        SELECT rfq_id, MIN(created_at) AS first_quoted_at
          FROM bqms_quote_log
         WHERE round = 1
         GROUP BY rfq_id
       ) sub
 WHERE sub.rfq_id = r.id
   AND r.quoted_dt_v1 IS NULL
   AND r.quoted_price_bqms_v1 IS NOT NULL;

UPDATE bqms_rfq r
   SET quoted_dt_v2 = sub.first_quoted_at::date
  FROM (
        SELECT rfq_id, MIN(created_at) AS first_quoted_at
          FROM bqms_quote_log
         WHERE round = 2
         GROUP BY rfq_id
       ) sub
 WHERE sub.rfq_id = r.id
   AND r.quoted_dt_v2 IS NULL
   AND r.quoted_price_bqms_v2 IS NOT NULL;

UPDATE bqms_rfq r
   SET quoted_dt_v3 = sub.first_quoted_at::date
  FROM (
        SELECT rfq_id, MIN(created_at) AS first_quoted_at
          FROM bqms_quote_log
         WHERE round = 3
         GROUP BY rfq_id
       ) sub
 WHERE sub.rfq_id = r.id
   AND r.quoted_dt_v3 IS NULL
   AND r.quoted_price_bqms_v3 IS NOT NULL;

UPDATE bqms_rfq r
   SET quoted_dt_v4 = sub.first_quoted_at::date
  FROM (
        SELECT rfq_id, MIN(created_at) AS first_quoted_at
          FROM bqms_quote_log
         WHERE round = 4
         GROUP BY rfq_id
       ) sub
 WHERE sub.rfq_id = r.id
   AND r.quoted_dt_v4 IS NULL
   AND r.quoted_price_bqms_v4 IS NOT NULL;

COMMIT;
