-- ════════════════════════════════════════════════════════════
-- Song Chau ERP — Database Schema v1.0
-- Generated from MASTER_CONTEXT_v2.md Section 4
-- ════════════════════════════════════════════════════════════

-- EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "unaccent";

-- ════════════════════════════════════
-- ENUMS
-- ════════════════════════════════════
CREATE TYPE role_enum AS ENUM (
    'admin', 'manager', 'procurement', 'warehouse', 'staff', 'accountant'
);

CREATE TYPE workflow_status AS ENUM (
    'draft', 'pending_l1', 'pending_l2',
    'approved', 'rejected', 'cancelled'
);

CREATE TYPE workflow_type AS ENUM (
    'purchase_approval',
    'po_approval',
    'rfq_approval',
    'bqms_quotation',
    'expense_approval',
    'task_assignment'
);

CREATE TYPE po_status AS ENUM (
    'draft', 'pending_approval', 'approved',
    'sent_to_supplier', 'confirmed', 'in_transit',
    'partial_received', 'received', 'closed', 'cancelled'
);

CREATE TYPE notification_type AS ENUM (
    'workflow_request',
    'workflow_approved',
    'workflow_rejected',
    'deadline_reminder',
    'stock_alert',
    'po_received',
    'bqms_rfq_new',
    'report_ready'
);

-- ════════════════════════════════════
-- CORE TABLES
-- ════════════════════════════════════

CREATE TABLE users (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    email           TEXT        NOT NULL UNIQUE,
    full_name       TEXT        NOT NULL,
    display_name    TEXT,
    role            role_enum   NOT NULL,
    department      TEXT,
    phone           TEXT,
    hashed_password TEXT        NOT NULL,
    m365_id         TEXT UNIQUE,
    is_active       BOOLEAN     NOT NULL DEFAULT true,
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by      UUID        REFERENCES users(id)
);

CREATE TABLE workflow_instances (
    id              BIGSERIAL   PRIMARY KEY,
    workflow_type   workflow_type NOT NULL,
    current_status  workflow_status NOT NULL DEFAULT 'draft',
    title           TEXT        NOT NULL,
    description     TEXT,
    amount          NUMERIC(15,2),
    currency        TEXT        DEFAULT 'VND',
    priority        SMALLINT    DEFAULT 2,
    data            JSONB       NOT NULL DEFAULT '{}',
    ref_type        TEXT,
    ref_id          BIGINT,
    created_by      UUID        NOT NULL REFERENCES users(id),
    assigned_to     UUID        REFERENCES users(id),
    deadline        TIMESTAMPTZ,
    closed_at       TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE workflow_history (
    id              BIGSERIAL   PRIMARY KEY,
    instance_id     BIGINT      NOT NULL REFERENCES workflow_instances(id) ON DELETE CASCADE,
    from_status     workflow_status,
    to_status       workflow_status NOT NULL,
    action          TEXT        NOT NULL,
    actor_id        UUID        NOT NULL REFERENCES users(id),
    comment         TEXT,
    ip_address      INET,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ════════════════════════════════════
-- SUPPLIER & PO TABLES
-- ════════════════════════════════════

CREATE TABLE suppliers (
    id              BIGSERIAL   PRIMARY KEY,
    name            TEXT        NOT NULL,
    name_unaccent   TEXT GENERATED ALWAYS AS (unaccent(lower(name))) STORED,
    contact_name    TEXT,
    contact_email   TEXT,
    contact_phone   TEXT,
    contact_wechat  TEXT,
    country         TEXT        NOT NULL DEFAULT 'CN',
    address         TEXT,
    payment_terms   TEXT,
    lead_time_days  SMALLINT,
    rating          NUMERIC(3,1) CHECK (rating BETWEEN 0 AND 5),
    currency        TEXT        DEFAULT 'USD',
    notes           TEXT,
    is_active       BOOLEAN     NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by      UUID        NOT NULL REFERENCES users(id)
);

CREATE SEQUENCE po_number_seq START 1;

CREATE TABLE purchase_orders (
    id              BIGSERIAL   PRIMARY KEY,
    po_number       TEXT        NOT NULL UNIQUE,
    supplier_id     BIGINT      NOT NULL REFERENCES suppliers(id),
    workflow_id     BIGINT      REFERENCES workflow_instances(id),
    status          po_status   NOT NULL DEFAULT 'draft',
    subtotal        NUMERIC(15,2) NOT NULL DEFAULT 0,
    tax_amount      NUMERIC(15,2) NOT NULL DEFAULT 0,
    shipping_cost   NUMERIC(15,2) NOT NULL DEFAULT 0,
    total_amount    NUMERIC(15,2) NOT NULL DEFAULT 0,
    currency        TEXT        NOT NULL DEFAULT 'USD',
    exchange_rate   NUMERIC(10,4),
    amount_vnd      NUMERIC(15,0) GENERATED ALWAYS AS
                    (total_amount * COALESCE(exchange_rate, 1)) STORED,
    order_date      DATE,
    expected_date   DATE,
    confirmed_date  DATE,
    received_date   DATE,
    incoterms       TEXT,
    shipping_method TEXT,
    tracking_number TEXT,
    attachment_path TEXT,
    notes           TEXT,
    internal_note   TEXT,
    created_by      UUID        NOT NULL REFERENCES users(id),
    approved_by     UUID        REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE po_line_items (
    id              BIGSERIAL   PRIMARY KEY,
    po_id           BIGINT      NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    line_number     SMALLINT    NOT NULL,
    product_code    TEXT,
    product_name    TEXT        NOT NULL,
    specification   TEXT,
    maker           TEXT,
    quantity        NUMERIC(10,3) NOT NULL,
    unit            TEXT        NOT NULL DEFAULT 'PCS',
    unit_price      NUMERIC(15,4) NOT NULL,
    subtotal        NUMERIC(15,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
    currency        TEXT        NOT NULL DEFAULT 'USD',
    notes           TEXT
);

CREATE TABLE rfq_requests (
    id              BIGSERIAL   PRIMARY KEY,
    rfq_number      TEXT        NOT NULL UNIQUE,
    title           TEXT        NOT NULL,
    description     TEXT,
    deadline        DATE        NOT NULL,
    status          TEXT        NOT NULL DEFAULT 'draft',
    created_by      UUID        NOT NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE rfq_quotations (
    id              BIGSERIAL   PRIMARY KEY,
    rfq_id          BIGINT      NOT NULL REFERENCES rfq_requests(id),
    supplier_id     BIGINT      NOT NULL REFERENCES suppliers(id),
    unit_price      NUMERIC(15,4),
    currency        TEXT        DEFAULT 'USD',
    lead_time_days  SMALLINT,
    validity_date   DATE,
    terms           TEXT,
    is_selected     BOOLEAN     NOT NULL DEFAULT false,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ════════════════════════════════════
-- INVENTORY
-- ════════════════════════════════════

CREATE TABLE inventory (
    id              BIGSERIAL   PRIMARY KEY,
    product_code    TEXT        NOT NULL UNIQUE,
    product_name    TEXT        NOT NULL,
    name_unaccent   TEXT GENERATED ALWAYS AS (unaccent(lower(product_name))) STORED,
    category        TEXT,
    brand           TEXT,
    specification   TEXT,
    unit            TEXT        NOT NULL DEFAULT 'PCS',
    quantity        NUMERIC(10,3) NOT NULL DEFAULT 0,
    reserved_qty    NUMERIC(10,3) NOT NULL DEFAULT 0,
    available_qty   NUMERIC(10,3) GENERATED ALWAYS AS (quantity - reserved_qty) STORED,
    min_stock       NUMERIC(10,3) NOT NULL DEFAULT 0,
    max_stock       NUMERIC(10,3),
    location        TEXT,
    unit_cost       NUMERIC(15,4),
    last_updated    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    notes           TEXT
);

CREATE TABLE inventory_movements (
    id              BIGSERIAL   PRIMARY KEY,
    product_code    TEXT        NOT NULL,
    movement_type   TEXT        NOT NULL,
    quantity        NUMERIC(10,3) NOT NULL,
    reference_type  TEXT,
    reference_id    BIGINT,
    before_qty      NUMERIC(10,3) NOT NULL,
    after_qty       NUMERIC(10,3) NOT NULL,
    unit_cost       NUMERIC(15,4),
    notes           TEXT,
    created_by      UUID        NOT NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ════════════════════════════════════
-- BQMS MODULE
-- ════════════════════════════════════

CREATE TABLE bqms_rfq_submissions (
    id              BIGSERIAL   PRIMARY KEY,
    rfq_number      TEXT        NOT NULL,
    req_no          TEXT,
    submission_date DATE        NOT NULL,
    deadline        DATE,
    status          TEXT        NOT NULL DEFAULT 'pending',
    items_count     SMALLINT,
    pdf_path        TEXT,
    excel_cam_ket   TEXT,
    excel_commercial TEXT,
    workflow_id     BIGINT      REFERENCES workflow_instances(id),
    submitted_by    UUID        REFERENCES users(id),
    approved_by     UUID        REFERENCES users(id),
    submitted_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE bqms_records (
    id              BIGSERIAL   PRIMARY KEY,
    po_no           TEXT        NOT NULL UNIQUE,
    req_no          TEXT,
    rfq_submission_id BIGINT    REFERENCES bqms_rfq_submissions(id),
    item_code       TEXT,
    specification   TEXT,
    manufacturer    TEXT,
    receiver_name   TEXT,
    req_delivery_date DATE,
    po_qty          INTEGER,
    secure_key      TEXT,
    pdf_path        TEXT,
    raw_data        JSONB,
    sync_status     TEXT        NOT NULL DEFAULT 'pending',
    synced_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at    TIMESTAMPTZ
);

CREATE MATERIALIZED VIEW bqms_kpi AS
SELECT
    COUNT(*)                                            AS total_items,
    COUNT(*) FILTER (WHERE sync_status = 'processed')  AS processed,
    COUNT(DISTINCT manufacturer)                        AS maker_count,
    MAX(synced_at)                                      AS last_synced
FROM bqms_records
WHERE synced_at > NOW() - INTERVAL '30 days';

-- ════════════════════════════════════
-- SUPPORT TABLES
-- ════════════════════════════════════

CREATE TABLE notifications (
    id              BIGSERIAL   PRIMARY KEY,
    recipient_id    UUID        NOT NULL REFERENCES users(id),
    type            notification_type NOT NULL,
    title           TEXT        NOT NULL,
    body            TEXT,
    is_read         BOOLEAN     NOT NULL DEFAULT false,
    read_at         TIMESTAMPTZ,
    ref_type        TEXT,
    ref_id          BIGINT,
    metadata        JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE audit_log (
    id              BIGSERIAL   PRIMARY KEY,
    user_id         UUID        REFERENCES users(id),
    user_email      TEXT,
    action          TEXT        NOT NULL,
    table_name      TEXT        NOT NULL,
    record_id       TEXT,
    old_data        JSONB,
    new_data        JSONB,
    ip_address      INET,
    user_agent      TEXT,
    request_id      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE file_meta (
    id              BIGSERIAL   PRIMARY KEY,
    filename        TEXT        NOT NULL,
    stored_filename TEXT        NOT NULL UNIQUE,
    file_path       TEXT        NOT NULL,
    mime_type       TEXT        NOT NULL,
    file_size       BIGINT      NOT NULL,
    checksum        TEXT,
    ref_type        TEXT,
    ref_id          BIGINT,
    is_public       BOOLEAN     NOT NULL DEFAULT false,
    uploaded_by     UUID        NOT NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE etl_sync_log (
    id              BIGSERIAL   PRIMARY KEY,
    sync_type       TEXT        NOT NULL,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at    TIMESTAMPTZ,
    status          TEXT        NOT NULL DEFAULT 'running',
    files_processed INTEGER     DEFAULT 0,
    rows_inserted   INTEGER     DEFAULT 0,
    rows_updated    INTEGER     DEFAULT 0,
    rows_skipped    INTEGER     DEFAULT 0,
    error_message   TEXT,
    delta_token     TEXT
);

CREATE TABLE price_history (
    id              BIGSERIAL   PRIMARY KEY,
    product_code    TEXT        NOT NULL,
    supplier_id     BIGINT      NOT NULL REFERENCES suppliers(id),
    unit_price      NUMERIC(15,4) NOT NULL,
    currency        TEXT        NOT NULL DEFAULT 'USD',
    quantity        NUMERIC(10,3),
    po_id           BIGINT      REFERENCES purchase_orders(id),
    recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ════════════════════════════════════
-- INDEXES
-- ════════════════════════════════════

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role) WHERE is_active = true;

CREATE INDEX idx_wf_assigned_pending ON workflow_instances(assigned_to, current_status)
    WHERE current_status IN ('pending_l1', 'pending_l2');
CREATE INDEX idx_wf_created_by ON workflow_instances(created_by, created_at DESC);
CREATE INDEX idx_wf_ref ON workflow_instances(ref_type, ref_id) WHERE ref_id IS NOT NULL;
CREATE INDEX idx_wf_history_instance ON workflow_history(instance_id, created_at DESC);

CREATE INDEX idx_po_supplier_status ON purchase_orders(supplier_id, status, created_at DESC);
CREATE INDEX idx_po_status_date ON purchase_orders(status, expected_date)
    WHERE status NOT IN ('closed', 'cancelled');
CREATE INDEX idx_po_number ON purchase_orders(po_number);

CREATE INDEX idx_inv_code ON inventory(product_code);
CREATE INDEX idx_inv_low_stock ON inventory(quantity) WHERE quantity < min_stock;
CREATE INDEX idx_inv_name_trgm ON inventory USING GIN(name_unaccent gin_trgm_ops);

CREATE INDEX idx_sup_name_trgm ON suppliers USING GIN(name_unaccent gin_trgm_ops);
CREATE INDEX idx_sup_active ON suppliers(country, is_active);

CREATE INDEX idx_notif_recipient_unread ON notifications(recipient_id, created_at DESC)
    WHERE is_read = false;

CREATE INDEX idx_audit_user ON audit_log(user_id, created_at DESC);
CREATE INDEX idx_audit_table ON audit_log(table_name, created_at DESC);

CREATE INDEX idx_bqms_delivery ON bqms_records(req_delivery_date);
CREATE INDEX idx_bqms_sync ON bqms_records(sync_status, synced_at DESC);

CREATE INDEX idx_price_product ON price_history(product_code, recorded_at DESC);
CREATE INDEX idx_price_supplier ON price_history(supplier_id, recorded_at DESC);

-- ════════════════════════════════════
-- ROW LEVEL SECURITY
-- ════════════════════════════════════

ALTER TABLE workflow_instances  ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders     ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications       ENABLE ROW LEVEL SECURITY;
ALTER TABLE file_meta           ENABLE ROW LEVEL SECURITY;

-- App role for RLS
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
        CREATE ROLE app_user;
    END IF;
END
$$;

GRANT ALL ON ALL TABLES IN SCHEMA public TO app_user;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO app_user;

CREATE POLICY wf_access ON workflow_instances
    FOR ALL TO app_user
    USING (
        current_setting('app.current_role', true) IN ('admin', 'manager', 'accountant')
        OR created_by = current_setting('app.current_user_id', true)::uuid
        OR assigned_to = current_setting('app.current_user_id', true)::uuid
    );

CREATE POLICY po_access ON purchase_orders
    FOR ALL TO app_user
    USING (
        current_setting('app.current_role', true) IN ('admin', 'manager', 'procurement', 'accountant')
        OR (
            current_setting('app.current_role', true) = 'warehouse'
            AND status IN ('in_transit', 'partial_received')
        )
    );

CREATE POLICY notif_own ON notifications
    FOR ALL TO app_user
    USING (recipient_id = current_setting('app.current_user_id', true)::uuid);

-- ════════════════════════════════════
-- TRIGGERS
-- ════════════════════════════════════

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_po_updated_at BEFORE UPDATE ON purchase_orders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_wf_updated_at BEFORE UPDATE ON workflow_instances
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_suppliers_updated_at BEFORE UPDATE ON suppliers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Workflow change notification
CREATE OR REPLACE FUNCTION notify_workflow_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    PERFORM pg_notify(
        'wf_events',
        json_build_object(
            'id',           NEW.id,
            'type',         NEW.workflow_type,
            'status',       NEW.current_status,
            'assigned_to',  NEW.assigned_to,
            'created_by',   NEW.created_by
        )::text
    );
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_wf_notify
    AFTER INSERT OR UPDATE OF current_status ON workflow_instances
    FOR EACH ROW EXECUTE FUNCTION notify_workflow_change();

-- Auto PO number
CREATE OR REPLACE FUNCTION generate_po_number()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.po_number IS NULL OR NEW.po_number = '' THEN
        NEW.po_number := 'PO-' || to_char(NOW(), 'YYYY') || '-' ||
                         LPAD(nextval('po_number_seq')::text, 4, '0');
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_po_number BEFORE INSERT ON purchase_orders
    FOR EACH ROW EXECUTE FUNCTION generate_po_number();

-- Audit log trigger
CREATE OR REPLACE FUNCTION auto_audit_log()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO audit_log (user_id, user_email, action, table_name, record_id, old_data, new_data, ip_address)
    VALUES (
        current_setting('app.current_user_id', true)::uuid,
        current_setting('app.current_user_email', true),
        TG_OP,
        TG_TABLE_NAME,
        COALESCE(NEW.id::text, OLD.id::text),
        CASE TG_OP WHEN 'DELETE' THEN row_to_json(OLD)::jsonb ELSE NULL END,
        CASE TG_OP WHEN 'DELETE' THEN NULL ELSE row_to_json(NEW)::jsonb END,
        current_setting('app.client_ip', true)::inet
    );
    RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER audit_purchase_orders AFTER INSERT OR UPDATE OR DELETE ON purchase_orders
    FOR EACH ROW EXECUTE FUNCTION auto_audit_log();
CREATE TRIGGER audit_workflow_instances AFTER INSERT OR UPDATE OR DELETE ON workflow_instances
    FOR EACH ROW EXECUTE FUNCTION auto_audit_log();
CREATE TRIGGER audit_inventory AFTER INSERT OR UPDATE OR DELETE ON inventory
    FOR EACH ROW EXECUTE FUNCTION auto_audit_log();

-- ════════════════════════════════════
-- SEED: Default admin user
-- Password: SongChau@2026 (bcrypt hash)
-- ════════════════════════════════════
INSERT INTO users (email, full_name, display_name, role, hashed_password)
VALUES (
    'thang@songchau.vn',
    'Nguyễn Đức Thắng',
    'Thắng',
    'admin',
    '$2b$12$LJ3m4ys5yVxVdTzS8WZ.7eGNfPbRKqRDXNwGJxYBhXpVDKFCymKnq'
);
