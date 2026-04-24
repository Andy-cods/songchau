-- Bảng kê hóa đơn theo quý — Bán ra + Mua vào
-- Date: 2026-04-07

-- Sales invoices (Bán ra) — hóa đơn Song Châu xuất cho KH
CREATE TABLE IF NOT EXISTS sales_invoices_q (
    id              BIGSERIAL PRIMARY KEY,
    quarter         TEXT NOT NULL,                    -- 'Q1-2026'
    invoice_number  TEXT NOT NULL,
    invoice_date    DATE NOT NULL,
    buyer_name      TEXT NOT NULL,                    -- Tên người mua (KH)
    buyer_tax_code  TEXT,
    item_name       TEXT,                             -- Mặt hàng
    unit            TEXT,                             -- ĐVT
    quantity        NUMERIC,                          -- SL
    unit_price      NUMERIC,                          -- ĐG
    amount_before_tax NUMERIC,                        -- TT (= Doanh số chưa thuế)
    tax_rate        TEXT,                             -- '8%', '10%', '0%'
    tax_amount      NUMERIC,                          -- Thuế GTGT
    total_amount    NUMERIC,                          -- TK thuế (= chưa thuế + thuế)
    -- Internal cost tracking (đầu vào)
    supplier_name   TEXT,                             -- NCC
    cost_price      NUMERIC,                          -- Giá nhập
    cost_vat        NUMERIC,                          -- VAT nhập
    -- Source
    source          TEXT DEFAULT 'manual',            -- 'manual', 'pdf_ocr', 'excel_import'
    pdf_path        TEXT,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sales_inv_q_quarter ON sales_invoices_q(quarter);
CREATE INDEX IF NOT EXISTS idx_sales_inv_q_date ON sales_invoices_q(invoice_date);
CREATE INDEX IF NOT EXISTS idx_sales_inv_q_number ON sales_invoices_q(invoice_number);

-- Purchase invoices (Mua vào) — hóa đơn NCC bán cho Song Châu
CREATE TABLE IF NOT EXISTS purchase_invoices_q (
    id              BIGSERIAL PRIMARY KEY,
    quarter         TEXT NOT NULL,                    -- 'Q1-2026'
    invoice_number  TEXT NOT NULL,
    invoice_date    DATE NOT NULL,
    seller_name     TEXT NOT NULL,                    -- Tên người bán (NCC)
    seller_tax_code TEXT,
    item_name       TEXT,
    unit            TEXT,
    quantity        NUMERIC,
    unit_price      NUMERIC,
    amount_before_tax NUMERIC,                        -- TT
    tax_rate        TEXT,
    tax_amount      NUMERIC,                          -- Thuế GTGT
    total_amount    NUMERIC,                          -- Tổng
    -- Mapping to customer/order
    customer_code   TEXT,                             -- KH (mã KH dùng hàng này)
    item_code       TEXT,                             -- mã hàng
    issued_date     DATE,                             -- Ngày Xuất HĐ
    -- Source
    source          TEXT DEFAULT 'manual',
    pdf_path        TEXT,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_purchase_inv_q_quarter ON purchase_invoices_q(quarter);
CREATE INDEX IF NOT EXISTS idx_purchase_inv_q_date ON purchase_invoices_q(invoice_date);
CREATE INDEX IF NOT EXISTS idx_purchase_inv_q_seller ON purchase_invoices_q(seller_name);
