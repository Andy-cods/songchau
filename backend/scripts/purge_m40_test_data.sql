-- ============================================================
-- Purge M40 KPI test data after smoke testing.
-- Date: 2026-05-06
--
-- Run AFTER smoke-test runs (POST /employee-kpi/recompute) to wipe the rows
-- the aggregator created so production data starts clean on real cron firing.
--
-- Safe to re-run; idempotent.
--
-- Usage:
--   psql "$DATABASE_URL" -f purge_m40_test_data.sql
-- ============================================================

BEGIN;

-- 1. Empty the materialised KPI table.
TRUNCATE TABLE employee_monthly_kpi RESTART IDENTITY;

-- 2. Drop audit_log rows the aggregator wrote during smoke testing.
DELETE FROM audit_log
WHERE table_name = 'employee_monthly_kpi'
  AND action IN ('kpi_recompute', 'kpi_recompute_warning', 'kpi_recompute_requested');

-- 3. Verify
SELECT 'employee_monthly_kpi'         AS tbl, COUNT(*) AS rows FROM employee_monthly_kpi
UNION ALL
SELECT 'audit_log (kpi rows)'         AS tbl, COUNT(*)
FROM audit_log
WHERE table_name = 'employee_monthly_kpi';

COMMIT;
