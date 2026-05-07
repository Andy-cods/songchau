-- ============================================================
-- Migration: quotations OneDrive integration
-- Date: 2026-05-07
-- Plan: plans/quotation-file-storage/PROPOSAL.md §3.3
--
-- Adds:
--   - onedrive_folder_id    (Microsoft Graph item id of the parent folder)
--   - onedrive_url          (web URL của file PDF chính, mở trong Office Online)
--   - onedrive_share_url    (public share link M365 native, ai có link xem được)
--   - onedrive_synced_at    (timestamp upload thành công)
--   - onedrive_sync_error   (error message nếu sync thất bại; NULL = OK)
--
-- Cũng bumps quotations.status enum để có 'syncing' state.
-- ============================================================

BEGIN;

ALTER TABLE quotations
    ADD COLUMN IF NOT EXISTS onedrive_folder_id  TEXT,
    ADD COLUMN IF NOT EXISTS onedrive_url        TEXT,
    ADD COLUMN IF NOT EXISTS onedrive_share_url  TEXT,
    ADD COLUMN IF NOT EXISTS onedrive_synced_at  TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS onedrive_sync_error TEXT;

COMMENT ON COLUMN quotations.onedrive_folder_id IS
    'Microsoft Graph driveItem id của folder chứa CAM_KET + QUOTATION';
COMMENT ON COLUMN quotations.onedrive_url IS
    'Web URL của file QUOTATION PDF chính trên OneDrive — click để mở Office Online';
COMMENT ON COLUMN quotations.onedrive_share_url IS
    'Share link M365 (ai có link đều xem được, có thể truy cập từ ngoài)';
COMMENT ON COLUMN quotations.onedrive_synced_at IS
    'Timestamp upload OneDrive thành công gần nhất. NULL = chưa sync hoặc lỗi';

CREATE INDEX IF NOT EXISTS idx_quot_onedrive_synced
    ON quotations (onedrive_synced_at) WHERE onedrive_synced_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_quot_onedrive_pending
    ON quotations (id) WHERE onedrive_synced_at IS NULL AND status = 'completed';

COMMIT;
