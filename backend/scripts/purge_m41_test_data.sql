-- ============================================================
-- Purge M41 (Attendance + Leave) test data after smoke testing.
-- Date: 2026-05-06
--
-- Run AFTER smoke-test runs to wipe rows so production data starts clean.
-- Safe to re-run; idempotent.
--
-- Usage:
--   psql "$DATABASE_URL" -f purge_m41_test_data.sql
-- ============================================================

BEGIN;

-- 1. attendance_incidents (created during smoke test)
TRUNCATE TABLE attendance_incidents RESTART IDENTITY;

-- 2. leave_requests created during smoke test (only those still pending or
--    cancelled are wiped — keep approved ones in case Thang already approved
--    real requests during the test window).
DELETE FROM leave_requests
WHERE status IN ('pending', 'cancelled', 'rejected')
  AND created_at >= NOW() - INTERVAL '1 day';

-- 3. leave_balance — reset all to zero used (totals snapshot stays).
UPDATE leave_balance SET
    annual_used    = 0,
    sick_used      = 0,
    personal_used  = 0,
    maternity_used = 0,
    other_used     = 0;

-- 4. notifications created by leave/attendance flow during smoke test
DELETE FROM notifications
WHERE type IN ('leave_request', 'leave_approved', 'leave_rejected', 'leave_cancelled')
  AND created_at >= NOW() - INTERVAL '1 day';

-- 5. KPI rows that picked up the smoke-test attendance numbers should be
--    recomputed; safest is to wipe like M40 cleanup does. Run M40 cleanup
--    AFTER this if the aggregator was triggered during smoke testing.
--    (Not done here automatically — destructive on the M40 KPI data.)

-- 6. Verify
SELECT 'attendance_incidents' AS tbl, COUNT(*) AS rows FROM attendance_incidents
UNION ALL
SELECT 'leave_requests (recent pending/cancelled)', COUNT(*)
FROM leave_requests WHERE status IN ('pending','cancelled','rejected')
UNION ALL
SELECT 'leave_balance', COUNT(*) FROM leave_balance
UNION ALL
SELECT 'leave notifications (last day)', COUNT(*)
FROM notifications WHERE type IN ('leave_request','leave_approved','leave_rejected','leave_cancelled');

COMMIT;
