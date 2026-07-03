-- inventory_unique_product_id.sql
-- Enforce one inventory row per product so receive_goods /
-- receive_shipment can safely upsert via ON CONFLICT (product_id).
--
-- Prod state (verified read-only): 50 inventory rows, 0 duplicate product_id,
-- inventory_movements empty — so this index builds cleanly with no dedup step.
--
-- IMPORTANT — apply OUTSIDE a transaction block:
--   CREATE INDEX CONCURRENTLY cannot run inside BEGIN/COMMIT. Run this file with
--   a client that does NOT wrap it in a transaction (e.g. `psql -f`, autocommit),
--   NOT via a migration runner that opens an explicit txn.
--
-- Idempotent: IF NOT EXISTS skips a rebuild when the index already exists.
--   NOTE: if a prior CONCURRENTLY build was interrupted it leaves an INVALID
--   index of the same name; IF NOT EXISTS would then skip it. After running,
--   verify the index is valid:
--     SELECT indisvalid FROM pg_index
--     WHERE indexrelid = 'uq_inventory_product_id'::regclass;  -- expect: t
--   If it is 'f', DROP INDEX CONCURRENTLY uq_inventory_product_id; then re-run.

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_inventory_product_id
    ON public.inventory (product_id);

COMMENT ON INDEX public.uq_inventory_product_id IS
    'Mot dong ton kho / san pham — bao dam ON CONFLICT(product_id) upsert an toan.';
