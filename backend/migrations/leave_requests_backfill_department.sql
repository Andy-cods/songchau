-- W3-08 (2026-07-04) — Backfill leave_requests.department for rows created
-- via the legacy /api/v1/calendar/leaves* endpoint (calendar_api.py), which
-- never set `department` on INSERT. Rows with department IS NULL are
-- invisible to manager-scoped queries in the HR M41 flow (app/api/v1/leave.py
-- filters `lr.department = actor_dept`), so managers cannot see/approve them
-- from /hr.
--
-- Idempotent: only touches rows where department IS NULL; safe to re-run.
-- Does NOT touch leave_balance (approved-but-never-deducted rows) — that
-- needs manual review (see note below) since some may have been manually
-- reconciled already; auto-crediting risks double-adjustment.

UPDATE leave_requests lr
SET department = u.department
FROM users u
WHERE lr.user_id = u.id
  AND lr.department IS NULL
  AND u.department IS NOT NULL;

-- Manual follow-up for Thang (NOT done by this migration — needs business
-- judgement, cannot be inferred safely from code):
--   SELECT lr.id, lr.user_id, lr.leave_type, lr.days_count, lr.start_date,
--          lr.approved_at
--   FROM leave_requests lr
--   WHERE lr.status = 'approved'
--     AND lr.approved_by IS NOT NULL
--   -- cross-check against leave_balance to see which approved-via-old-flow
--   -- rows never decremented the *_used column, then decide whether to
--   -- backfill leave_balance or leave as-is (may already be reconciled by
--   -- some other means).
