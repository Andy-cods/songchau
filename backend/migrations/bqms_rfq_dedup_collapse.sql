-- =============================================================================
-- BQMS RFQ dedup collapse + unique constraint  (GATED — OWNER REVIEW ONLY)
-- Thang 2026-06-17 — Plan: "Batch 2B" → "Dedup tận gốc".
--
-- ⚠️⚠️⚠️  THIS FILE IS DESTRUCTIVE AND IS *NOT* AUTO-RUN.  ⚠️⚠️⚠️
--   Every destructive statement below is COMMENTED OUT on purpose. It exists so
--   the owner (Thang) can review the collapse strategy, run the PRECHECK first,
--   eyeball the duplicate set, and only then uncomment + run section by section
--   inside a transaction with a fresh DB backup in hand.
--
-- WHY IT'S SEPARATE FROM bqms_vround_tracking.sql
--   bqms_vround_tracking.sql is additive + safe to auto-apply. Collapsing the
--   shadow-twin rows and swapping the unique key is a one-way data migration:
--   it merges rows and can lose user-action data if COALESCE order is wrong.
--   Keeping it gated prevents the staged build from ever mutating data.
--
-- BACKGROUND (from MEMORY: "BQMS RFQ Dup Rows")
--   ~116 (rfq_number,bqms_code) pairs are duplicated: one row written by the ETL
--   bidding scraper, a twin written by onedrive_sync. The onedrive twin often
--   SHADOWS the etl twin in queries. The rfq-table endpoint already works around
--   this with a bqms_dedup CTE (DISTINCT ON ordered by quote_unlocked DESC +
--   bqms_push_status DESC). This file would collapse them PHYSICALLY so both
--   writers can UPSERT ON CONFLICT into a single canonical row.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- PRECHECK (SELECT-only — SAFE to run now). Find the dupes before touching them.
-- ---------------------------------------------------------------------------
-- PRECHECK: how many (rfq_number,bqms_code) pairs have >1 physical row?
SELECT rfq_number, bqms_code, COUNT(*) AS row_count,
       array_agg(id ORDER BY id) AS ids,
       array_agg(data_source ORDER BY id) AS data_sources,
       bool_or(quote_unlocked) AS any_unlocked,
       bool_or(quoted_price_bqms_v1 IS NOT NULL) AS any_v1_priced
  FROM bqms_rfq
 WHERE rfq_number IS NOT NULL AND bqms_code IS NOT NULL
 GROUP BY rfq_number, bqms_code
HAVING COUNT(*) > 1
 ORDER BY row_count DESC, rfq_number;

-- PRECHECK: total duplicate rows that would be removed (= sum(row_count-1)).
-- SELECT COALESCE(SUM(cnt - 1), 0) AS rows_to_remove
--   FROM (
--       SELECT COUNT(*) AS cnt
--         FROM bqms_rfq
--        WHERE rfq_number IS NOT NULL AND bqms_code IS NOT NULL
--        GROUP BY rfq_number, bqms_code
--       HAVING COUNT(*) > 1
--   ) d;


-- ---------------------------------------------------------------------------
-- STEP 1 — COLLAPSE TWINS  (DESTRUCTIVE — keep commented until reviewed).
--   Strategy: pick the "winner" per (rfq_number,bqms_code) = the user-actioned
--   row (DISTINCT ON ordered by quote_unlocked DESC, bqms_push_status priority,
--   quoted_price_bqms_v1 NOT NULL DESC, id ASC). COALESCE user-action columns
--   from the losers INTO the winner so nothing the user typed is lost, THEN
--   delete the losers. NEVER overwrite a non-NULL winner column with a loser's
--   value (COALESCE(winner, loser)).
-- ---------------------------------------------------------------------------
-- BEGIN;
--
-- WITH ranked AS (
--     SELECT id, rfq_number, bqms_code,
--            ROW_NUMBER() OVER (
--                PARTITION BY rfq_number, bqms_code
--                ORDER BY quote_unlocked DESC NULLS LAST,
--                         (bqms_push_status IS NOT NULL) DESC,
--                         (quoted_price_bqms_v1 IS NOT NULL) DESC,
--                         id ASC
--            ) AS rn
--       FROM bqms_rfq
--      WHERE rfq_number IS NOT NULL AND bqms_code IS NOT NULL
-- ),
-- winners AS (SELECT id, rfq_number, bqms_code FROM ranked WHERE rn = 1),
-- losers  AS (SELECT id, rfq_number, bqms_code FROM ranked WHERE rn > 1),
-- merged AS (
--     -- Aggregate the user-action columns across the loser twins.
--     SELECT w.id AS winner_id,
--            -- first non-null among losers for each user-action column:
--            (array_remove(array_agg(l.quoted_price_bqms_v1), NULL))[1] AS l_v1,
--            (array_remove(array_agg(l.quoted_price_bqms_v2), NULL))[1] AS l_v2,
--            (array_remove(array_agg(l.quoted_price_bqms_v3), NULL))[1] AS l_v3,
--            (array_remove(array_agg(l.quoted_price_bqms_v4), NULL))[1] AS l_v4,
--            bool_or(l.quote_unlocked) AS l_unlocked,
--            (array_remove(array_agg(l.result::text), NULL))[1] AS l_result,
--            (array_remove(array_agg(l.notes), NULL))[1] AS l_notes
--       FROM winners w
--       JOIN losers l USING (rfq_number, bqms_code)
--      GROUP BY w.id
-- )
-- UPDATE bqms_rfq r
--    SET quoted_price_bqms_v1 = COALESCE(r.quoted_price_bqms_v1, m.l_v1),
--        quoted_price_bqms_v2 = COALESCE(r.quoted_price_bqms_v2, m.l_v2),
--        quoted_price_bqms_v3 = COALESCE(r.quoted_price_bqms_v3, m.l_v3),
--        quoted_price_bqms_v4 = COALESCE(r.quoted_price_bqms_v4, m.l_v4),
--        quote_unlocked       = COALESCE(r.quote_unlocked, false) OR COALESCE(m.l_unlocked, false),
--        notes                = COALESCE(r.notes, m.l_notes)
--   FROM merged m
--  WHERE r.id = m.winner_id;
--
-- -- Re-point any child rows that soft-reference the loser ids BEFORE deleting,
-- -- if such FKs exist (bqms_quote_log.rfq_id, etc). Verify with the owner which
-- -- tables carry rfq_id and add UPDATE ... SET rfq_id = winner_id here.
--
-- DELETE FROM bqms_rfq
--  WHERE id IN (
--      SELECT id FROM (
--          SELECT id,
--                 ROW_NUMBER() OVER (
--                     PARTITION BY rfq_number, bqms_code
--                     ORDER BY quote_unlocked DESC NULLS LAST,
--                              (bqms_push_status IS NOT NULL) DESC,
--                              (quoted_price_bqms_v1 IS NOT NULL) DESC,
--                              id ASC
--                 ) AS rn
--            FROM bqms_rfq
--           WHERE rfq_number IS NOT NULL AND bqms_code IS NOT NULL
--      ) z
--      WHERE z.rn > 1
--  );
--
-- COMMIT;


-- ---------------------------------------------------------------------------
-- STEP 2 — UNIQUE CONSTRAINT  (DESTRUCTIVE/locking — run only AFTER step 1 is
--   verified to leave zero remaining duplicates by re-running the PRECHECK).
--   After this, both writers (etl bidding scraper + onedrive_sync) can switch
--   from SELECT-then-UPSERT to a real INSERT ... ON CONFLICT (rfq_number,
--   bqms_code) DO UPDATE that COALESCEs user-action columns.
-- ---------------------------------------------------------------------------
-- BEGIN;
-- -- partial unique index is fine since both columns are required for a real RFQ:
-- CREATE UNIQUE INDEX IF NOT EXISTS uq_bqms_rfq_rfq_code
--     ON bqms_rfq (rfq_number, bqms_code)
--     WHERE rfq_number IS NOT NULL AND bqms_code IS NOT NULL;
-- COMMIT;
-- =============================================================================
