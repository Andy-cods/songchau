-- Multi-supplier prices per sourcing entry.
-- Mục đích: 1 sourcing_entry có thể có nhiều NCC cùng báo giá song song; sale
-- pick "primary" để hiển thị mặc định nhưng vẫn lưu lịch sử compare.
-- Thang 2026-06-13

CREATE TABLE IF NOT EXISTS sourcing_supplier_prices (
    id BIGSERIAL PRIMARY KEY,
    sourcing_entry_id BIGINT NOT NULL REFERENCES sourcing_entries(id) ON DELETE CASCADE,

    -- NCC info
    supplier_name TEXT NOT NULL,
    supplier_phone TEXT,
    supplier_email TEXT,

    -- Giá nhập gốc (đa tiền tệ)
    currency TEXT NOT NULL DEFAULT 'VND',
    cost_amount NUMERIC(18, 4) NOT NULL,

    -- Quy đổi VND (cached at save time — không recompute mỗi GET)
    cost_vnd_equiv NUMERIC(18, 2),
    exchange_rate_used NUMERIC(18, 6),

    -- Thông tin thương mại
    lead_time_days INT,
    moq INT,
    notes TEXT,

    -- Cờ NCC chính (1 entry chỉ 1 primary — enforced bằng partial unique index dưới)
    is_primary BOOLEAN DEFAULT false,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT chk_ssp_currency CHECK (currency IN ('VND','JPY','USD','KRW','RMB','EUR'))
);

CREATE INDEX IF NOT EXISTS idx_ssp_entry ON sourcing_supplier_prices(sourcing_entry_id);
CREATE INDEX IF NOT EXISTS idx_ssp_supplier ON sourcing_supplier_prices(supplier_name);

-- Chỉ 1 primary supplier per entry — partial unique index (mọi row khác có is_primary=false không xung đột)
CREATE UNIQUE INDEX IF NOT EXISTS idx_ssp_one_primary
    ON sourcing_supplier_prices(sourcing_entry_id)
    WHERE is_primary = true;

-- Auto-update updated_at trigger (reuse existing function if available, else create)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'tg_ssp_set_updated_at') THEN
        CREATE OR REPLACE FUNCTION tg_ssp_set_updated_at() RETURNS TRIGGER AS $func$
        BEGIN
            NEW.updated_at = NOW();
            RETURN NEW;
        END;
        $func$ LANGUAGE plpgsql;
    END IF;
END$$;

DROP TRIGGER IF EXISTS trg_ssp_updated_at ON sourcing_supplier_prices;
CREATE TRIGGER trg_ssp_updated_at
    BEFORE UPDATE ON sourcing_supplier_prices
    FOR EACH ROW EXECUTE FUNCTION tg_ssp_set_updated_at();

COMMENT ON TABLE sourcing_supplier_prices IS
    'Bảng đa NCC cho 1 sourcing_entry — sale so sánh giá nhập + chọn primary';
COMMENT ON COLUMN sourcing_supplier_prices.cost_vnd_equiv IS
    'cost_amount * exchange_rate_used, cache tại thời điểm lưu (snapshot)';
COMMENT ON COLUMN sourcing_supplier_prices.is_primary IS
    'NCC chính — chỉ 1 per entry (partial unique idx_ssp_one_primary)';
