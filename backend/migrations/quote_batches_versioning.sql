-- ============================================================
-- M3 — quote_batches versioning + conversion provenance
-- Thang 2026-06-22 (idempotent — safe to re-run)
-- ============================================================
-- Adds revision-chain columns so a báo giá can be "Sửa & gửi lại" as a new
-- version while keeping a single quote_group_id thread; is_current flags the
-- latest version of each group. converted_order_id back-links to the
-- sourcing_orders row created via /quote-batch/{quote_no}/create-order (M4).

ALTER TABLE quote_batches
  ADD COLUMN IF NOT EXISTS quote_group_id BIGINT,
  ADD COLUMN IF NOT EXISTS version_no INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS is_current BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS converted_order_id BIGINT;

-- Backfill: every legacy row is its own group (self-thread, version 1, current).
UPDATE quote_batches SET quote_group_id = id WHERE quote_group_id IS NULL;

-- Lookup index for "latest version of a group" + group listing.
CREATE INDEX IF NOT EXISTS idx_qb_group ON quote_batches(quote_group_id, version_no DESC);
