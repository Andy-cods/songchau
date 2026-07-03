-- ============================================================
-- Migration: M42 — notification_type: add missing enum values
-- Date: 2026-07-03
-- Plan: notification bug-cluster fix (audit of every INSERT INTO notifications)
--
-- WHY: An audit of every `INSERT INTO notifications` in backend/app found code
-- paths that emit `type` values which do NOT exist in the `notification_type`
-- enum. Any such insert raises `invalid input value for enum notification_type`
-- and returns HTTP 500 (or silently drops the notification inside a try/except).
--
-- Missing values discovered (file:line — literal emitted):
--   task_assigned       app/api/v1/task_assignments.py:175, 548, 593
--                       app/api/v1/batch_operations.py:313
--   workflow_timeout    app/services/workflow_engine.py:376
--   workflow_update     app/services/workflow_engine.py:423
--   deadline_overdue    app/tasks/notifications.py:310, 322 (via _insert_notification/_notify_approvers)
--   deadline_upcoming   app/tasks/notifications.py:241, 254 (via _insert_notification/_notify_approvers)
--
-- ADDITIVE & IDEMPOTENT: only ALTER TYPE ... ADD VALUE IF NOT EXISTS. No column,
-- table, or data change. Re-running is a no-op.
--
-- NON-TRANSACTIONAL: `ALTER TYPE ... ADD VALUE` cannot run inside a BEGIN/COMMIT
-- (or DO block) in PostgreSQL — it must be autocommit. This file therefore has
-- NO transaction wrapper. Run with:
--   psql "$DATABASE_URL" -f m42_notification_type_add_missing.sql
-- ============================================================

ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'task_assigned';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'workflow_timeout';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'workflow_update';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'deadline_overdue';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'deadline_upcoming';
