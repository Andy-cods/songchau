-- VN-shipping fee history for sourcing entries (A1).
-- Each time a user saves a new phí vận chuyển nội địa (VND) on an entry and it
-- differs from the latest stored value, append a row here so the FE can show
-- the change history. Deduped at the API layer (skip insert if == latest).
CREATE TABLE IF NOT EXISTS sourcing_vn_shipping_history (
    id BIGSERIAL PRIMARY KEY,
    entry_id BIGINT NOT NULL REFERENCES sourcing_entries(id) ON DELETE CASCADE,
    value_vnd NUMERIC(18,0) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by_email TEXT
);

CREATE INDEX IF NOT EXISTS idx_vn_ship_hist_entry
    ON sourcing_vn_shipping_history(entry_id, created_at DESC);
