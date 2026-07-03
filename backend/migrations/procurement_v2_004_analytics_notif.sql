-- ============================================================
-- procurement_v2_004_analytics_notif.sql  (Đợt 6 — Analytics + Procurement notifications)
-- ADDITIVE, IDEMPOTENT, re-runnable via: docker cp ... && psql -f.
-- Author: Thang — 2026-06-19
-- DEPLOY: docker cp + psql -f; restart sc-api + sc-worker + sc-scheduler.
--
-- PRE-EXISTING FACTS (verified in init_v3.sql):
--   * ENUM TYPE is `notification_type` (init_v3.sql:80) — a REAL enum, 8 values:
--     workflow_request, workflow_approved, workflow_rejected, deadline_reminder,
--     stock_alert, po_received, bqms_rfq_new, report_ready.
--   * TABLE `notifications` (init_v3.sql:1805): id BIGSERIAL, recipient_id UUID
--     NOT NULL REFERENCES users(id), type notification_type, title, body,
--     is_read BOOLEAN DEFAULT false, read_at, ref_type, ref_id BIGINT, metadata
--     JSONB, created_at. Existing unread index (init_v3.sql:2367):
--       idx_notif_unread ON notifications (recipient_id, created_at DESC)
--         WHERE is_read = false;
--   * TABLE `vendor_accounts` (vendor_portal_001.sql:15): id BIGSERIAL PRIMARY KEY.
--
-- WHY: procurement notifications target BOTH admin users (recipient_id = users.id,
--   UUID) AND vendor-portal accounts (recipient_vendor_id = vendor_accounts.id,
--   BIGINT). The new recipient_vendor_id column lets vendor rows coexist with the
--   existing admin rows in the SAME table without touching recipient_id.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Extend notification_type enum with the 5 procurement values.
--    ALTER TYPE ... ADD VALUE is NON-TRANSACTIONAL in Postgres and CANNOT run
--    inside a DO/BEGIN block (would error: "ALTER TYPE ... ADD VALUE cannot run
--    inside a transaction block"). Each runs STANDALONE; IF NOT EXISTS makes each
--    individually idempotent / re-runnable.
-- ------------------------------------------------------------
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'procurement_award';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'procurement_quote';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'procurement_contract';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'procurement_po';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'procurement_delivery';

-- ------------------------------------------------------------
-- 2) Add vendor recipient column. Admin rows keep recipient_id (users.id, UUID);
--    vendor rows set recipient_vendor_id (vendor_accounts.id, BIGINT) instead.
--    NOTE: recipient_id stays NOT NULL on the base table, so vendor-targeted
--    INSERTs supply both columns per application convention; this migration only
--    makes the vendor column AVAILABLE (additive, no constraint change).
-- ------------------------------------------------------------
ALTER TABLE notifications
    ADD COLUMN IF NOT EXISTS recipient_vendor_id BIGINT REFERENCES vendor_accounts(id);

COMMENT ON COLUMN notifications.recipient_vendor_id IS
    'Vendor-portal recipient (vendor_accounts.id). NULL for admin rows (which use recipient_id = users.id).';

-- ------------------------------------------------------------
-- 3) Partial index for vendor unread/lookup feed. Matches existing
--    idx_notif_unread partial-index style (init_v3.sql:2367).
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_notif_vendor_unread
    ON notifications (recipient_vendor_id)
    WHERE recipient_vendor_id IS NOT NULL;
