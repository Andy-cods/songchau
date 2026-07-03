-- ============================================================
-- Migration: quote_batches table
-- Date: 2026-06-03 (Thang) — RFQ Library / Tạo báo giá hàng loạt
--
-- Khi user tick N mã trong /sourcing → bấm "Tạo báo giá" → 1 record
-- vào table này + file XLSX render ra /data/files/quotes/QB-YYMMDD-NNNN.xlsx
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS quote_batches (
    id              BIGSERIAL PRIMARY KEY,
    quote_no        TEXT UNIQUE NOT NULL,          -- 'QB-260603-0001'
    customer_id     BIGINT REFERENCES customers(id) ON DELETE SET NULL,
    customer_name   TEXT,                          -- raw name nếu không link CRM
    quote_note      TEXT,
    total_items     INT NOT NULL DEFAULT 0,
    total_value_vnd NUMERIC(20, 2) NOT NULL DEFAULT 0,
    item_ids        BIGINT[] NOT NULL,             -- FK sourcing_entries.id (array, không dùng N:N table cho đơn giản)
    line_items      JSONB,                         -- snapshot tại thời điểm tạo: [{sourcing_id, model, name, qty, unit_price, line_total}]
    file_path       TEXT,                          -- absolute VPS path
    file_format     TEXT CHECK (file_format IN ('xlsx', 'pdf', 'tsv')),
    sent_at         TIMESTAMPTZ,
    sent_to_email   TEXT,
    created_by_id   BIGINT,
    created_by_email TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_qb_customer
    ON quote_batches (customer_id, created_at DESC)
    WHERE customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_qb_created
    ON quote_batches (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_qb_quote_no_prefix
    ON quote_batches (LEFT(quote_no, 9));         -- 'QB-YYMMDD' prefix scan

-- Sequence cho counter trong ngày
CREATE SEQUENCE IF NOT EXISTS quote_batches_daily_seq;

COMMENT ON TABLE quote_batches IS
    'Báo giá hàng loạt từ /sourcing. 1 record = 1 lần user tick + tạo file XLSX.';
COMMENT ON COLUMN quote_batches.item_ids IS
    'Snapshot sourcing_entries.id[] tại thời điểm tạo. KHÔNG cascade khi sourcing row bị xóa.';
COMMENT ON COLUMN quote_batches.line_items IS
    'Snapshot dữ liệu hiển trong báo giá. Dùng để regenerate file mà không cần JOIN sourcing.';

COMMIT;
