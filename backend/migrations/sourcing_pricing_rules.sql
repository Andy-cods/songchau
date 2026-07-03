-- Pricing rules per item_type — markup % + tax % + shipping fee mặc định.
-- Engine compute_sale_vnd() lookup theo item_type, fall back 'default'.
-- Thang 2026-06-13

CREATE TABLE IF NOT EXISTS sourcing_pricing_rules (
    id BIGSERIAL PRIMARY KEY,
    item_type TEXT NOT NULL UNIQUE,         -- vd: 'SMT Machine Parts', 'Tool Box', 'default'

    markup_pct NUMERIC(6, 3) NOT NULL DEFAULT 1.400,   -- 1.4 = bán = nhập × 1.4 (markup 40%)
    tax_pct    NUMERIC(6, 3) NOT NULL DEFAULT 10.000,  -- VAT % (10 = 10%)
    shipping_fee_vnd NUMERIC(18, 2) DEFAULT 0,         -- phí ship cộng thẳng vào sale

    description_vi TEXT,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed rule mặc định
INSERT INTO sourcing_pricing_rules (item_type, markup_pct, tax_pct, description_vi)
VALUES ('default', 1.4, 10, 'Quy tắc mặc định — áp dụng khi không match item_type cụ thể')
ON CONFLICT (item_type) DO NOTHING;

-- Auto-update updated_at trigger
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'tg_spr_set_updated_at') THEN
        CREATE OR REPLACE FUNCTION tg_spr_set_updated_at() RETURNS TRIGGER AS $func$
        BEGIN
            NEW.updated_at = NOW();
            RETURN NEW;
        END;
        $func$ LANGUAGE plpgsql;
    END IF;
END$$;

DROP TRIGGER IF EXISTS trg_spr_updated_at ON sourcing_pricing_rules;
CREATE TRIGGER trg_spr_updated_at
    BEFORE UPDATE ON sourcing_pricing_rules
    FOR EACH ROW EXECUTE FUNCTION tg_spr_set_updated_at();

COMMENT ON TABLE sourcing_pricing_rules IS
    'Quy tắc tính giá bán theo item_type — engine compute_sale_vnd() lookup table';
COMMENT ON COLUMN sourcing_pricing_rules.markup_pct IS
    'Hệ số nhân (1.4 = +40%) — KHÁC với percentage (40%)';
COMMENT ON COLUMN sourcing_pricing_rules.tax_pct IS
    'VAT % — 10 = 10%, KHÔNG phải 0.1';
