-- ============================================================================
-- Migration: split bqms_deliveries.specification into item_name + specification
-- ============================================================================
--
-- Context
-- -------
-- The Excel/OneDrive source packs two logical fields into one cell using a
-- single newline separator:  "<ItemName>\n<Spec>"
--   e.g.  'JIG-BASE\nPHOI GIA CONG,PVC-U,L130xW20xH12mm,_B'
--         -> item_name = 'JIG-BASE'
--         -> spec      = 'PHOI GIA CONG,PVC-U,L130xW20xH12mm,_B'
--
-- SPLIT RULE (must match the three Python write-paths exactly):
--   item_name = trim(text BEFORE the first '\n')
--   spec      = trim(text AFTER  the first '\n')
--   If there is NO '\n', item_name stays NULL/empty and spec is left unchanged.
--
-- This migration is IDEMPOTENT and SAFE to re-run:
--   * the snapshot is only populated once (NOT EXISTS guard),
--   * the column add uses IF NOT EXISTS,
--   * the backfill UPDATE is guarded so a second run is a no-op.
--
-- ORDER MATTERS: the snapshot INSERT (capturing the PRE-split specification)
-- runs BEFORE the UPDATE so a full rollback is always possible.
-- ============================================================================

-- 1. Snapshot for rollback ---------------------------------------------------
--    Captures the ORIGINAL (pre-split) specification keyed by row id.
--    WITH NO DATA creates the structure only; the INSERT below populates it
--    exactly once. To roll back:
--      UPDATE bqms_deliveries d
--         SET specification = b.specification, item_name = NULL
--        FROM bqms_deliveries_spec_bak b
--       WHERE b.id = d.id;
CREATE TABLE IF NOT EXISTS bqms_deliveries_spec_bak AS
    SELECT id, specification FROM bqms_deliveries WITH NO DATA;

INSERT INTO bqms_deliveries_spec_bak (id, specification)
    SELECT id, specification
      FROM bqms_deliveries
     WHERE NOT EXISTS (
         SELECT 1 FROM bqms_deliveries_spec_bak b
          WHERE b.id = bqms_deliveries.id
     );

-- 2. Add the new column ------------------------------------------------------
ALTER TABLE bqms_deliveries ADD COLUMN IF NOT EXISTS item_name TEXT;

-- 3. Backfill split ----------------------------------------------------------
--    Only touches rows that still hold the combined value: item_name is unset
--    AND the specification contains a newline. Rows without a newline are left
--    untouched (item_name stays NULL, specification unchanged). The
--    `item_name IS NULL` guard makes a re-run a no-op.
UPDATE bqms_deliveries
   SET item_name     = NULLIF(btrim(split_part(specification, E'\n', 1)), ''),
       specification = btrim(substring(specification from position(E'\n' in specification) + 1))
 WHERE item_name IS NULL
   AND specification IS NOT NULL
   AND position(E'\n' in specification) > 0;
