-- Sourcing Library: lưu mỗi lần tìm giá / nhà cung cấp
-- Mục đích: sale tham chiếu khi báo giá khách + thống kê so sánh
-- Thang 2026-05-23

CREATE TABLE IF NOT EXISTS sourcing_entries (
    id BIGSERIAL PRIMARY KEY,
    -- Link tới hệ thống BQMS (optional — sale có thể lưu trước khi có mã)
    bqms_code TEXT,

    -- Khách hàng + người phụ trách
    customer_name TEXT,
    person_in_charge TEXT,

    -- Sản phẩm
    model TEXT,
    product_name TEXT,
    maker TEXT,
    inquiry_date DATE,

    -- Giá nhập multi-currency
    cost_jpy NUMERIC(18, 2),
    cost_usd NUMERIC(18, 2),
    cost_krw NUMERIC(18, 2),
    cost_rmb NUMERIC(18, 2),
    cost_vnd NUMERIC(18, 0),

    -- Giá bán + qty
    sale_vnd NUMERIC(18, 0),
    quantity NUMERIC(18, 3),

    -- Thuế + HS + trọng lượng
    tax_pct NUMERIC(6, 2),
    hs_code TEXT,
    weight_kg NUMERIC(12, 3),

    -- Hệ số nhân (markup, dùng khi tính giá bán từ giá nhập)
    coefficient NUMERIC(8, 4),

    -- Nhà cung cấp
    supplier_name TEXT,
    supplier_phone TEXT,
    supplier_email TEXT,

    -- Ảnh + ghi chú + phân loại + tỷ giá snapshot
    image_url TEXT,
    notes TEXT,
    row_classification TEXT, -- vd: "Product Candidate", "Validated", "Quoted"
    exchange_rate JSONB,     -- {"jpy": 180, "usd": 24500, "krw": 18.2, "rmb": 3400}

    -- Audit
    created_by_id BIGINT,
    created_by_email TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sourcing_bqms_code ON sourcing_entries(bqms_code);
CREATE INDEX IF NOT EXISTS idx_sourcing_maker ON sourcing_entries(maker);
CREATE INDEX IF NOT EXISTS idx_sourcing_supplier ON sourcing_entries(supplier_name);
CREATE INDEX IF NOT EXISTS idx_sourcing_customer ON sourcing_entries(customer_name);
CREATE INDEX IF NOT EXISTS idx_sourcing_inquiry_date ON sourcing_entries(inquiry_date DESC);
CREATE INDEX IF NOT EXISTS idx_sourcing_created_at ON sourcing_entries(created_at DESC);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION set_updated_at_sourcing()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sourcing_updated_at ON sourcing_entries;
CREATE TRIGGER trg_sourcing_updated_at
    BEFORE UPDATE ON sourcing_entries
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at_sourcing();
