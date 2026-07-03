-- ============================================================
-- BUG DATA-1 FIX: Drop status_history DB trigger
-- Date: 2026-06-03 (Thang)
--
-- Problem: status_history rows were being double-written because BOTH the
-- DB trigger `trg_sosh_log` (function `log_sourcing_order_status_change`) AND
-- the app helper `_so_apply_status_transition` insert rows on every status
-- change.
--
-- Decision: drop the DB trigger and make the app helper the single source of
-- truth. Rationale: the app helper has full audit context (by_user_id +
-- by_user_email + note + metadata) whereas the trigger only has the email
-- and writes by_user_id = NULL — making trigger rows the inferior copy.
--
-- After this migration runs:
--   * `PATCH /orders/{id}/status` → unchanged (already uses helper)
--   * `GET /orders/{id}/quote-pdf` auto draft→quoted → unchanged (uses helper)
--   * `POST /orders/`               → app must call helper for initial state
--                                     (previously relied on AFTER INSERT trigger)
--   * `POST /orders/{id}/payment-request` → app must insert a history row
--                                     (previously relied on AFTER UPDATE trigger)
--
-- See: sourcing_orders.sql (original definition of trg_sosh_log + function).
-- ============================================================

BEGIN;

DROP TRIGGER IF EXISTS trg_sosh_log ON sourcing_orders;
DROP FUNCTION IF EXISTS log_sourcing_order_status_change() CASCADE;

COMMIT;
