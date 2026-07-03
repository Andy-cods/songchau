-- ============================================================
-- Drop Telegram integration columns/indexes (Thang 2026-06-03).
-- Reason: Telegram opt-in removed; in-app notifications cover the use case.
-- Counterpart to payment_requests_sourcing_link.sql section 2 (now deleted).
-- ============================================================

BEGIN;

DROP INDEX IF EXISTS idx_users_telegram_active;

ALTER TABLE users
    DROP COLUMN IF EXISTS telegram_chat_id;

COMMIT;
