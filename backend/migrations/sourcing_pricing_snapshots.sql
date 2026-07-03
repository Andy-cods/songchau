-- Versioned pricing history for sourcing entries (Thang 2026-07-01).
--
-- Each row is an immutable snapshot of a full price computation, created ONLY
-- when the user clicks "Lưu đợt tính giá" (no auto-append on ordinary save).
-- The `snapshot` JSONB is the exact object the FE builds in applyQuotedPrice
-- (SourcingFormDrawer.tsx): { cost_amount, currency, fx_rate, fx_date,
-- is_domestic, fedex_fee_vnd, vn_shipping_fee_vnd, other_fee_override,
-- pct_overrides, breakdown, params, qty, unit_price_vnd, source,
-- supplier_price_id, supplier_name, computed_at }.
--
-- Loading an old version renders straight from its frozen breakdown/params —
-- the backend never recomputes it (avoids re-applying today's % rules / FX).

CREATE TABLE IF NOT EXISTS sourcing_pricing_snapshots (
    id               BIGSERIAL PRIMARY KEY,
    entry_id         BIGINT NOT NULL
                        REFERENCES sourcing_entries(id) ON DELETE CASCADE,
    version          INT NOT NULL,
    snapshot         JSONB NOT NULL,
    sale_vnd         NUMERIC(18, 0),
    label            TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by_email TEXT,
    UNIQUE (entry_id, version)
);

-- Newest-first listing + MAX(version)/COUNT per entry (serializer subqueries).
CREATE INDEX IF NOT EXISTS idx_sps_entry_version
    ON sourcing_pricing_snapshots (entry_id, version DESC);
