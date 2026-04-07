-- M05 — Tra cứu giá thị trường (TT XNK lookup)
-- Date: 2026-04-07
-- Source: file TT XNK BQMS 2026.xlsm sheet DATA (35K rows từ 2023-2026)

CREATE TABLE IF NOT EXISTS xnk_price_lookup (
    id              BIGSERIAL PRIMARY KEY,
    rfq_date        DATE,                       -- Ngày RFQ Samsung
    quotation_no    TEXT,                       -- Số QT
    bqms_code       TEXT,                       -- Mã BQMS (Z000... hoặc R...)
    item_name       TEXT,                       -- Tên hàng
    item_explain    TEXT,                       -- Mô tả chi tiết
    item_type       TEXT,                       -- Loại hàng (TM/GC)
    maker           TEXT,                       -- Hãng/maker
    notes           TEXT,                       -- Ghi chú
    notes2          TEXT,                       -- Ghi chú 2
    unit            TEXT,                       -- ĐVT
    quantity        NUMERIC,                    -- SL
    quote_deadline  TEXT,                       -- Hạn báo giá
    quoted_date     DATE,                       -- Ngày báo giá
    bqms_code3      TEXT,                       -- BQMS code khác (alias)
    -- TRA CUU sheet — competitor pricing (when available)
    hs_code         TEXT,                       -- Mã HS hải quan
    price_usd       NUMERIC,                    -- Đơn giá USD
    price_vnd       NUMERIC,                    -- Đơn giá VND
    total_usd       NUMERIC,                    -- Tổng USD
    buyer_name      TEXT,                       -- Bên mua
    seller_name     TEXT,                       -- Bên bán (đối thủ)
    source          TEXT DEFAULT 'excel_import',-- 'excel_import' / 'web_scrape'
    raw_data        JSONB,                      -- raw row data
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_xnk_bqms ON xnk_price_lookup(bqms_code);
CREATE INDEX IF NOT EXISTS idx_xnk_hs ON xnk_price_lookup(hs_code);
CREATE INDEX IF NOT EXISTS idx_xnk_seller ON xnk_price_lookup(seller_name);
CREATE INDEX IF NOT EXISTS idx_xnk_rfq_date ON xnk_price_lookup(rfq_date);
CREATE INDEX IF NOT EXISTS idx_xnk_item_name_trgm ON xnk_price_lookup USING gin (item_name gin_trgm_ops);
