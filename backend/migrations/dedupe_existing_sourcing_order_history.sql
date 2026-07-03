-- ============================================================
-- BUG DATA-1 CLEANUP: Dedupe existing duplicate status_history rows
-- Date: 2026-06-03 (Thang)
--
-- One-shot cleanup. MUST be run AFTER sourcing_orders_drop_history_trigger.sql
-- so no new duplicates can be introduced mid-flight.
--
-- Strategy:
--   * Identify pairs of consecutive rows for the same (order_id, status)
--     written within 5 seconds of each other.
--   * Keep the app-written row (by_user_id IS NOT NULL — has full context).
--   * Delete the trigger-written row (by_user_id IS NULL).
--
-- This script is wrapped in a TRANSACTION with explicit COUNT-before /
-- COUNT-after verification so the operator can sanity-check the delta
-- before COMMIT. The deploy runner SHOULD pipe the result and ROLLBACK
-- if the delta looks wrong (e.g. > 50% of rows about to be deleted).
-- ============================================================

BEGIN;

-- Snapshot counts before
SELECT
    'BEFORE' AS phase,
    COUNT(*) AS total_rows,
    COUNT(*) FILTER (WHERE by_user_id IS NULL)     AS rows_no_user_id,
    COUNT(*) FILTER (WHERE by_user_id IS NOT NULL) AS rows_with_user_id
FROM sourcing_order_status_history;

-- Stage: find duplicate IDs to delete
WITH dups AS (
    SELECT id, order_id, status, by_user_email, at,
           LAG(at) OVER (PARTITION BY order_id, status ORDER BY id) AS prev_at,
           LAG(id) OVER (PARTITION BY order_id, status ORDER BY id) AS prev_id
      FROM sourcing_order_status_history
)
DELETE FROM sourcing_order_status_history
 WHERE id IN (
     SELECT id FROM dups
      WHERE prev_at IS NOT NULL
        AND at - prev_at < INTERVAL '5 seconds'
        -- Keep app-written row (by_user_id populated); delete trigger-written
        -- row (by_user_id NULL).
        AND id IN (
            SELECT id FROM sourcing_order_status_history WHERE by_user_id IS NULL
        )
 );

-- Snapshot counts after
SELECT
    'AFTER' AS phase,
    COUNT(*) AS total_rows,
    COUNT(*) FILTER (WHERE by_user_id IS NULL)     AS rows_no_user_id,
    COUNT(*) FILTER (WHERE by_user_id IS NOT NULL) AS rows_with_user_id
FROM sourcing_order_status_history;

-- Operator action:
--   * If counts look correct → COMMIT;
--   * Otherwise → ROLLBACK;
COMMIT;
