-- ============================================================
-- PHASE 2: Revenue Chain — New tables for end-to-end deal tracking
-- Run on VPS: psql -U scadmin -d songchau_erp -f phase2_revenue_chain.sql
-- ============================================================

-- ─── Domain Events (central event bus) ──────────────────────
CREATE TABLE IF NOT EXISTS domain_events (
    id              BIGSERIAL PRIMARY KEY,
    event_type      TEXT NOT NULL,
    aggregate_type  TEXT NOT NULL,
    aggregate_id    TEXT NOT NULL,
    payload         JSONB NOT NULL DEFAULT '{}',
    chain_code      TEXT,
    created_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_de_event_type   ON domain_events(event_type);
CREATE INDEX IF NOT EXISTS idx_de_aggregate    ON domain_events(aggregate_type, aggregate_id);
CREATE INDEX IF NOT EXISTS idx_de_chain        ON domain_events(chain_code) WHERE chain_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_de_created      ON domain_events(created_at DESC);

-- ─── Supplier Product Map ────────────────────────────────────
CREATE TABLE IF NOT EXISTS supplier_product_map (
    id              BIGSERIAL PRIMARY KEY,
    supplier_id     BIGINT NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
    bqms_code       TEXT NOT NULL,
    product_id      BIGINT REFERENCES products(id) ON DELETE SET NULL,
    typical_lead_time_days INT,
    typical_moq     NUMERIC(12,3),
    typical_price_cny NUMERIC(14,4),
    currency        TEXT NOT NULL DEFAULT 'CNY',
    last_quoted_at  TIMESTAMPTZ,
    quality_score   NUMERIC(3,2) CHECK (quality_score BETWEEN 0 AND 5),
    is_preferred    BOOLEAN NOT NULL DEFAULT false,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (supplier_id, bqms_code)
);

CREATE INDEX IF NOT EXISTS idx_spm_supplier   ON supplier_product_map(supplier_id);
CREATE INDEX IF NOT EXISTS idx_spm_bqms       ON supplier_product_map(bqms_code);
CREATE INDEX IF NOT EXISTS idx_spm_preferred  ON supplier_product_map(bqms_code, is_preferred) WHERE is_preferred = true;

-- ─── Supplier Quotes ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS supplier_quotes (
    id              BIGSERIAL PRIMARY KEY,
    quote_number    TEXT NOT NULL UNIQUE,
    supplier_id     BIGINT NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
    rfq_id          BIGINT REFERENCES bqms_rfq(id) ON DELETE SET NULL,
    sales_order_id  BIGINT REFERENCES sales_orders(id) ON DELETE SET NULL,
    chain_code      TEXT,
    status          TEXT NOT NULL DEFAULT 'requested'
                        CHECK (status IN ('requested', 'received', 'accepted', 'rejected', 'expired')),
    requested_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    received_at     TIMESTAMPTZ,
    valid_until     DATE,
    currency        TEXT NOT NULL DEFAULT 'CNY',
    exchange_rate   NUMERIC(10,4),                 -- CNY → VND rate at time of quote
    total_amount_cny NUMERIC(14,2),
    total_amount_vnd NUMERIC(16,2),
    lead_time_days  INT,
    payment_terms   TEXT,
    incoterm        TEXT DEFAULT 'FOB',
    rejection_reason TEXT,
    needs_review    BOOLEAN NOT NULL DEFAULT false,
    margin_pct      NUMERIC(5,2),                  -- calculated on accept
    notes           TEXT,
    created_by      UUID NOT NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sq_supplier    ON supplier_quotes(supplier_id);
CREATE INDEX IF NOT EXISTS idx_sq_rfq         ON supplier_quotes(rfq_id) WHERE rfq_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sq_so          ON supplier_quotes(sales_order_id) WHERE sales_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sq_chain       ON supplier_quotes(chain_code) WHERE chain_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sq_status      ON supplier_quotes(status);
CREATE INDEX IF NOT EXISTS idx_sq_created     ON supplier_quotes(created_at DESC);

-- Auto-generate quote_number: SQ-YYYYMM-NNNNNN
CREATE OR REPLACE FUNCTION gen_supplier_quote_number() RETURNS TRIGGER AS $$
DECLARE
    prefix TEXT;
    seq    INT;
BEGIN
    prefix := 'SQ-' || TO_CHAR(NOW(), 'YYYYMM') || '-';
    SELECT COALESCE(MAX(SUBSTRING(quote_number FROM '\d+$')::INT), 0) + 1
    INTO seq
    FROM supplier_quotes
    WHERE quote_number LIKE prefix || '%';
    NEW.quote_number := prefix || LPAD(seq::TEXT, 6, '0');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_gen_sq_number ON supplier_quotes;
CREATE TRIGGER trg_gen_sq_number
    BEFORE INSERT ON supplier_quotes
    FOR EACH ROW
    WHEN (NEW.quote_number IS NULL OR NEW.quote_number = '')
    EXECUTE FUNCTION gen_supplier_quote_number();

-- ─── Supplier Quote Items ────────────────────────────────────
CREATE TABLE IF NOT EXISTS supplier_quote_items (
    id              BIGSERIAL PRIMARY KEY,
    quote_id        BIGINT NOT NULL REFERENCES supplier_quotes(id) ON DELETE CASCADE,
    line_number     INT NOT NULL,
    bqms_code       TEXT NOT NULL,
    product_id      BIGINT REFERENCES products(id) ON DELETE SET NULL,
    description     TEXT,
    specification   TEXT,
    maker           TEXT,
    quantity        NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
    unit            TEXT NOT NULL DEFAULT 'EA',
    unit_price_cny  NUMERIC(14,4),
    unit_price_vnd  NUMERIC(14,2),
    line_total_cny  NUMERIC(14,2),
    line_total_vnd  NUMERIC(14,2),
    samsung_sell_price_vnd NUMERIC(14,2),          -- from SO/RFQ
    margin_pct      NUMERIC(5,2),                  -- line-level margin
    lead_time_days  INT,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (quote_id, line_number)
);

CREATE INDEX IF NOT EXISTS idx_sqi_quote     ON supplier_quote_items(quote_id);
CREATE INDEX IF NOT EXISTS idx_sqi_bqms      ON supplier_quote_items(bqms_code);
CREATE INDEX IF NOT EXISTS idx_sqi_product   ON supplier_quote_items(product_id) WHERE product_id IS NOT NULL;

-- ─── Shipments ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shipments (
    id              BIGSERIAL PRIMARY KEY,
    shipment_number TEXT NOT NULL UNIQUE,
    po_id           BIGINT NOT NULL REFERENCES purchase_orders(id) ON DELETE RESTRICT,
    supplier_id     BIGINT NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
    chain_code      TEXT,
    status          TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'in_transit', 'arrived_port', 'customs_clearance', 'received', 'cancelled')),
    origin_country  TEXT NOT NULL DEFAULT 'CN',
    incoterm        TEXT DEFAULT 'FOB',
    carrier         TEXT,
    tracking_number TEXT,
    bill_of_lading  TEXT,
    container_number TEXT,
    origin_port     TEXT,
    dest_port       TEXT DEFAULT 'Cảng Hải Phòng',
    etd             DATE,                          -- estimated time of departure
    atd             DATE,                          -- actual time of departure
    eta             DATE,                          -- estimated time of arrival
    ata             DATE,                          -- actual time of arrival
    received_at     TIMESTAMPTZ,
    total_weight_kg NUMERIC(10,3),
    total_cbm       NUMERIC(8,3),
    freight_cost_usd NUMERIC(12,2),
    customs_duty_vnd NUMERIC(14,2),
    other_costs_vnd NUMERIC(14,2),
    notes           TEXT,
    created_by      UUID NOT NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sh_po         ON shipments(po_id);
CREATE INDEX IF NOT EXISTS idx_sh_supplier   ON shipments(supplier_id);
CREATE INDEX IF NOT EXISTS idx_sh_chain      ON shipments(chain_code) WHERE chain_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sh_status     ON shipments(status);
CREATE INDEX IF NOT EXISTS idx_sh_eta        ON shipments(eta);
CREATE INDEX IF NOT EXISTS idx_sh_tracking   ON shipments(tracking_number) WHERE tracking_number IS NOT NULL;

-- Auto-generate shipment_number: SH-YYYYMM-NNNNNN
CREATE OR REPLACE FUNCTION gen_shipment_number() RETURNS TRIGGER AS $$
DECLARE
    prefix TEXT;
    seq    INT;
BEGIN
    prefix := 'SH-' || TO_CHAR(NOW(), 'YYYYMM') || '-';
    SELECT COALESCE(MAX(SUBSTRING(shipment_number FROM '\d+$')::INT), 0) + 1
    INTO seq
    FROM shipments
    WHERE shipment_number LIKE prefix || '%';
    NEW.shipment_number := prefix || LPAD(seq::TEXT, 6, '0');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_gen_shipment_number ON shipments;
CREATE TRIGGER trg_gen_shipment_number
    BEFORE INSERT ON shipments
    FOR EACH ROW
    WHEN (NEW.shipment_number IS NULL OR NEW.shipment_number = '')
    EXECUTE FUNCTION gen_shipment_number();

-- ─── Shipment Items ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shipment_items (
    id              BIGSERIAL PRIMARY KEY,
    shipment_id     BIGINT NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
    po_line_id      BIGINT REFERENCES po_line_items(id) ON DELETE SET NULL,
    product_id      BIGINT REFERENCES products(id) ON DELETE SET NULL,
    bqms_code       TEXT,
    description     TEXT,
    quantity_shipped NUMERIC(12,3) NOT NULL CHECK (quantity_shipped > 0),
    quantity_received NUMERIC(12,3),
    unit            TEXT NOT NULL DEFAULT 'EA',
    unit_price_cny  NUMERIC(14,4),
    line_total_cny  NUMERIC(14,2),
    weight_kg       NUMERIC(10,3),
    cbm             NUMERIC(8,3),
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shi_shipment  ON shipment_items(shipment_id);
CREATE INDEX IF NOT EXISTS idx_shi_po_line   ON shipment_items(po_line_id) WHERE po_line_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_shi_product   ON shipment_items(product_id) WHERE product_id IS NOT NULL;

-- ─── Invoices ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoices (
    id              BIGSERIAL PRIMARY KEY,
    invoice_number  TEXT NOT NULL UNIQUE,
    customer_id     BIGINT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
    sales_order_id  BIGINT REFERENCES sales_orders(id) ON DELETE SET NULL,
    chain_code      TEXT,
    status          TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'sent', 'partially_paid', 'paid', 'overdue', 'cancelled', 'disputed')),
    invoice_date    DATE NOT NULL DEFAULT CURRENT_DATE,
    due_date        DATE NOT NULL,
    currency        TEXT NOT NULL DEFAULT 'VND',
    subtotal        NUMERIC(16,2) NOT NULL DEFAULT 0,
    vat_amount      NUMERIC(16,2) NOT NULL DEFAULT 0,
    total_amount    NUMERIC(16,2) NOT NULL DEFAULT 0,
    paid_amount     NUMERIC(16,2) NOT NULL DEFAULT 0,
    balance_due     NUMERIC(16,2) GENERATED ALWAYS AS (total_amount - paid_amount) STORED,
    payment_terms   TEXT DEFAULT 'NET30',
    bank_account    TEXT,
    pdf_path        TEXT,
    sent_at         TIMESTAMPTZ,
    sent_via        TEXT,
    notes           TEXT,
    ar_id           BIGINT REFERENCES accounts_receivable(id) ON DELETE SET NULL,
    created_by      UUID NOT NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inv_customer   ON invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_inv_so         ON invoices(sales_order_id) WHERE sales_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inv_chain      ON invoices(chain_code) WHERE chain_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inv_status     ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_inv_due        ON invoices(due_date);
CREATE INDEX IF NOT EXISTS idx_inv_overdue    ON invoices(due_date, status)
    WHERE status NOT IN ('paid', 'cancelled');

-- ─── Invoice Items ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoice_items (
    id              BIGSERIAL PRIMARY KEY,
    invoice_id      BIGINT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    line_number     INT NOT NULL,
    so_line_id      BIGINT,
    product_id      BIGINT REFERENCES products(id) ON DELETE SET NULL,
    bqms_code       TEXT,
    description     TEXT NOT NULL,
    specification   TEXT,
    unit            TEXT NOT NULL DEFAULT 'EA',
    quantity        NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
    unit_price      NUMERIC(14,4) NOT NULL,
    vat_rate        NUMERIC(5,2) NOT NULL DEFAULT 10,
    subtotal        NUMERIC(16,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
    vat_amount      NUMERIC(16,2) GENERATED ALWAYS AS (ROUND(quantity * unit_price * vat_rate / 100, 2)) STORED,
    line_total      NUMERIC(16,2) GENERATED ALWAYS AS (quantity * unit_price + ROUND(quantity * unit_price * vat_rate / 100, 2)) STORED,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (invoice_id, line_number)
);

CREATE INDEX IF NOT EXISTS idx_ii_invoice    ON invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_ii_product    ON invoice_items(product_id) WHERE product_id IS NOT NULL;

-- ─── Deal Margins ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS deal_margins (
    id              BIGSERIAL PRIMARY KEY,
    chain_code      TEXT NOT NULL UNIQUE,
    sales_order_id  BIGINT REFERENCES sales_orders(id) ON DELETE SET NULL,
    invoice_id      BIGINT REFERENCES invoices(id) ON DELETE SET NULL,
    -- Revenue side
    revenue_vnd     NUMERIC(16,2) NOT NULL DEFAULT 0,    -- Samsung invoice total
    -- Cost side
    cogs_vnd        NUMERIC(16,2) NOT NULL DEFAULT 0,    -- supplier buy price in VND
    freight_vnd     NUMERIC(16,2) NOT NULL DEFAULT 0,
    customs_duty_vnd NUMERIC(16,2) NOT NULL DEFAULT 0,
    other_costs_vnd NUMERIC(16,2) NOT NULL DEFAULT 0,
    total_cost_vnd  NUMERIC(16,2) GENERATED ALWAYS AS
                        (cogs_vnd + freight_vnd + customs_duty_vnd + other_costs_vnd) STORED,
    gross_profit_vnd NUMERIC(16,2) GENERATED ALWAYS AS
                        (revenue_vnd - (cogs_vnd + freight_vnd + customs_duty_vnd + other_costs_vnd)) STORED,
    margin_pct      NUMERIC(6,3) GENERATED ALWAYS AS
                        (CASE WHEN revenue_vnd = 0 THEN 0
                         ELSE ROUND((revenue_vnd - (cogs_vnd + freight_vnd + customs_duty_vnd + other_costs_vnd))
                              / revenue_vnd * 100, 3) END) STORED,
    exchange_rate_cny NUMERIC(10,4),
    exchange_rate_usd NUMERIC(10,4),
    calculated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dm_chain      ON deal_margins(chain_code);
CREATE INDEX IF NOT EXISTS idx_dm_so         ON deal_margins(sales_order_id) WHERE sales_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dm_margin     ON deal_margins(margin_pct);

-- ─── Exchange Rates ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS exchange_rates (
    id              BIGSERIAL PRIMARY KEY,
    rate_date       DATE NOT NULL,
    from_currency   TEXT NOT NULL,
    to_currency     TEXT NOT NULL DEFAULT 'VND',
    rate            NUMERIC(14,6) NOT NULL CHECK (rate > 0),
    source          TEXT NOT NULL DEFAULT 'manual'
                        CHECK (source IN ('manual', 'vietcombank', 'sbv', 'api')),
    created_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (rate_date, from_currency, to_currency)
);

CREATE INDEX IF NOT EXISTS idx_er_date       ON exchange_rates(rate_date DESC);
CREATE INDEX IF NOT EXISTS idx_er_pair       ON exchange_rates(from_currency, to_currency, rate_date DESC);

-- Seed with a reasonable default if table is empty
INSERT INTO exchange_rates (rate_date, from_currency, to_currency, rate, source)
VALUES (CURRENT_DATE, 'CNY', 'VND', 3450.00, 'manual'),
       (CURRENT_DATE, 'USD', 'VND', 25450.00, 'manual')
ON CONFLICT (rate_date, from_currency, to_currency) DO NOTHING;

-- ─── Supplier Ratings ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS supplier_ratings (
    id              BIGSERIAL PRIMARY KEY,
    supplier_id     BIGINT NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
    period_year     INT NOT NULL,
    period_quarter  INT NOT NULL CHECK (period_quarter BETWEEN 1 AND 4),
    total_orders    INT NOT NULL DEFAULT 0,
    on_time_orders  INT NOT NULL DEFAULT 0,
    quality_rejects INT NOT NULL DEFAULT 0,
    avg_lead_time_days NUMERIC(6,2),
    on_time_rate    NUMERIC(5,2) GENERATED ALWAYS AS
                        (CASE WHEN total_orders = 0 THEN 0
                         ELSE ROUND(on_time_orders::NUMERIC / total_orders * 100, 2) END) STORED,
    quality_rate    NUMERIC(5,2) GENERATED ALWAYS AS
                        (CASE WHEN total_orders = 0 THEN 100
                         ELSE ROUND((1 - quality_rejects::NUMERIC / NULLIF(total_orders, 0)) * 100, 2) END) STORED,
    composite_score NUMERIC(3,2) CHECK (composite_score BETWEEN 0 AND 5),
    notes           TEXT,
    calculated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (supplier_id, period_year, period_quarter)
);

CREATE INDEX IF NOT EXISTS idx_sr_supplier  ON supplier_ratings(supplier_id);
CREATE INDEX IF NOT EXISTS idx_sr_period    ON supplier_ratings(period_year DESC, period_quarter DESC);

-- ─── Revenue Chain (deal-level linker) ───────────────────────
CREATE TABLE IF NOT EXISTS revenue_chain (
    id              BIGSERIAL PRIMARY KEY,
    chain_code      TEXT NOT NULL UNIQUE,
    rfq_id          BIGINT REFERENCES bqms_rfq(id) ON DELETE SET NULL,
    sales_order_id  BIGINT REFERENCES sales_orders(id) ON DELETE SET NULL,
    supplier_quote_id BIGINT REFERENCES supplier_quotes(id) ON DELETE SET NULL,
    po_id           BIGINT REFERENCES purchase_orders(id) ON DELETE SET NULL,
    shipment_id     BIGINT REFERENCES shipments(id) ON DELETE SET NULL,
    invoice_id      BIGINT REFERENCES invoices(id) ON DELETE SET NULL,
    ar_id           BIGINT REFERENCES accounts_receivable(id) ON DELETE SET NULL,
    ap_id           BIGINT REFERENCES accounts_payable(id) ON DELETE SET NULL,
    -- Lifecycle status
    rfq_status          TEXT,
    so_status           TEXT,
    quote_status        TEXT,
    po_status           TEXT,
    shipment_status     TEXT,
    invoice_status      TEXT,
    payment_status      TEXT,
    -- Current stage tracking
    current_stage   TEXT NOT NULL DEFAULT 'rfq'
                        CHECK (current_stage IN ('rfq', 'quotation', 'so', 'supplier_quote', 'po', 'shipment', 'invoice', 'payment', 'completed')),
    is_complete     BOOLEAN NOT NULL DEFAULT false,
    completed_at    TIMESTAMPTZ,
    -- Financials summary
    revenue_vnd     NUMERIC(16,2),
    cogs_vnd        NUMERIC(16,2),
    margin_pct      NUMERIC(6,3),
    created_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rc_rfq        ON revenue_chain(rfq_id) WHERE rfq_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rc_so         ON revenue_chain(sales_order_id) WHERE sales_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rc_po         ON revenue_chain(po_id) WHERE po_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rc_stage      ON revenue_chain(current_stage);
CREATE INDEX IF NOT EXISTS idx_rc_complete   ON revenue_chain(is_complete);

-- ─── ALTER existing tables — add linking columns ─────────────

-- bqms_rfq: add chain_code, sales_order_id
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'bqms_rfq' AND column_name = 'chain_code') THEN
        ALTER TABLE bqms_rfq ADD COLUMN chain_code TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'bqms_rfq' AND column_name = 'sales_order_id') THEN
        ALTER TABLE bqms_rfq ADD COLUMN sales_order_id BIGINT REFERENCES sales_orders(id) ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_bqms_rfq_chain ON bqms_rfq(chain_code) WHERE chain_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bqms_rfq_so    ON bqms_rfq(sales_order_id) WHERE sales_order_id IS NOT NULL;

-- purchase_orders: add supplier_quote_id, sales_order_id, chain_code
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'purchase_orders' AND column_name = 'supplier_quote_id') THEN
        ALTER TABLE purchase_orders ADD COLUMN supplier_quote_id BIGINT REFERENCES supplier_quotes(id) ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'purchase_orders' AND column_name = 'sales_order_id') THEN
        ALTER TABLE purchase_orders ADD COLUMN sales_order_id BIGINT REFERENCES sales_orders(id) ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'purchase_orders' AND column_name = 'chain_code') THEN
        ALTER TABLE purchase_orders ADD COLUMN chain_code TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'purchase_orders' AND column_name = 'needs_review') THEN
        ALTER TABLE purchase_orders ADD COLUMN needs_review BOOLEAN NOT NULL DEFAULT false;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_po_sq_id      ON purchase_orders(supplier_quote_id) WHERE supplier_quote_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_po_so_id      ON purchase_orders(sales_order_id) WHERE sales_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_po_chain      ON purchase_orders(chain_code) WHERE chain_code IS NOT NULL;

-- sales_orders: add rfq_id, chain_code
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'sales_orders' AND column_name = 'rfq_id') THEN
        ALTER TABLE sales_orders ADD COLUMN rfq_id BIGINT REFERENCES bqms_rfq(id) ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'sales_orders' AND column_name = 'chain_code') THEN
        ALTER TABLE sales_orders ADD COLUMN chain_code TEXT;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_so_rfq_id     ON sales_orders(rfq_id) WHERE rfq_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_so_chain      ON sales_orders(chain_code) WHERE chain_code IS NOT NULL;
