-- ============================================================
-- M4 fix — allow source_type='quote_batch' on sourcing_orders
-- Thang 2026-06-22 (found by E2E: create-order from a báo giá hit
-- sourcing_orders_source_type_check which lacked 'quote_batch').
-- Idempotent — safe to re-run.
-- ============================================================
ALTER TABLE sourcing_orders DROP CONSTRAINT IF EXISTS sourcing_orders_source_type_check;
ALTER TABLE sourcing_orders ADD CONSTRAINT sourcing_orders_source_type_check
  CHECK (source_type IN ('sourcing','manual','bqms_po','imv_po','quote_batch'));
