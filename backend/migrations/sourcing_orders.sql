-- ============================================================
-- sourcing_orders + sourcing_order_status_history
-- Quote-to-order pipeline phát sinh từ Sourcing Library.
-- Pattern: TEXT + CHECK (theo sales_orders, crm_pipeline_cards, quote_batches).
-- Date: 2026-06-03 (Thang)
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- sourcing_orders
-- ------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS sourcing_orders_seq START 1;

CREATE TABLE IF NOT EXISTS sourcing_orders (
    id                  BIGSERIAL PRIMARY KEY,
    order_number        TEXT UNIQUE NOT NULL,

    -- ---- Link nguồn ----
    sourcing_entry_ids  BIGINT[] NOT NULL DEFAULT '{}',
    source_type         TEXT NOT NULL DEFAULT 'sourcing'
                            CHECK (source_type IN ('sourcing','manual','bqms_po','imv_po')),
    source_ref_id       BIGINT,
    source_ref_no       TEXT,

    -- ---- Khách ----
    customer_id         BIGINT REFERENCES customers(id) ON DELETE SET NULL,
    customer_name       TEXT NOT NULL,
    customer_contact    TEXT,
    customer_email      TEXT,
    customer_phone      TEXT,
    customer_address    TEXT,
    person_in_charge    TEXT,

    -- ---- Form fields ----
    order_date          DATE NOT NULL DEFAULT CURRENT_DATE,
    delivery_date       DATE,
    payment_terms       TEXT,

    -- ---- Items snapshot ----
    line_items          JSONB NOT NULL DEFAULT '[]'::jsonb,

    -- ---- Tổng tiền ----
    subtotal_vnd        NUMERIC(18,0) NOT NULL DEFAULT 0,
    tax_vnd             NUMERIC(18,0) NOT NULL DEFAULT 0,
    shipping_fee_vnd    NUMERIC(18,0) NOT NULL DEFAULT 0,
    discount_vnd        NUMERIC(18,0) NOT NULL DEFAULT 0,
    total_value_vnd     NUMERIC(18,0) NOT NULL DEFAULT 0,
    currency            TEXT NOT NULL DEFAULT 'VND',

    -- ---- Status (timeline track) ----
    status              TEXT NOT NULL DEFAULT 'draft'
                            CHECK (status IN (
                                'draft','quoted','confirmed',
                                'payment_requested','payment_approved',
                                'shipped','delivered','cancelled'
                            )),

    -- ---- PDF báo giá ----
    quote_pdf_url       TEXT,
    quote_pdf_version   INT NOT NULL DEFAULT 0,
    quote_sent_at       TIMESTAMPTZ,
    quote_sent_to       TEXT[],

    -- ---- Link sang accounting / SO chính thức ----
    payment_request_id  BIGINT,
    sales_order_id      BIGINT REFERENCES sales_orders(id) ON DELETE SET NULL,
    invoice_id          BIGINT,

    -- ---- Audit ----
    assigned_to         UUID REFERENCES users(id) ON DELETE SET NULL,
    created_by_id       BIGINT,
    created_by_email    TEXT,
    updated_by_id       BIGINT,
    updated_by_email    TEXT,
    notes               TEXT,
    internal_notes      TEXT,
    deleted_at          TIMESTAMPTZ,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_so_order_number    ON sourcing_orders(order_number);
CREATE INDEX IF NOT EXISTS idx_so_status          ON sourcing_orders(status)                       WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_so_customer_id     ON sourcing_orders(customer_id, order_date DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_so_assigned_to     ON sourcing_orders(assigned_to)                  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_so_created_at      ON sourcing_orders(created_at DESC)              WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_so_payment_req     ON sourcing_orders(payment_request_id)           WHERE payment_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_so_entry_ids_gin   ON sourcing_orders USING GIN(sourcing_entry_ids);

CREATE OR REPLACE FUNCTION set_updated_at_sourcing_orders()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_so_updated_at ON sourcing_orders;
CREATE TRIGGER trg_so_updated_at
    BEFORE UPDATE ON sourcing_orders
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_sourcing_orders();

COMMENT ON TABLE sourcing_orders IS
  'Quote-to-order pipeline trên Sourcing Library. Draft -> Quoted -> Confirmed -> Payment -> Shipped -> Delivered.';
COMMENT ON COLUMN sourcing_orders.line_items IS
  'JSONB snapshot mỗi line tại thời điểm tạo order. KHÔNG join lại sourcing_entries vì giá có thể thay đổi.';
COMMENT ON COLUMN sourcing_orders.sourcing_entry_ids IS
  'Mảng ID nguồn để trace ngược. GIN index cho query "đơn nào dùng entry X".';

-- ------------------------------------------------------------
-- sourcing_order_status_history (append-only timeline)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sourcing_order_status_history (
    id              BIGSERIAL PRIMARY KEY,
    order_id        BIGINT NOT NULL REFERENCES sourcing_orders(id) ON DELETE CASCADE,
    from_status     TEXT,
    status          TEXT NOT NULL
                        CHECK (status IN (
                            'draft','quoted','confirmed',
                            'payment_requested','payment_approved',
                            'shipped','delivered','cancelled'
                        )),
    by_user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
    by_user_email   TEXT,
    by_user_name    TEXT,
    note            TEXT,
    metadata        JSONB,
    at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sosh_order_id ON sourcing_order_status_history(order_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_sosh_status   ON sourcing_order_status_history(status);
CREATE INDEX IF NOT EXISTS idx_sosh_user     ON sourcing_order_status_history(by_user_id);

-- Trigger: tự ghi history mỗi khi status đổi
CREATE OR REPLACE FUNCTION log_sourcing_order_status_change()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO sourcing_order_status_history
            (order_id, from_status, status, by_user_email, note, metadata)
        VALUES
            (NEW.id, NULL, NEW.status, NEW.created_by_email,
             'Tạo đơn', jsonb_build_object('order_number', NEW.order_number));
        RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
        INSERT INTO sourcing_order_status_history
            (order_id, from_status, status, by_user_email, note, metadata)
        VALUES
            (NEW.id, OLD.status, NEW.status, NEW.updated_by_email,
             NULL,
             jsonb_build_object(
                 'order_number', NEW.order_number,
                 'total_value_vnd', NEW.total_value_vnd,
                 'payment_request_id', NEW.payment_request_id
             ));
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sosh_log ON sourcing_orders;
CREATE TRIGGER trg_sosh_log
    AFTER INSERT OR UPDATE OF status ON sourcing_orders
    FOR EACH ROW EXECUTE FUNCTION log_sourcing_order_status_change();

COMMENT ON TABLE sourcing_order_status_history IS
  'Append-only timeline. Render UI Timeline component sort by `at DESC`.';

COMMIT;
