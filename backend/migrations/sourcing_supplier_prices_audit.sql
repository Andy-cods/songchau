-- Audit trail for supplier prices + pricing rules.
-- Supplier-price tampering drives suggested sale + PDF, so "who changed what"
-- must be queryable. Stores both user_id (FK-able) and a denormalised email
-- snapshot (survives user-delete / role change).
-- Thang 2026-06-13 (ICE security #1)

-- BIGINT (not UUID) to match users.id convention used throughout this codebase
-- (cf. sourcing_updated_by.sql, sourcing_entries.updated_by_id).
ALTER TABLE sourcing_supplier_prices
    ADD COLUMN IF NOT EXISTS created_by_id    BIGINT,
    ADD COLUMN IF NOT EXISTS created_by_email TEXT,
    ADD COLUMN IF NOT EXISTS updated_by_id    BIGINT,
    ADD COLUMN IF NOT EXISTS updated_by_email TEXT;

ALTER TABLE sourcing_pricing_rules
    ADD COLUMN IF NOT EXISTS created_by_id    BIGINT,
    ADD COLUMN IF NOT EXISTS created_by_email TEXT,
    ADD COLUMN IF NOT EXISTS updated_by_id    BIGINT,
    ADD COLUMN IF NOT EXISTS updated_by_email TEXT;

COMMENT ON COLUMN sourcing_supplier_prices.created_by_email IS
    'Snapshot of token_data.email at create time — survives user-delete';
COMMENT ON COLUMN sourcing_supplier_prices.updated_by_email IS
    'Snapshot of token_data.email at last update — for forensic audit';

-- Hot path index: list_supplier_prices orders by is_primary DESC, cost_vnd_equiv ASC NULLS LAST.
-- (Replaces seq-scan on entries with many suppliers.)
-- ICE backend #2 (perf)
CREATE INDEX IF NOT EXISTS idx_ssp_entry_cost
    ON sourcing_supplier_prices (sourcing_entry_id, is_primary DESC, cost_vnd_equiv ASC NULLS LAST);
