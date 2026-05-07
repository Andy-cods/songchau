-- ============================================================
-- Migration: quotations soft-delete + index for filtering
-- Date: 2026-05-07
-- Plan: in response to Thang's request to "edit / delete báo giá".
--
-- Adds:
--   - quotations.deleted_at  (NULL = active, set = soft-deleted)
--   - Partial index on (deleted_at IS NULL) for fast list queries
-- ============================================================

BEGIN;

ALTER TABLE quotations
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

COMMENT ON COLUMN quotations.deleted_at IS
    'Soft-delete: NULL = active. Set = ẩn khỏi list (file giữ trên disk để khôi phục).';

CREATE INDEX IF NOT EXISTS idx_quot_active
    ON quotations (created_at DESC) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_quot_rfq_active
    ON quotations (rfq_no) WHERE deleted_at IS NULL;

COMMIT;
