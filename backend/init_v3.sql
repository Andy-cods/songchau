-- ============================================================================
-- SONG CHAU ERP v3 — COMPLETE DATABASE SCHEMA
-- ============================================================================
-- File:        init_v3.sql
-- Database:    PostgreSQL 16
-- Encoding:    UTF-8
-- Author:      Song Chau Engineering Team
-- Created:     2026-03-29
-- Description: Schema tong the cho he thong ERP Song Chau
--              Bao gom 64 bang, 14 enum, 7 materialized view,
--              ~110 index, ~30 trigger, RLS policies, seed data.
--
-- Chay file:   psql -U scadmin -d songchau_erp -f init_v3.sql
-- ============================================================================

-- ============================================================================
-- 0. KHOI TAO — EXTENSIONS
-- ============================================================================
-- Cac extension can thiet cho he thong
-- uuid-ossp: Tao UUID v4 cho khoa chinh
-- pgcrypto:  Ma hoa mat khau bcrypt
-- pg_trgm:   Tim kiem gan dung (fuzzy search) bang trigram
-- unaccent:  Bo dau tieng Viet de tim kiem khong dau

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "unaccent";

-- ============================================================================
-- 1. ENUM TYPES — 14 loai du lieu liet ke
-- ============================================================================

-- Vai tro nguoi dung — 7 vai tro (Thang 2026-05-20: added viewer)
CREATE TYPE role_enum AS ENUM (
    'admin',        -- Quan tri vien toan quyen
    'manager',      -- Quan ly / Giam doc
    'procurement',  -- Phong mua hang
    'warehouse',    -- Phong kho
    'staff',        -- Nhan vien thuong
    'accountant',   -- Ke toan
    'viewer'        -- Khach (xem-only, mọi endpoint GET, từ chối POST/PUT/DELETE)
);

-- Trang thai quy trinh duyet — 6 trang thai
CREATE TYPE workflow_status AS ENUM (
    'draft',        -- Nhap, chua gui
    'pending_l1',   -- Cho duyet cap 1 (truong phong)
    'pending_l2',   -- Cho duyet cap 2 (giam doc)
    'approved',     -- Da duyet
    'rejected',     -- Tu choi
    'cancelled'     -- Da huy
);

-- Loai quy trinh duyet — 6 loai
CREATE TYPE workflow_type AS ENUM (
    'purchase_approval',   -- Duyet yeu cau mua hang
    'po_approval',         -- Duyet don dat hang
    'rfq_approval',        -- Duyet yeu cau bao gia
    'bqms_quotation',      -- Duyet bao gia BQMS
    'expense_approval',    -- Duyet chi phi
    'task_assignment'       -- Giao viec
);

-- Trang thai don dat hang noi bo — 10 trang thai
CREATE TYPE po_status AS ENUM (
    'draft',              -- Nhap
    'pending_approval',   -- Cho duyet
    'approved',           -- Da duyet
    'sent_to_supplier',   -- Da gui cho NCC
    'confirmed',          -- NCC xac nhan
    'in_transit',         -- Dang van chuyen
    'partial_received',   -- Nhan mot phan
    'received',           -- Da nhan du
    'closed',             -- Dong
    'cancelled'           -- Huy
);

-- Loai thong bao — 8 loai
CREATE TYPE notification_type AS ENUM (
    'workflow_request',    -- Yeu cau duyet
    'workflow_approved',   -- Da duyet
    'workflow_rejected',   -- Tu choi
    'deadline_reminder',   -- Nhac hen
    'stock_alert',         -- Canh bao ton kho
    'po_received',         -- Don hang da nhan
    'bqms_rfq_new',        -- RFQ moi tu BQMS
    'report_ready'         -- Bao cao san sang
);

-- Ma tien te — 6 dong tien chinh
CREATE TYPE currency_code AS ENUM (
    'VND',  -- Viet Nam Dong
    'USD',  -- US Dollar
    'RMB',  -- Nhan dan te (Trung Quoc)
    'KRW',  -- Won (Han Quoc)
    'JPY',  -- Yen (Nhat Ban)
    'EUR'   -- Euro
);

-- He thong kinh doanh — 2 he thong
CREATE TYPE business_system AS ENUM (
    'bqms',  -- BQMS — Samsung purchasing system
    'imv'    -- IMV — Thuong mai quoc te
);

-- Loai hang hoa — 2 loai
CREATE TYPE goods_type AS ENUM (
    'gia_cong',    -- Hang gia cong
    'thuong_mai'   -- Hang thuong mai
);

-- Trang thai giao hang — 4 trang thai
CREATE TYPE delivery_status AS ENUM (
    'chua_giao',      -- Chua giao
    'dang_giao',      -- Dang giao
    'da_giao',        -- Da giao
    'giao_mot_phan'   -- Giao mot phan
);

-- Ket qua bao gia RFQ — 4 trang thai
CREATE TYPE rfq_result AS ENUM (
    'pending',    -- Dang cho
    'won',        -- Trung
    'lost',       -- Thua
    'cancelled'   -- Huy
);

-- Trang thai bao gia — 7 trang thai
CREATE TYPE quotation_status AS ENUM (
    'draft',      -- Nhap
    'pending',    -- Cho xu ly
    'submitted',  -- Da gui
    'won',        -- Trung thau
    'lost',       -- That bai
    'expired',    -- Het han
    'cancelled'   -- Huy
);

-- Trang thai xu ly PO Samsung — 7 trang thai
CREATE TYPE samsung_po_process_status AS ENUM (
    'new',          -- Moi
    'confirmed',    -- Da xac nhan
    'unconfirmed',  -- Chua xac nhan
    'shipped',      -- Da gui hang
    'received',     -- Da nhan
    'invoiced',     -- Da xuat hoa don
    'closed'        -- Dong
);

-- Huong thanh toan — 2 huong
CREATE TYPE payment_direction AS ENUM (
    'inbound',   -- Tien vao (thu)
    'outbound'   -- Tien ra (chi)
);

-- Trang thai thanh toan — 5 trang thai
CREATE TYPE payment_status AS ENUM (
    'pending',       -- Cho thanh toan
    'partial_paid',  -- Thanh toan mot phan
    'paid',          -- Da thanh toan du
    'overdue',       -- Qua han
    'disputed'       -- Dang tranh chap
);

-- ============================================================================
-- 2. SEQUENCES — Chuoi so tu dong
-- ============================================================================

-- So thu tu don dat hang noi bo: PO-000001, PO-000002, ...
CREATE SEQUENCE po_number_seq START 1;

-- So thu tu don ban hang: SO-000001, SO-000002, ...
CREATE SEQUENCE sales_order_number_seq START 1;

-- ============================================================================
-- 3. HELPER FUNCTIONS — Ham tien ich
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 3a. Trigger function: Tu dong cap nhat cot updated_at
-- Moi bang co cot updated_at se dung trigger nay
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- 3b. Trigger function: Tao so PO tu dong theo format PO-YYYYMM-XXXXXX
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION generate_po_number()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.po_number IS NULL OR NEW.po_number = '' THEN
        NEW.po_number := 'PO-' || TO_CHAR(NOW(), 'YYYYMM') || '-' ||
                          LPAD(NEXTVAL('po_number_seq')::TEXT, 6, '0');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- 3c. Trigger function: Thong bao khi workflow thay doi trang thai
-- Su dung NOTIFY/LISTEN cua PostgreSQL de push realtime
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION notify_workflow_change()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.current_status IS DISTINCT FROM NEW.current_status THEN
        PERFORM pg_notify(
            'workflow_change',
            json_build_object(
                'id', NEW.id,
                'type', NEW.workflow_type,
                'old_status', OLD.current_status,
                'new_status', NEW.current_status,
                'assigned_to', NEW.assigned_to,
                'created_by', NEW.created_by
            )::TEXT
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- 3d. Trigger function: Ghi nhat ky audit tu dong
-- Ap dung cho tat ca bang quan trong (tai chinh, kho, workflow)
-- Luu lai du lieu cu va moi de truy vet thay doi
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION auto_audit_log()
RETURNS TRIGGER AS $$
DECLARE
    v_old_data JSONB;
    v_new_data JSONB;
    v_user_id  UUID;
    v_action   TEXT;
    v_record_id TEXT;
BEGIN
    -- Xac dinh hanh dong
    IF TG_OP = 'INSERT' THEN
        v_action := 'INSERT';
        v_new_data := to_jsonb(NEW);
        v_old_data := NULL;
    ELSIF TG_OP = 'UPDATE' THEN
        v_action := 'UPDATE';
        v_old_data := to_jsonb(OLD);
        v_new_data := to_jsonb(NEW);
    ELSIF TG_OP = 'DELETE' THEN
        v_action := 'DELETE';
        v_old_data := to_jsonb(OLD);
        v_new_data := NULL;
    END IF;

    -- Lay user_id tu session variable (set boi application)
    BEGIN
        v_user_id := current_setting('app.current_user_id', true)::UUID;
    EXCEPTION WHEN OTHERS THEN
        v_user_id := NULL;
    END;

    -- Lay record_id — uu tien truong 'id'
    IF TG_OP = 'DELETE' THEN
        v_record_id := v_old_data ->> 'id';
    ELSE
        v_record_id := v_new_data ->> 'id';
    END IF;

    -- Ghi vao audit_log
    INSERT INTO audit_log (user_id, action, table_name, record_id, old_data, new_data, created_at)
    VALUES (v_user_id, v_action, TG_TABLE_NAME, v_record_id, v_old_data, v_new_data, NOW());

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 4. TABLES — 64 bang chinh
-- ============================================================================
-- Thu tu tao: bang cha truoc, bang con sau (khong co tham chieu vong)

-- ============================================================================
-- NHOM 1: CORE — Bang loi (3 bang)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Bang 1: users — Nguoi dung he thong
-- 18 nhan vien voi 6 vai tro khac nhau
-- Dung UUID lam khoa chinh de bao mat
-- Soft delete bang cot deleted_at
-- ----------------------------------------------------------------------------
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email           TEXT NOT NULL UNIQUE,
    full_name       TEXT NOT NULL,
    display_name    TEXT,
    role            role_enum NOT NULL DEFAULT 'staff',
    department      TEXT,
    phone           TEXT,
    hashed_password TEXT NOT NULL,
    m365_id         TEXT UNIQUE,               -- Microsoft 365 SSO identifier
    is_active       BOOLEAN NOT NULL DEFAULT true,
    deleted_at      TIMESTAMPTZ,               -- Soft delete timestamp
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by      UUID REFERENCES users(id)
);
COMMENT ON TABLE users IS 'Nguoi dung he thong — 18 nhan vien, 6 roles';
COMMENT ON COLUMN users.m365_id IS 'Microsoft 365 account ID cho SSO';
COMMENT ON COLUMN users.deleted_at IS 'NULL = active, co gia tri = da xoa mem';

-- ----------------------------------------------------------------------------
-- Bang 2: workflow_instances — Cac phieu duyet (quy trinh)
-- Moi yeu cau duyet tao 1 ban ghi o day
-- Lien ket den bang goc qua ref_type + ref_id
-- ----------------------------------------------------------------------------
CREATE TABLE workflow_instances (
    id              BIGSERIAL PRIMARY KEY,
    workflow_type   workflow_type NOT NULL,
    current_status  workflow_status NOT NULL DEFAULT 'draft',
    title           TEXT NOT NULL,
    description     TEXT,
    amount          NUMERIC(15,2),             -- So tien can duyet
    currency        currency_code DEFAULT 'VND',
    priority        SMALLINT NOT NULL DEFAULT 2 CHECK (priority BETWEEN 1 AND 5),
    data            JSONB NOT NULL DEFAULT '{}',
    ref_type        TEXT,                      -- Ten bang tham chieu (vd: 'purchase_orders')
    ref_id          BIGINT,                    -- ID ban ghi tham chieu
    created_by      UUID NOT NULL REFERENCES users(id),
    assigned_to     UUID REFERENCES users(id), -- Nguoi duoc giao duyet
    deadline        TIMESTAMPTZ,
    started_at      TIMESTAMPTZ,
    closed_at       TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE workflow_instances IS 'Quy trinh duyet — moi yeu cau duyet la 1 ban ghi';

-- ----------------------------------------------------------------------------
-- Bang 3: workflow_history — Lich su duyet
-- IMMUTABLE — chi INSERT, khong UPDATE, khong DELETE
-- Ghi lai moi buoc chuyen trang thai
-- ----------------------------------------------------------------------------
CREATE TABLE workflow_history (
    id              BIGSERIAL PRIMARY KEY,
    instance_id     BIGINT NOT NULL REFERENCES workflow_instances(id) ON DELETE CASCADE,
    from_status     workflow_status,           -- NULL cho lan tao dau tien
    to_status       workflow_status NOT NULL,
    action          TEXT NOT NULL,             -- vd: 'submit', 'approve', 'reject'
    actor_id        UUID NOT NULL REFERENCES users(id),
    comment         TEXT,
    ip_address      INET,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    -- Khong co updated_at — ban ghi bat bien (immutable)
);
COMMENT ON TABLE workflow_history IS 'Lich su quy trinh duyet — bat bien, khong sua/xoa';

-- ============================================================================
-- NHOM 2: LOOKUP/REFERENCE — Bang tra cuu (5 bang)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Bang 4: exchange_rates — Ty gia hoi doai
-- Luu ty gia hang ngay theo loai (mua tien mat, chuyen khoan, ban)
-- ----------------------------------------------------------------------------
CREATE TABLE exchange_rates (
    id              BIGSERIAL PRIMARY KEY,
    rate_date       DATE NOT NULL,
    from_currency   currency_code NOT NULL DEFAULT 'USD',
    to_currency     currency_code NOT NULL DEFAULT 'VND',
    rate            NUMERIC(15,4) NOT NULL,
    rate_type       TEXT NOT NULL DEFAULT 'transfer'
                        CHECK (rate_type IN ('cash_buy', 'transfer', 'sell')),
    source          TEXT DEFAULT 'manual',     -- 'manual', 'vcb_api', 'bidv_api'
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_exchange_rate UNIQUE (rate_date, from_currency, to_currency, rate_type)
);
COMMENT ON TABLE exchange_rates IS 'Ty gia hoi doai hang ngay — VND, USD, RMB, KRW, JPY, EUR';

-- ----------------------------------------------------------------------------
-- Bang 5: hs_codes — Ma HS hai quan
-- Ma phan loai hang hoa theo he thong dieu hoa (Harmonized System)
-- ----------------------------------------------------------------------------
CREATE TABLE hs_codes (
    id              BIGSERIAL PRIMARY KEY,
    hs_code         TEXT NOT NULL UNIQUE,
    description_vi  TEXT,
    description_en  TEXT,
    tax_rate        NUMERIC(5,2),              -- Thue nhap khau (%)
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE hs_codes IS 'Ma HS hai quan — phan loai hang hoa xuat nhap khau';

-- ----------------------------------------------------------------------------
-- Bang 6: material_types — Loai vat lieu
-- Thep, nhom, dong, inox,... voi don gia va mat do
-- ----------------------------------------------------------------------------
CREATE TABLE material_types (
    id              BIGSERIAL PRIMARY KEY,
    type_code       TEXT NOT NULL UNIQUE,
    type_name       TEXT NOT NULL,
    unit_price_kg   NUMERIC(15,2),             -- Don gia theo kg
    density_g_cm3   NUMERIC(8,4),              -- Mat do (g/cm3)
    supplier_name   TEXT,
    notes           TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    deleted_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE material_types IS 'Loai vat lieu — thep, nhom, dong, inox,...';

-- ----------------------------------------------------------------------------
-- Bang 7: fiscal_periods — Ky ke toan
-- Quan ly thang/quy/nam tai chinh, trang thai dong/mo
-- ----------------------------------------------------------------------------
CREATE TABLE fiscal_periods (
    id              BIGSERIAL PRIMARY KEY,
    period_code     TEXT NOT NULL UNIQUE,       -- vd: '2026-M01', '2026-Q1', '2026-Y'
    period_type     TEXT NOT NULL CHECK (period_type IN ('month', 'quarter', 'year')),
    start_date      DATE NOT NULL,
    end_date        DATE NOT NULL,
    fiscal_year     SMALLINT NOT NULL,
    fiscal_quarter  SMALLINT,
    fiscal_month    SMALLINT,
    status          TEXT NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open', 'closing', 'closed', 'locked')),
    closed_by       UUID REFERENCES users(id),
    closed_at       TIMESTAMPTZ,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_period_dates CHECK (end_date > start_date)
);
-- Unique partial index: moi thang trong nam chi co 1 ban ghi
CREATE UNIQUE INDEX uq_fiscal_month ON fiscal_periods (fiscal_year, fiscal_month)
    WHERE period_type = 'month';
COMMENT ON TABLE fiscal_periods IS 'Ky ke toan — thang/quy/nam tai chinh';

-- ----------------------------------------------------------------------------
-- Bang 8: dim_date — Bang chieu ngay (Date Dimension)
-- Phuc vu bao cao, dashboard — populate tu 2020 den 2030
-- Danh dau ngay le Viet Nam, cuoi tuan
-- ----------------------------------------------------------------------------
CREATE TABLE dim_date (
    date_key        DATE PRIMARY KEY,
    year            SMALLINT NOT NULL,
    quarter         SMALLINT NOT NULL,
    month           SMALLINT NOT NULL,
    week_of_year    SMALLINT NOT NULL,
    day_of_month    SMALLINT NOT NULL,
    day_of_week     SMALLINT NOT NULL,         -- 0=Sunday, 6=Saturday (ISO)
    day_name        TEXT NOT NULL,              -- Monday, Tuesday,...
    day_name_vi     TEXT NOT NULL,              -- Thu Hai, Thu Ba,...
    month_name      TEXT NOT NULL,              -- January, February,...
    month_name_vi   TEXT NOT NULL,              -- Thang 1, Thang 2,...
    is_weekend      BOOLEAN NOT NULL DEFAULT false,
    is_holiday      BOOLEAN NOT NULL DEFAULT false,
    holiday_name    TEXT,
    is_working_day  BOOLEAN NOT NULL DEFAULT true,
    fiscal_year     SMALLINT NOT NULL,
    fiscal_quarter  SMALLINT NOT NULL,
    fiscal_month    SMALLINT NOT NULL
);
COMMENT ON TABLE dim_date IS 'Bang chieu ngay — 2020 den 2030, danh dau ngay le VN';

-- ============================================================================
-- NHOM 3: CRM — Quan ly khach hang (3 bang)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Bang 9: companies — Cong ty phap nhan
-- Song Chau va AMA la 2 phap nhan chinh
-- ----------------------------------------------------------------------------
CREATE TABLE companies (
    id              BIGSERIAL PRIMARY KEY,
    company_code    TEXT NOT NULL UNIQUE,
    company_name    TEXT NOT NULL,
    tax_code        TEXT UNIQUE,
    address         TEXT,
    representative  TEXT,
    phone           TEXT,
    email           TEXT,
    bank_name       TEXT,
    bank_account    TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE companies IS 'Phap nhan cong ty — Song Chau (SC), AMA Bac Ninh (AMA)';

-- ----------------------------------------------------------------------------
-- Bang 10: customers — Khach hang
-- Cot name_unaccent tu dong tao de tim kiem khong dau
-- ----------------------------------------------------------------------------
CREATE TABLE customers (
    id                   BIGSERIAL PRIMARY KEY,
    customer_code        TEXT UNIQUE,
    company_name         TEXT NOT NULL,
    company_name_unaccent TEXT GENERATED ALWAYS AS (unaccent(lower(company_name))) STORED,
    short_name           TEXT,
    tax_code             TEXT,
    address              TEXT,
    business_system      business_system,       -- bqms hoac imv
    customer_type        TEXT,
    is_active            BOOLEAN NOT NULL DEFAULT true,
    deleted_at           TIMESTAMPTZ,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE customers IS 'Khach hang — ho tro tim kiem khong dau qua company_name_unaccent';

-- ----------------------------------------------------------------------------
-- Bang 11: customer_contacts — Lien he khach hang
-- Moi khach hang co nhieu dau moi lien he
-- ----------------------------------------------------------------------------
CREATE TABLE customer_contacts (
    id              BIGSERIAL PRIMARY KEY,
    customer_id     BIGINT NOT NULL REFERENCES customers(id),
    full_name       TEXT NOT NULL,
    email           TEXT,
    phone           TEXT,
    department      TEXT,
    delivery_info   TEXT,
    warehouse_code  TEXT,
    is_primary      BOOLEAN NOT NULL DEFAULT false,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE customer_contacts IS 'Dau moi lien he cua khach hang';

-- ============================================================================
-- NHOM 4: SUPPLIERS — Nha cung cap (3 bang)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Bang 12: suppliers — Nha cung cap
-- Chu yeu la NCC Trung Quoc (country='CN')
-- Danh gia tu 0-5 sao
-- ----------------------------------------------------------------------------
CREATE TABLE suppliers (
    id              BIGSERIAL PRIMARY KEY,
    name            TEXT NOT NULL,
    name_unaccent   TEXT GENERATED ALWAYS AS (unaccent(lower(name))) STORED,
    contact_name    TEXT,
    contact_email   TEXT,
    contact_phone   TEXT,
    contact_wechat  TEXT,                      -- WeChat la kenh lien lac chinh voi NCC TQ
    country         TEXT DEFAULT 'CN',
    address         TEXT,
    payment_terms   TEXT,
    lead_time_days  SMALLINT,
    rating          NUMERIC(3,1) CHECK (rating >= 0 AND rating <= 5),
    default_currency currency_code DEFAULT 'USD',
    tax_code        TEXT,
    notes           TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    deleted_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by      UUID NOT NULL REFERENCES users(id)
);
COMMENT ON TABLE suppliers IS 'Nha cung cap — chu yeu TQ, danh gia 0-5 sao';

-- ----------------------------------------------------------------------------
-- Bang 13: supplier_contracts — Hop dong nha cung cap
-- Luu thong tin hop dong khung voi NCC
-- ----------------------------------------------------------------------------
CREATE TABLE supplier_contracts (
    id              BIGSERIAL PRIMARY KEY,
    supplier_id     BIGINT NOT NULL REFERENCES suppliers(id),
    contract_number TEXT UNIQUE,
    title           TEXT NOT NULL,
    start_date      DATE NOT NULL,
    end_date        DATE,
    payment_terms   TEXT,
    incoterms       TEXT,                      -- FOB, CIF, EXW,...
    default_currency currency_code DEFAULT 'USD',
    status          TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('draft', 'active', 'expired', 'terminated')),
    document_path   TEXT,
    notes           TEXT,
    created_by      UUID NOT NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE supplier_contracts IS 'Hop dong khung voi nha cung cap';

-- ============================================================================
-- NHOM 5: PRODUCTS — San pham (1 bang)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Bang 15: products — San pham
-- Mot san pham co the co ma BQMS va/hoac ma IMV
-- Cot name_unaccent tu dong tao de tim kiem khong dau
-- ----------------------------------------------------------------------------
CREATE TABLE products (
    id                   BIGSERIAL PRIMARY KEY,
    bqms_code            TEXT UNIQUE,
    imv_code             TEXT UNIQUE,
    customer_code        TEXT,
    product_name         TEXT NOT NULL,
    product_name_vi      TEXT,
    product_name_unaccent TEXT GENERATED ALWAYS AS (unaccent(lower(product_name))) STORED,
    specification        TEXT,
    maker                TEXT,
    category             TEXT,
    material_type_id     BIGINT REFERENCES material_types(id),
    hs_code_id           BIGINT REFERENCES hs_codes(id),
    unit                 TEXT NOT NULL DEFAULT 'EA',
    country_origin       TEXT,
    weight_kg            NUMERIC(10,4),
    dimensions_l         NUMERIC(10,3),
    dimensions_w         NUMERIC(10,3),
    dimensions_h         NUMERIC(10,3),
    business_system      business_system,
    image_path           TEXT,
    usage_location       TEXT,
    has_sample           BOOLEAN,
    additional_info      TEXT,
    is_active            BOOLEAN NOT NULL DEFAULT true,
    deleted_at           TIMESTAMPTZ,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE products IS 'San pham — ho tro ca BQMS va IMV, tim kiem khong dau';

-- Tao bang contract_price_items sau khi co products
-- ----------------------------------------------------------------------------
-- Bang 14: contract_price_items — Gia theo hop dong
-- Gia theo bac so luong (tier pricing)
-- ----------------------------------------------------------------------------
CREATE TABLE contract_price_items (
    id              BIGSERIAL PRIMARY KEY,
    contract_id     BIGINT NOT NULL REFERENCES supplier_contracts(id) ON DELETE CASCADE,
    product_id      BIGINT REFERENCES products(id),
    product_code    TEXT,
    tier_min_qty    NUMERIC(12,3) NOT NULL DEFAULT 1,
    tier_max_qty    NUMERIC(12,3),
    unit_price      NUMERIC(15,4) NOT NULL,
    currency        currency_code DEFAULT 'USD',
    moq             NUMERIC(12,3),             -- So luong dat hang toi thieu
    lead_time_days  SMALLINT,
    valid_from      DATE NOT NULL,
    valid_to        DATE,
    notes           TEXT
);
COMMENT ON TABLE contract_price_items IS 'Gia theo hop dong — ho tro gia bac (tier pricing)';

-- ============================================================================
-- NHOM 6: BQMS MODULE — He thong Samsung (12 bang)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Bang 16: bqms_rfq — Yeu cau bao gia tu Samsung
-- Import tu file Excel hoac sync tu he thong BQMS
-- Luu nhieu muc gia bao: v1, v2, v3, v4
-- ----------------------------------------------------------------------------
CREATE TABLE bqms_rfq (
    id                      BIGSERIAL PRIMARY KEY,
    rfq_number              TEXT NOT NULL,
    product_id              BIGINT REFERENCES products(id),
    bqms_code               TEXT,
    specification           TEXT,
    maker                   TEXT,
    inquiry_date            DATE,
    person_in_charge        UUID REFERENCES users(id),
    person_in_charge_name   TEXT,
    expected_qty            NUMERIC(12,3),
    unit                    TEXT DEFAULT 'EA',
    purchase_price_rmb      NUMERIC(15,4),
    purchase_price_vnd      NUMERIC(15,2),
    quoted_price_ama        NUMERIC(15,4),     -- Gia bao qua AMA
    quoted_price_bqms_v1    NUMERIC(15,4),     -- Gia bao lan 1
    quoted_price_bqms_v2    NUMERIC(15,4),     -- Gia bao lan 2
    quoted_price_bqms_v3    NUMERIC(15,4),     -- Gia bao lan 3
    quoted_price_bqms_v4    NUMERIC(15,4),     -- Gia bao lan 4
    supplier_id             BIGINT REFERENCES suppliers(id),
    supplier_name           TEXT,
    result                  rfq_result DEFAULT 'pending',
    result_date             DATE,
    result_updated_by       UUID REFERENCES users(id),
    report                  TEXT,
    notes                   TEXT,
    customer_source         TEXT DEFAULT 'samsung',
    data_source             TEXT NOT NULL DEFAULT 'excel_import'
                                CHECK (data_source IN ('manual', 'excel_import', 'api_sync', 'etl')),
    version                 INT NOT NULL DEFAULT 1,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE bqms_rfq IS 'RFQ tu Samsung — yeu cau bao gia, import tu Excel/BQMS';

-- ----------------------------------------------------------------------------
-- Bang 17: bqms_won_quotations — Bao gia da trung
-- Ghi nhan cac RFQ da trung thau, kem thong tin giao hang
-- ----------------------------------------------------------------------------
CREATE TABLE bqms_won_quotations (
    id                      BIGSERIAL PRIMARY KEY,
    rfq_id                  BIGINT REFERENCES bqms_rfq(id),
    rfq_number              TEXT,
    bqms_code               TEXT,
    product_id              BIGINT REFERENCES products(id),
    person_in_charge_name   TEXT,
    description             TEXT,
    specification           TEXT,
    quantity                NUMERIC(12,3),
    unit                    TEXT DEFAULT 'EA',
    po_price                NUMERIC(15,4),
    po_deadline             DATE,
    supplier_name           TEXT,
    hs_code                 TEXT,
    hs_code_id              BIGINT REFERENCES hs_codes(id),
    goods_description       TEXT,
    customs_char_count      INT,               -- So ky tu mo ta hai quan
    leadtime_days           SMALLINT,
    delivery_location       TEXT,
    invoice_issued          BOOLEAN DEFAULT false,
    notes                   TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE bqms_won_quotations IS 'Bao gia BQMS da trung thau';

-- ----------------------------------------------------------------------------
-- Bang 18: bqms_rfq_submissions — Nop bao gia BQMS
-- Quan ly quy trinh nop bao gia cho Samsung
-- ----------------------------------------------------------------------------
CREATE TABLE bqms_rfq_submissions (
    id              BIGSERIAL PRIMARY KEY,
    company_id      BIGINT REFERENCES companies(id),
    rfq_number      TEXT NOT NULL,
    req_no          TEXT,
    submission_date DATE NOT NULL,
    deadline        DATE,
    customer_id     BIGINT REFERENCES customers(id),
    vendor_name     TEXT,
    vendor_tax_code TEXT,
    vendor_address  TEXT,
    status          quotation_status NOT NULL DEFAULT 'draft',
    items_count     SMALLINT,
    pdf_path        TEXT,
    excel_cam_ket   TEXT,                      -- File Excel cam ket
    excel_commercial TEXT,                     -- File Excel thuong mai
    workflow_id     BIGINT REFERENCES workflow_instances(id),
    submitted_by    UUID REFERENCES users(id),
    approved_by     UUID REFERENCES users(id),
    submitted_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE bqms_rfq_submissions IS 'Nop bao gia BQMS — PDF + Excel cam ket + thuong mai';

-- ----------------------------------------------------------------------------
-- Bang 19: bqms_quotation_items — Chi tiet bao gia BQMS
-- Tung dong san pham trong bao gia, bao gom chi phi vat lieu va gia cong
-- ----------------------------------------------------------------------------
CREATE TABLE bqms_quotation_items (
    id                  BIGSERIAL PRIMARY KEY,
    submission_id       BIGINT NOT NULL REFERENCES bqms_rfq_submissions(id) ON DELETE CASCADE,
    line_number         SMALLINT NOT NULL,
    product_id          BIGINT REFERENCES products(id),
    bqms_code           TEXT,
    specification       TEXT,
    material_type       TEXT,
    material_spec       TEXT,
    material_qty        NUMERIC(12,3),
    material_unit_price NUMERIC(15,4),
    material_cost       NUMERIC(15,2),
    process_costs       JSONB NOT NULL DEFAULT '{}',  -- Chi phi gia cong theo cong doan
    quantity            NUMERIC(12,3) NOT NULL,
    unit                TEXT DEFAULT 'EA',
    unit_price          NUMERIC(15,4) NOT NULL,
    currency            currency_code DEFAULT 'VND',
    amount              NUMERIC(15,2),
    profit_margin_pct   NUMERIC(5,2),          -- Ty le loi nhuan (%)
    total_cost          NUMERIC(15,2),
    notes               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE bqms_quotation_items IS 'Chi tiet dong bao gia BQMS — vat lieu + gia cong';

-- ----------------------------------------------------------------------------
-- Bang 20: bqms_orders — Don hang BQMS
-- Theo doi don hang tu khi dat den khi giao
-- ----------------------------------------------------------------------------
CREATE TABLE bqms_orders (
    id              BIGSERIAL PRIMARY KEY,
    rfq_id          BIGINT REFERENCES bqms_rfq(id),
    rfq_number      TEXT,
    product_id      BIGINT REFERENCES products(id),
    bqms_code       TEXT,
    specification   TEXT,
    customer_id     BIGINT REFERENCES customers(id),
    customer_name   TEXT,
    expected_qty    NUMERIC(12,3),
    order_qty       NUMERIC(12,3),
    unit            TEXT DEFAULT 'EA',
    order_date      DATE,
    validity_date   DATE,
    status          TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'confirmed', 'in_production',
                                          'shipped', 'delivered', 'closed', 'cancelled')),
    delivered_qty   NUMERIC(12,3) NOT NULL DEFAULT 0,
    delivery_date   DATE,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE bqms_orders IS 'Don hang BQMS — tu dat den giao';

-- ----------------------------------------------------------------------------
-- Bang 21: bqms_samsung_po — PO tu Samsung
-- Dong bo tu he thong Samsung, du lieu goc luu trong raw_data
-- ----------------------------------------------------------------------------
CREATE TABLE bqms_samsung_po (
    id                      BIGSERIAL PRIMARY KEY,
    po_date                 DATE,
    po_number               TEXT NOT NULL UNIQUE,
    po_seq                  TEXT,
    request_no              TEXT,
    request_seq             TEXT,
    process_status          samsung_po_process_status NOT NULL DEFAULT 'new',
    confirm_status          TEXT,
    pcr_flag                TEXT,
    close_po                BOOLEAN DEFAULT false,
    vendor_code             TEXT,
    buyer_name              TEXT,
    buyer_email             TEXT,
    company                 TEXT,
    plant                   TEXT,
    product_id              BIGINT REFERENCES products(id),
    specification           TEXT,
    maker                   TEXT,
    part_no                 TEXT,
    bqms_code               TEXT,
    old_item_code           TEXT,
    cis_code                TEXT,
    category                TEXT,
    order_qty               NUMERIC(12,3),
    unit_price              NUMERIC(15,4),
    amount                  NUMERIC(15,2),
    currency                currency_code DEFAULT 'VND',
    recipient_name          TEXT,
    delivery_address        TEXT,
    preferred_delivery_date DATE,
    shipping_qty            NUMERIC(12,3),
    gr_qty                  NUMERIC(12,3),     -- Goods Receipt quantity
    invoice_qty             NUMERIC(12,3),
    remark                  TEXT,
    shipping_type           TEXT,
    confirmed_at            TIMESTAMPTZ,
    shipped_at              TIMESTAMPTZ,
    received_at             TIMESTAMPTZ,
    invoiced_at             TIMESTAMPTZ,
    raw_data                JSONB,             -- Du lieu goc tu Samsung
    synced_at               TIMESTAMPTZ,
    version                 INT NOT NULL DEFAULT 1,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE bqms_samsung_po IS 'PO tu Samsung — dong bo tu BQMS, luu raw_data goc';

-- ----------------------------------------------------------------------------
-- Bang 22: bqms_deliveries — Giao hang BQMS
-- Theo doi tung lan giao hang cho Samsung
-- ----------------------------------------------------------------------------
CREATE TABLE bqms_deliveries (
    id                      BIGSERIAL PRIMARY KEY,
    samsung_po_id           BIGINT REFERENCES bqms_samsung_po(id),
    po_date                 DATE,
    po_number               TEXT,
    shipping_no             TEXT,
    quotation_no            TEXT,
    product_id              BIGINT REFERENCES products(id),
    bqms_code               TEXT,
    item_name               TEXT,
    specification           TEXT,
    quantity                NUMERIC(12,3),
    unit                    TEXT DEFAULT 'EA',
    unit_price              NUMERIC(15,4),
    amount                  NUMERIC(15,2),
    sev_type                TEXT,
    buyer_email             TEXT,
    recipient_name          TEXT,
    receiving_warehouse     TEXT,
    buyer_phone             TEXT,
    delivery_status         delivery_status NOT NULL DEFAULT 'chua_giao',
    delivery_date           DATE,
    actual_delivered_at     TIMESTAMPTZ,
    actual_delivered_qty    NUMERIC(12,3),
    delivery_info           TEXT,
    delivery_method         TEXT,
    country_origin          TEXT,
    total_delivered_value_vnd NUMERIC(15,2),
    data_source             TEXT DEFAULT 'excel_import',
    notes                   TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE bqms_deliveries IS 'Giao hang BQMS — theo doi tung lan giao cho Samsung';

-- ----------------------------------------------------------------------------
-- Bang 23: bqms_monthly_po_summary — Tong hop PO hang thang
-- Bao cao tong hop so luong don va gia tri theo thang
-- ----------------------------------------------------------------------------
CREATE TABLE bqms_monthly_po_summary (
    id              BIGSERIAL PRIMARY KEY,
    month_year      DATE NOT NULL,             -- Ngay dau thang (vd: 2026-03-01)
    order_count     INT,
    total_amount    NUMERIC(15,2),
    currency        currency_code DEFAULT 'VND',
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE bqms_monthly_po_summary IS 'Tong hop PO BQMS hang thang';

-- ----------------------------------------------------------------------------
-- Bang 24: bqms_raw_material_po — PO nguyen lieu BQMS
-- Theo doi nguyen vat lieu dau vao cho san pham BQMS
-- ----------------------------------------------------------------------------
CREATE TABLE bqms_raw_material_po (
    id              BIGSERIAL PRIMARY KEY,
    po_date         DATE,
    po_number       TEXT,
    product_id      BIGINT REFERENCES products(id),
    bqms_code       TEXT,
    specification   TEXT,
    po_qty          NUMERIC(12,3),
    unit            TEXT DEFAULT 'EA',
    in_stock        BOOLEAN DEFAULT false,
    remaining_qty   NUMERIC(12,3) DEFAULT 0,
    delivered_qty   NUMERIC(12,3) DEFAULT 0,
    pending         BOOLEAN DEFAULT true,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE bqms_raw_material_po IS 'PO nguyen lieu BQMS — theo doi ton kho nguyen lieu';

-- ----------------------------------------------------------------------------
-- Bang 25: bqms_manufacturing_schedule — Lich san xuat BQMS
-- Ke hoach san xuat hang thang
-- ----------------------------------------------------------------------------
CREATE TABLE bqms_manufacturing_schedule (
    id              BIGSERIAL PRIMARY KEY,
    product_id      BIGINT REFERENCES products(id),
    bqms_code       TEXT,
    specification   TEXT,
    total_qty       NUMERIC(12,3),
    schedule_month  DATE,                      -- Ngay dau thang (vd: 2026-03-01)
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE bqms_manufacturing_schedule IS 'Lich san xuat BQMS theo thang';

-- ----------------------------------------------------------------------------
-- Bang 26: bqms_manufacturing_daily — San xuat hang ngay
-- Chi tiet san xuat tung ngay theo lich
-- ----------------------------------------------------------------------------
CREATE TABLE bqms_manufacturing_daily (
    id              BIGSERIAL PRIMARY KEY,
    schedule_id     BIGINT NOT NULL REFERENCES bqms_manufacturing_schedule(id) ON DELETE CASCADE,
    delivery_date   DATE NOT NULL,
    quantity        NUMERIC(12,3) NOT NULL DEFAULT 0,
    notes           TEXT
);
COMMENT ON TABLE bqms_manufacturing_daily IS 'Chi tiet san xuat hang ngay — theo lich san xuat';

-- ----------------------------------------------------------------------------
-- Bang 27: bqms_material_pricing — Gia vat lieu BQMS
-- Tinh gia vat lieu theo trong luong va kich thuoc
-- ----------------------------------------------------------------------------
CREATE TABLE bqms_material_pricing (
    id              BIGSERIAL PRIMARY KEY,
    rfq_number      TEXT,
    product_id      BIGINT REFERENCES products(id),
    bqms_code       TEXT,
    specification   TEXT,
    unit_price_vnd  NUMERIC(15,2),
    weight_kg       NUMERIC(10,4),
    dimension_l     NUMERIC(10,3),
    dimension_w     NUMERIC(10,3),
    dimension_h     NUMERIC(10,3),
    material_type   TEXT,
    density_g_m3    NUMERIC(10,4),
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE bqms_material_pricing IS 'Gia vat lieu BQMS — tinh theo trong luong/kich thuoc';

-- ============================================================================
-- NHOM 7: BQMS RECORDS (1 bang)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Bang 28: bqms_records — Ban ghi PO BQMS goc
-- Du lieu tho tu he thong Samsung, sync ve xu ly
-- ----------------------------------------------------------------------------
CREATE TABLE bqms_records (
    id              BIGSERIAL PRIMARY KEY,
    po_no           TEXT NOT NULL UNIQUE,
    req_no          TEXT,
    rfq_submission_id BIGINT REFERENCES bqms_rfq_submissions(id),
    samsung_po_id   BIGINT REFERENCES bqms_samsung_po(id),
    item_code       TEXT,
    specification   TEXT,
    manufacturer    TEXT,
    receiver_name   TEXT,
    req_delivery_date DATE,
    po_qty          INT,
    secure_key      TEXT,
    pdf_path        TEXT,
    raw_data        JSONB,
    sync_status     TEXT NOT NULL DEFAULT 'pending'
                        CHECK (sync_status IN ('pending', 'processed', 'error')),
    synced_at       TIMESTAMPTZ,
    processed_at    TIMESTAMPTZ
);
COMMENT ON TABLE bqms_records IS 'Ban ghi PO BQMS goc — du lieu tho tu Samsung';

-- ============================================================================
-- NHOM 8: IMV MODULE — Thuong mai quoc te (3 bang)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Bang 29: imv_inquiries — Yeu cau bao gia IMV
-- Ghi nhan yeu cau tu khach hang IMV (thuong mai quoc te)
-- ----------------------------------------------------------------------------
CREATE TABLE imv_inquiries (
    id                      BIGSERIAL PRIMARY KEY,
    customer_name           TEXT,
    person_in_charge        UUID REFERENCES users(id),
    person_in_charge_name   TEXT,
    model                   TEXT,
    product_name            TEXT,
    product_id              BIGINT REFERENCES products(id),
    maker                   TEXT,
    inquiry_date            DATE,
    purchase_price          NUMERIC(15,4),
    purchase_currency       currency_code,
    selling_price           NUMERIC(15,4),
    quantity                NUMERIC(12,3),
    tax_rate                NUMERIC(5,2),
    hs_code                 TEXT,
    hs_code_id              BIGINT REFERENCES hs_codes(id),
    weight_kg               NUMERIC(10,4),
    coefficient             NUMERIC(10,4),
    supplier_id             BIGINT REFERENCES suppliers(id),
    supplier_name           TEXT,
    exchange_rate           NUMERIC(15,4),
    image_path              TEXT,
    notes                   TEXT,
    data_source             TEXT DEFAULT 'excel_import',
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE imv_inquiries IS 'Yeu cau bao gia IMV — thuong mai quoc te';

-- ----------------------------------------------------------------------------
-- Bang 30: imv_consolidated — Tong hop bao gia IMV
-- View tong hop tat ca bao gia IMV de quan ly
-- ----------------------------------------------------------------------------
CREATE TABLE imv_consolidated (
    id                      BIGSERIAL PRIMARY KEY,
    quotation_no            TEXT,
    status                  TEXT,
    purchaser_name          TEXT,
    purchaser_id            UUID REFERENCES users(id),
    customer_id             BIGINT REFERENCES customers(id),
    customer_name           TEXT,
    customer_branch         TEXT,
    customer_item_code      TEXT,
    product_id              BIGINT REFERENCES products(id),
    product_code            TEXT,
    rfq_number              TEXT,
    product_name            TEXT,
    model                   TEXT,
    specification           TEXT,
    maker                   TEXT,
    unit                    TEXT DEFAULT 'EA',
    expected_order_qty      NUMERIC(12,3),
    prev_year_po_count      INT,
    request_date            DATE,
    quote_deadline          DATE,
    end_date                DATE,
    moq                     NUMERIC(12,3),
    sales_person_name       TEXT,
    sales_person_id         UUID REFERENCES users(id),
    quoted_price            NUMERIC(15,4),
    purchase_price          NUMERIC(15,4),
    price_diff              NUMERIC(15,4),
    po_status               TEXT,
    po_qty                  NUMERIC(12,3),
    po_amount               NUMERIC(15,2),
    profit                  NUMERIC(15,2),
    notes                   TEXT,
    data_source             TEXT DEFAULT 'excel_import',
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE imv_consolidated IS 'Tong hop bao gia IMV — view quan ly';

-- ----------------------------------------------------------------------------
-- Bang 31: imv_purchase_orders — Don dat hang IMV
-- Theo doi don hang mua tu NCC cho kho IMV
-- ----------------------------------------------------------------------------
CREATE TABLE imv_purchase_orders (
    id                      BIGSERIAL PRIMARY KEY,
    po_date                 DATE,
    po_number               TEXT NOT NULL,
    product_id              BIGINT REFERENCES products(id),
    product_code            TEXT,
    product_name            TEXT,
    unit                    TEXT DEFAULT 'EA',
    requested_qty           NUMERIC(12,3),
    unit_price              NUMERIC(15,4),
    amount                  NUMERIC(15,2),
    vat_amount              NUMERIC(15,2),
    total_amount            NUMERIC(15,2),
    purchasing_dept         TEXT,
    delivered_qty           NUMERIC(12,3) DEFAULT 0,
    actual_delivery_date    DATE,
    invoice_date            DATE,
    remaining_qty           NUMERIC(12,3) DEFAULT 0,
    buying_qty              NUMERIC(12,3),
    buying_unit_price       NUMERIC(15,4),
    buying_exchange_rate    NUMERIC(15,4),
    buying_price_vnd        NUMERIC(15,2),
    buying_amount           NUMERIC(15,2),
    shipping_cost           NUMERIC(15,2),
    buying_total            NUMERIC(15,2),
    paid_amount             NUMERIC(15,2) DEFAULT 0,
    outstanding             NUMERIC(15,2) DEFAULT 0,
    supplier_id             BIGINT REFERENCES suppliers(id),
    supplier_name           TEXT,
    document_ref            TEXT,
    notes                   TEXT,
    data_source             TEXT DEFAULT 'excel_import',
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE imv_purchase_orders IS 'Don dat hang IMV — mua tu NCC cho thuong mai';

-- ============================================================================
-- NHOM 9: XNK — Xuat nhap khau (3 bang)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Bang 32: import_export_tracking — Theo doi xuat nhap khau
-- Ghi nhan tung giao dich XNK, lien ket voi san pham va ma HS
-- ----------------------------------------------------------------------------
CREATE TABLE import_export_tracking (
    id                      BIGSERIAL PRIMARY KEY,
    company_id              BIGINT REFERENCES companies(id),
    tracking_date           DATE,
    rfq_number              TEXT,
    product_id              BIGINT REFERENCES products(id),
    bqms_code               TEXT,
    product_name            TEXT,
    detail_explain          TEXT,
    goods_type              goods_type,
    maker                   TEXT,
    unit_calc               TEXT,
    quantity_calc           NUMERIC(12,3),
    quote_deadline          DATE,
    transaction_date        DATE,
    customs_description     TEXT,
    hs_code                 TEXT,
    hs_code_id              BIGINT REFERENCES hs_codes(id),
    unit                    TEXT,
    quantity                NUMERIC(12,3),
    total_usd               NUMERIC(15,2),
    unit_price_usd          NUMERIC(15,4),
    unit_price_vnd          NUMERIC(15,2),
    buyer_name              TEXT,
    seller_name             TEXT,
    purchased_qty           NUMERIC(12,3),
    alt_supplier            TEXT,
    notes                   TEXT,
    year                    SMALLINT,
    data_source             TEXT DEFAULT 'excel_import',
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE import_export_tracking IS 'Theo doi xuat nhap khau — tung giao dich';

-- ----------------------------------------------------------------------------
-- Bang 33: customs_declarations — To khai hai quan
-- Quan ly to khai nhap/xuat khau
-- Trang thai xanh/vang/do theo phan luong hai quan
-- ----------------------------------------------------------------------------
CREATE TABLE customs_declarations (
    id                  BIGSERIAL PRIMARY KEY,
    declaration_number  TEXT NOT NULL UNIQUE,
    declaration_date    DATE NOT NULL,
    declaration_type    TEXT NOT NULL CHECK (declaration_type IN ('import', 'export')),
    customs_office      TEXT,
    importer_name       TEXT NOT NULL,
    importer_tax_code   TEXT NOT NULL,
    exporter_name       TEXT,
    country_origin      TEXT,
    port_of_loading     TEXT,
    port_of_discharge   TEXT,
    transport_mode      TEXT,
    bill_of_lading      TEXT,
    total_value_usd     NUMERIC(15,2),
    total_value_vnd     NUMERIC(18,0),
    import_tax          NUMERIC(15,2) DEFAULT 0,
    vat_amount          NUMERIC(15,2) DEFAULT 0,
    special_tax         NUMERIC(15,2) DEFAULT 0,
    total_tax           NUMERIC(15,2) DEFAULT 0,
    status              TEXT NOT NULL DEFAULT 'draft'
                            CHECK (status IN ('draft', 'submitted', 'green', 'yellow',
                                              'red', 'cleared', 'cancelled')),
    cleared_at          TIMESTAMPTZ,
    document_path       TEXT,
    notes               TEXT,
    created_by          UUID NOT NULL REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE customs_declarations IS 'To khai hai quan — phan luong xanh/vang/do';

-- ----------------------------------------------------------------------------
-- Bang 34: customs_declaration_items — Chi tiet to khai hai quan
-- Tung dong hang hoa tren to khai
-- ----------------------------------------------------------------------------
CREATE TABLE customs_declaration_items (
    id                  BIGSERIAL PRIMARY KEY,
    declaration_id      BIGINT NOT NULL REFERENCES customs_declarations(id) ON DELETE CASCADE,
    line_number         SMALLINT NOT NULL,
    xnk_tracking_id    BIGINT REFERENCES import_export_tracking(id),
    product_id          BIGINT REFERENCES products(id),
    hs_code_id          BIGINT REFERENCES hs_codes(id),
    hs_code             TEXT NOT NULL,
    description         TEXT NOT NULL,
    country_origin      TEXT,
    quantity            NUMERIC(12,3) NOT NULL,
    unit                TEXT NOT NULL,
    unit_price_usd      NUMERIC(15,4),
    amount_usd          NUMERIC(15,2),
    import_tax_rate     NUMERIC(5,2),
    import_tax          NUMERIC(15,2),
    vat_rate            NUMERIC(5,2) DEFAULT 10,
    vat_amount          NUMERIC(15,2)
);
COMMENT ON TABLE customs_declaration_items IS 'Chi tiet dong hang tren to khai hai quan';

-- ============================================================================
-- NHOM 10: INTERNAL PO — Don dat hang noi bo (5 bang)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Bang 35: purchase_orders — Don dat hang noi bo
-- Don dat hang chinh thuc gui cho NCC
-- amount_vnd tu dong tinh = total_amount * exchange_rate
-- ----------------------------------------------------------------------------
CREATE TABLE purchase_orders (
    id                  BIGSERIAL PRIMARY KEY,
    po_number           TEXT NOT NULL UNIQUE,
    supplier_id         BIGINT NOT NULL REFERENCES suppliers(id),
    customer_id         BIGINT REFERENCES customers(id),
    company_id          BIGINT REFERENCES companies(id),
    workflow_id         BIGINT REFERENCES workflow_instances(id),
    status              po_status NOT NULL DEFAULT 'draft',
    subtotal            NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
    tax_amount          NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (tax_amount >= 0),
    shipping_cost       NUMERIC(15,2) DEFAULT 0,
    total_amount        NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
    currency            currency_code DEFAULT 'USD',
    exchange_rate       NUMERIC(15,4),
    amount_vnd          NUMERIC(18,2) GENERATED ALWAYS AS (total_amount * COALESCE(exchange_rate, 1)) STORED,
    order_date          DATE,
    expected_date       DATE,
    confirmed_date      DATE,
    received_date       DATE,
    approved_at         TIMESTAMPTZ,
    sent_to_supplier_at TIMESTAMPTZ,
    cancelled_at        TIMESTAMPTZ,
    cancelled_reason    TEXT,
    incoterms           TEXT,
    shipping_method     TEXT,
    tracking_number     TEXT,
    attachment_path     TEXT,
    notes               TEXT,
    internal_note       TEXT,
    business_system     business_system,
    created_by          UUID NOT NULL REFERENCES users(id),
    approved_by         UUID REFERENCES users(id),
    version             INT NOT NULL DEFAULT 1,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE purchase_orders IS 'Don dat hang noi bo — amount_vnd tu dong tinh';

-- ----------------------------------------------------------------------------
-- Bang 36: po_line_items — Chi tiet dong PO
-- subtotal tu dong tinh = quantity * unit_price
-- ----------------------------------------------------------------------------
CREATE TABLE po_line_items (
    id              BIGSERIAL PRIMARY KEY,
    po_id           BIGINT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    line_number     SMALLINT NOT NULL,
    product_id      BIGINT REFERENCES products(id),
    product_code    TEXT,
    product_name    TEXT NOT NULL,
    specification   TEXT,
    maker           TEXT,
    quantity        NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
    unit            TEXT NOT NULL DEFAULT 'EA',
    unit_price      NUMERIC(15,4) NOT NULL CHECK (unit_price >= 0),
    subtotal        NUMERIC(15,4) GENERATED ALWAYS AS (quantity * unit_price) STORED,
    currency        currency_code DEFAULT 'USD',
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE po_line_items IS 'Chi tiet dong PO — subtotal = quantity * unit_price';

-- ----------------------------------------------------------------------------
-- Bang 37: rfq_requests — Yeu cau bao gia noi bo
-- Gui yeu cau bao gia den nhieu NCC
-- ----------------------------------------------------------------------------
CREATE TABLE rfq_requests (
    id              BIGSERIAL PRIMARY KEY,
    rfq_number      TEXT NOT NULL UNIQUE,
    title           TEXT NOT NULL,
    description     TEXT,
    deadline        DATE NOT NULL,
    status          TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'sent', 'received', 'selected', 'cancelled')),
    business_system business_system,
    created_by      UUID NOT NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE rfq_requests IS 'Yeu cau bao gia noi bo — gui cho nhieu NCC';

-- ----------------------------------------------------------------------------
-- Bang 38: rfq_line_items — Chi tiet dong yeu cau bao gia
-- ----------------------------------------------------------------------------
CREATE TABLE rfq_line_items (
    id              BIGSERIAL PRIMARY KEY,
    rfq_id          BIGINT NOT NULL REFERENCES rfq_requests(id) ON DELETE CASCADE,
    product_id      BIGINT REFERENCES products(id),
    product_code    TEXT,
    product_name    TEXT NOT NULL,
    specification   TEXT,
    maker           TEXT,
    quantity        NUMERIC(12,3) NOT NULL,
    unit            TEXT DEFAULT 'EA',
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE rfq_line_items IS 'Chi tiet dong yeu cau bao gia';

-- ----------------------------------------------------------------------------
-- Bang 39: rfq_quotations — Bao gia tu NCC
-- Moi NCC gui 1 bao gia cho 1 RFQ
-- ----------------------------------------------------------------------------
CREATE TABLE rfq_quotations (
    id              BIGSERIAL PRIMARY KEY,
    rfq_id          BIGINT NOT NULL REFERENCES rfq_requests(id),
    supplier_id     BIGINT NOT NULL REFERENCES suppliers(id),
    unit_price      NUMERIC(15,4),
    currency        currency_code DEFAULT 'USD',
    lead_time_days  SMALLINT,
    validity_date   DATE,
    terms           TEXT,
    is_selected     BOOLEAN NOT NULL DEFAULT false,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE rfq_quotations IS 'Bao gia tu NCC — moi NCC 1 bao gia cho 1 RFQ';

-- ============================================================================
-- NHOM 11: SALES ORDERS — Don ban hang (2 bang)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Bang 40: sales_orders — Don ban hang
-- Quan ly don hang tu khach hang
-- ----------------------------------------------------------------------------
CREATE TABLE sales_orders (
    id                      BIGSERIAL PRIMARY KEY,
    order_number            TEXT UNIQUE,
    company_id              BIGINT REFERENCES companies(id),
    customer_id             BIGINT NOT NULL REFERENCES customers(id),
    customer_name           TEXT,
    order_date              DATE NOT NULL,
    requested_delivery_date DATE,
    status                  TEXT NOT NULL DEFAULT 'draft'
                                CHECK (status IN ('draft', 'confirmed', 'in_progress',
                                                  'shipped', 'delivered', 'invoiced',
                                                  'closed', 'cancelled')),
    subtotal                NUMERIC(15,2) DEFAULT 0,
    vat_amount              NUMERIC(15,2) DEFAULT 0,
    total_amount            NUMERIC(15,2) DEFAULT 0,
    currency                currency_code DEFAULT 'VND',
    advance_payment         NUMERIC(15,2) DEFAULT 0,
    remaining_payment       NUMERIC(15,2) DEFAULT 0,
    delivered_date          DATE,
    invoice_number          TEXT,
    invoice_date            DATE,
    source_system           TEXT,              -- 'bqms', 'imv', 'manual'
    source_ref              TEXT,
    notes                   TEXT,
    created_by              UUID NOT NULL REFERENCES users(id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE sales_orders IS 'Don ban hang — tu dong tao so SO-YYYYMM-XXXXXX';

-- ----------------------------------------------------------------------------
-- Bang 41: sales_order_items — Chi tiet don ban hang
-- Tung dong san pham tren don ban hang
-- ----------------------------------------------------------------------------
CREATE TABLE sales_order_items (
    id              BIGSERIAL PRIMARY KEY,
    sales_order_id  BIGINT NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
    line_number     SMALLINT NOT NULL,
    product_id      BIGINT REFERENCES products(id),
    product_code    TEXT,
    product_name    TEXT NOT NULL,
    specification   TEXT,
    unit            TEXT DEFAULT 'EA',
    quantity        NUMERIC(12,3) NOT NULL CHECK (quantity > 0),
    unit_price      NUMERIC(15,4) NOT NULL,
    amount          NUMERIC(15,2),
    vat_rate        NUMERIC(5,2) DEFAULT 10,
    delivered_qty   NUMERIC(12,3) DEFAULT 0,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE sales_order_items IS 'Chi tiet dong don ban hang';

-- ============================================================================
-- NHOM 12: REVENUE — Doanh thu (2 bang)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Bang 42: revenue_invoices — Hoa don doanh thu
-- Tong hop doanh thu, chi phi, loi nhuan theo hoa don
-- ----------------------------------------------------------------------------
CREATE TABLE revenue_invoices (
    id                  BIGSERIAL PRIMARY KEY,
    company_id          BIGINT REFERENCES companies(id),
    invoice_number      TEXT,
    invoice_date        DATE,
    invoice_month       SMALLINT,
    invoice_year        SMALLINT,
    customer_id         BIGINT REFERENCES customers(id),
    customer_name       TEXT,
    product_id          BIGINT REFERENCES products(id),
    product_name        TEXT,
    unit                TEXT DEFAULT 'EA',
    quantity            NUMERIC(12,3) CHECK (quantity > 0),
    unit_price          NUMERIC(15,4),
    amount              NUMERIC(15,2),
    tax_rate            NUMERIC(5,2),
    vat_amount          NUMERIC(15,2),
    total_amount        NUMERIC(15,2),
    po_number           TEXT,
    po_id               BIGINT REFERENCES purchase_orders(id),
    samsung_po_id       BIGINT REFERENCES bqms_samsung_po(id),
    imv_po_id           BIGINT REFERENCES imv_purchase_orders(id),
    sales_order_id      BIGINT REFERENCES sales_orders(id),
    purchase_price      NUMERIC(15,4),
    purchase_vat        NUMERIC(15,2),
    shipping_cost       NUMERIC(15,2),
    commission          NUMERIC(15,2),
    customer_quoted     NUMERIC(15,4),
    invoice_buying      NUMERIC(15,2),
    customs_fee         NUMERIC(15,2),
    export_tax          NUMERIC(15,2),
    other_costs         NUMERIC(15,2),
    total_cost          NUMERIC(15,2),
    profit              NUMERIC(15,2),
    advance_payment     NUMERIC(15,2),
    remaining_payment   NUMERIC(15,2),
    data_source         TEXT DEFAULT 'excel_import',
    notes               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE revenue_invoices IS 'Hoa don doanh thu — chi phi + loi nhuan';

-- ----------------------------------------------------------------------------
-- Bang 43: e_invoices — Hoa don dien tu
-- Theo quy dinh cua Tong cuc Thue Viet Nam
-- Luu trang thai ky so, gui thue, chap nhan/tu choi
-- ----------------------------------------------------------------------------
CREATE TABLE e_invoices (
    id                      BIGSERIAL PRIMARY KEY,
    revenue_invoice_id      BIGINT REFERENCES revenue_invoices(id),
    e_invoice_number        TEXT NOT NULL,
    e_invoice_symbol        TEXT NOT NULL,      -- Ky hieu hoa don (vd: 1C26TAA)
    serial_number           TEXT,
    issue_date              DATE NOT NULL,
    tax_authority_code      TEXT,
    lookup_code             TEXT,               -- Ma tra cuu
    signing_status          TEXT NOT NULL DEFAULT 'unsigned'
                                CHECK (signing_status IN ('unsigned', 'signed', 'sent',
                                                          'accepted', 'rejected',
                                                          'cancelled', 'replaced')),
    signed_at               TIMESTAMPTZ,
    sent_to_tax_at          TIMESTAMPTZ,
    tax_accepted_at         TIMESTAMPTZ,
    cancelled_reason        TEXT,
    replacement_invoice_id  BIGINT REFERENCES e_invoices(id),
    buyer_name              TEXT NOT NULL,
    buyer_tax_code          TEXT,
    buyer_address           TEXT,
    buyer_bank_account      TEXT,
    subtotal                NUMERIC(15,2) NOT NULL,
    vat_rate                NUMERIC(5,2),
    vat_amount              NUMERIC(15,2),
    total_amount            NUMERIC(15,2) NOT NULL,
    currency                currency_code DEFAULT 'VND',
    xml_path                TEXT,              -- Duong dan file XML ky so
    pdf_path                TEXT,
    created_by              UUID NOT NULL REFERENCES users(id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_e_invoice UNIQUE (e_invoice_symbol, e_invoice_number)
);
COMMENT ON TABLE e_invoices IS 'Hoa don dien tu — theo quy dinh Tong cuc Thue VN';

-- ============================================================================
-- NHOM 13: INVENTORY — Ton kho (2 bang)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Bang 44: inventory — Ton kho
-- available_qty tu dong tinh = quantity - reserved_qty
-- Dung version de tranh xung dot khi cap nhat dong thoi
-- ----------------------------------------------------------------------------
CREATE TABLE inventory (
    id              BIGSERIAL PRIMARY KEY,
    product_id      BIGINT NOT NULL REFERENCES products(id),
    product_code    TEXT NOT NULL UNIQUE,
    product_name    TEXT NOT NULL,
    name_unaccent   TEXT GENERATED ALWAYS AS (unaccent(lower(product_name))) STORED,
    category        TEXT,
    brand           TEXT,
    specification   TEXT,
    unit            TEXT NOT NULL DEFAULT 'EA',
    quantity        NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    reserved_qty    NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK (reserved_qty >= 0),
    available_qty   NUMERIC(12,3) GENERATED ALWAYS AS (quantity - reserved_qty) STORED,
    min_stock       NUMERIC(12,3) DEFAULT 0,
    max_stock       NUMERIC(12,3),
    location        TEXT,
    unit_cost       NUMERIC(15,4),
    version         INT NOT NULL DEFAULT 1,    -- Optimistic locking
    last_updated    TIMESTAMPTZ DEFAULT NOW(),
    notes           TEXT
);
COMMENT ON TABLE inventory IS 'Ton kho — available_qty tu dong, version de tranh xung dot';

-- ----------------------------------------------------------------------------
-- Bang 45: inventory_movements — Lich su xuat/nhap kho
-- Ghi lai moi lan thay doi so luong kho
-- before_qty/after_qty de kiem tra tinh nhat quan
-- ----------------------------------------------------------------------------
CREATE TABLE inventory_movements (
    id              BIGSERIAL PRIMARY KEY,
    product_id      BIGINT REFERENCES products(id),
    product_code    TEXT NOT NULL,
    movement_type   TEXT NOT NULL CHECK (movement_type IN ('in', 'out', 'adjust')),
    quantity        NUMERIC(12,3) NOT NULL,
    reference_type  TEXT CHECK (reference_type IN ('po', 'sale', 'bqms_delivery',
                                                    'imv_delivery', 'adjustment', 'return')),
    reference_id    BIGINT,
    before_qty      NUMERIC(12,3) NOT NULL,
    after_qty       NUMERIC(12,3) NOT NULL,
    unit_cost       NUMERIC(15,4),
    notes           TEXT,
    created_by      UUID NOT NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- FK to inventory.product_code
ALTER TABLE inventory_movements
    ADD CONSTRAINT fk_invmov_product_code
    FOREIGN KEY (product_code) REFERENCES inventory(product_code);
COMMENT ON TABLE inventory_movements IS 'Lich su xuat/nhap kho — before/after de kiem tra';

-- ============================================================================
-- NHOM 14: FINANCE — Tai chinh (6 bang)
-- ============================================================================

-- Tao bang cash_book_categories truoc (vi cash_book tham chieu den no)

-- ----------------------------------------------------------------------------
-- Bang 50: cash_book_categories — Danh muc so quy
-- Phan loai cac khoan thu/chi
-- Ho tro cau truc cay (parent_id)
-- ----------------------------------------------------------------------------
CREATE TABLE cash_book_categories (
    id              BIGSERIAL PRIMARY KEY,
    category_code   TEXT NOT NULL UNIQUE,
    category_name   TEXT NOT NULL,
    direction       TEXT NOT NULL CHECK (direction IN ('thu', 'chi', 'both')),
    parent_id       BIGINT REFERENCES cash_book_categories(id),
    sort_order      SMALLINT,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE cash_book_categories IS 'Danh muc so quy — phan loai thu/chi';

-- ----------------------------------------------------------------------------
-- Bang 46: accounts_payable — Cong no phai tra
-- Theo doi cong no voi NCC
-- ----------------------------------------------------------------------------
CREATE TABLE accounts_payable (
    id              BIGSERIAL PRIMARY KEY,
    supplier_id     BIGINT NOT NULL REFERENCES suppliers(id),
    po_id           BIGINT REFERENCES purchase_orders(id),
    invoice_number  TEXT,
    invoice_date    DATE NOT NULL,
    due_date        DATE NOT NULL,
    amount          NUMERIC(15,2) NOT NULL,
    currency        currency_code DEFAULT 'USD',
    exchange_rate   NUMERIC(15,4),
    amount_vnd      NUMERIC(18,0),
    paid_amount     NUMERIC(15,2) NOT NULL DEFAULT 0,
    status          payment_status NOT NULL DEFAULT 'pending',
    payment_terms   TEXT,
    notes           TEXT,
    created_by      UUID NOT NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE accounts_payable IS 'Cong no phai tra — theo doi thanh toan NCC';

-- ----------------------------------------------------------------------------
-- Bang 47: accounts_receivable — Cong no phai thu
-- Theo doi cong no tu khach hang
-- ----------------------------------------------------------------------------
CREATE TABLE accounts_receivable (
    id              BIGSERIAL PRIMARY KEY,
    customer_id     BIGINT NOT NULL REFERENCES customers(id),
    invoice_id      BIGINT REFERENCES revenue_invoices(id),
    sales_order_id  BIGINT REFERENCES sales_orders(id),
    invoice_number  TEXT,
    invoice_date    DATE NOT NULL,
    due_date        DATE NOT NULL,
    amount          NUMERIC(15,2) NOT NULL,
    currency        currency_code DEFAULT 'VND',
    paid_amount     NUMERIC(15,2) NOT NULL DEFAULT 0,
    status          payment_status NOT NULL DEFAULT 'pending',
    notes           TEXT,
    created_by      UUID NOT NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE accounts_receivable IS 'Cong no phai thu — theo doi thanh toan khach hang';

-- ----------------------------------------------------------------------------
-- Bang 48: payment_transactions — Giao dich thanh toan
-- Ghi nhan tung lan thanh toan (thu hoac chi)
-- ----------------------------------------------------------------------------
CREATE TABLE payment_transactions (
    id              BIGSERIAL PRIMARY KEY,
    direction       payment_direction NOT NULL,
    ap_id           BIGINT REFERENCES accounts_payable(id),
    ar_id           BIGINT REFERENCES accounts_receivable(id),
    payment_date    DATE NOT NULL,
    amount          NUMERIC(15,2) NOT NULL,
    currency        currency_code DEFAULT 'VND',
    exchange_rate   NUMERIC(15,4),
    payment_method  TEXT,
    bank_name       TEXT,
    bank_ref        TEXT,
    notes           TEXT,
    created_by      UUID NOT NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE payment_transactions IS 'Giao dich thanh toan — thu/chi tung lan';

-- ----------------------------------------------------------------------------
-- Bang 49: cash_book — So quy tien mat
-- Ghi nhan thu/chi hang ngay
-- ----------------------------------------------------------------------------
CREATE TABLE cash_book (
    id              BIGSERIAL PRIMARY KEY,
    company_id      BIGINT REFERENCES companies(id),
    entry_date      DATE NOT NULL,
    document_number TEXT,
    category_id     BIGINT REFERENCES cash_book_categories(id),
    counterparty    TEXT,
    description     TEXT NOT NULL,
    amount          NUMERIC(15,2) NOT NULL,
    direction       TEXT NOT NULL CHECK (direction IN ('thu', 'chi')),
    balance_after   NUMERIC(15,2),
    notes           TEXT,
    created_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE cash_book IS 'So quy tien mat — ghi nhan thu/chi hang ngay';

-- ----------------------------------------------------------------------------
-- Bang 51: payment_requests — De nghi thanh toan
-- Quy trinh de nghi chi tien, lien ket workflow duyet
-- ----------------------------------------------------------------------------
CREATE TABLE payment_requests (
    id                  BIGSERIAL PRIMARY KEY,
    company_id          BIGINT REFERENCES companies(id),
    requester_id        UUID NOT NULL REFERENCES users(id),
    requester_name      TEXT,
    department          TEXT,
    request_date        DATE NOT NULL,
    workflow_id         BIGINT REFERENCES workflow_instances(id),
    description         TEXT NOT NULL,
    amount              NUMERIC(15,2) NOT NULL,
    currency            currency_code DEFAULT 'VND',
    payment_method      TEXT,
    beneficiary_name    TEXT,
    beneficiary_bank    TEXT,
    beneficiary_account TEXT,
    status              TEXT NOT NULL DEFAULT 'draft'
                            CHECK (status IN ('draft', 'pending', 'approved',
                                              'paid', 'rejected', 'cancelled')),
    approved_by         UUID REFERENCES users(id),
    approved_at         TIMESTAMPTZ,
    paid_at             TIMESTAMPTZ,
    notes               TEXT,
    attachments         TEXT[],                -- Danh sach file dinh kem
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE payment_requests IS 'De nghi thanh toan — lien ket workflow duyet';

-- ============================================================================
-- NHOM 15: DELIVERY — Giao hang (1 bang)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Bang 52: delivery_receipts — Phieu giao hang
-- Ghi nhan viec giao hang cho khach
-- ----------------------------------------------------------------------------
CREATE TABLE delivery_receipts (
    id              BIGSERIAL PRIMARY KEY,
    receipt_number  TEXT UNIQUE,
    company_id      BIGINT REFERENCES companies(id),
    customer_id     BIGINT REFERENCES customers(id),
    customer_name   TEXT,
    sales_order_id  BIGINT REFERENCES sales_orders(id),
    po_id           BIGINT REFERENCES purchase_orders(id),
    receipt_date    DATE NOT NULL,
    delivery_method TEXT,
    driver_name     TEXT,
    vehicle_number  TEXT,
    receiver_name   TEXT,
    receiver_phone  TEXT,
    total_items     SMALLINT,
    notes           TEXT,
    signed_at       TIMESTAMPTZ,
    document_path   TEXT,
    created_by      UUID NOT NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE delivery_receipts IS 'Phieu giao hang — ghi nhan giao cho khach';

-- ============================================================================
-- NHOM 16: SUPPORT — Ho tro (5 bang)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Bang 53: price_history — Lich su gia
-- Luu lai gia mua hang theo thoi gian de phan tich xu huong
-- ----------------------------------------------------------------------------
CREATE TABLE price_history (
    id              BIGSERIAL PRIMARY KEY,
    product_code    TEXT NOT NULL,
    supplier_id     BIGINT NOT NULL REFERENCES suppliers(id),
    unit_price      NUMERIC(15,4) NOT NULL,
    currency        currency_code DEFAULT 'USD',
    quantity        NUMERIC(12,3),
    po_id           BIGINT REFERENCES purchase_orders(id),
    recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE price_history IS 'Lich su gia mua — phan tich xu huong gia';

-- ----------------------------------------------------------------------------
-- Bang 54: notifications — Thong bao
-- He thong thong bao noi bo cho nguoi dung
-- ----------------------------------------------------------------------------
CREATE TABLE notifications (
    id              BIGSERIAL PRIMARY KEY,
    recipient_id    UUID NOT NULL REFERENCES users(id),
    type            notification_type NOT NULL,
    title           TEXT NOT NULL,
    body            TEXT,
    is_read         BOOLEAN NOT NULL DEFAULT false,
    read_at         TIMESTAMPTZ,
    ref_type        TEXT,
    ref_id          BIGINT,
    metadata        JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE notifications IS 'Thong bao noi bo — workflow, canh bao ton kho, nhac hen';

-- ----------------------------------------------------------------------------
-- Bang 55: audit_log — Nhat ky he thong
-- IMMUTABLE — ghi lai moi thay doi du lieu quan trong
-- Khong cho phep UPDATE hay DELETE
-- ----------------------------------------------------------------------------
CREATE TABLE audit_log (
    id              BIGSERIAL PRIMARY KEY,
    user_id         UUID REFERENCES users(id),
    user_email      TEXT,
    action          TEXT NOT NULL,             -- INSERT, UPDATE, DELETE
    table_name      TEXT NOT NULL,
    record_id       TEXT,
    old_data        JSONB,
    new_data        JSONB,
    ip_address      INET,
    user_agent      TEXT,
    request_id      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    -- Khong co updated_at — bat bien (immutable)
);
COMMENT ON TABLE audit_log IS 'Nhat ky he thong — bat bien, ghi lai moi thay doi';

-- ----------------------------------------------------------------------------
-- Bang 56: file_meta — Metadata file upload
-- Quan ly file dinh kem trong he thong
-- ----------------------------------------------------------------------------
CREATE TABLE file_meta (
    id              BIGSERIAL PRIMARY KEY,
    filename        TEXT NOT NULL,
    stored_filename TEXT NOT NULL UNIQUE,
    file_path       TEXT NOT NULL,
    mime_type       TEXT NOT NULL,
    file_size       BIGINT NOT NULL,
    checksum        TEXT,                      -- SHA-256 hash
    ref_type        TEXT,
    ref_id          BIGINT,
    is_public       BOOLEAN NOT NULL DEFAULT false,
    uploaded_by     UUID NOT NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE file_meta IS 'Metadata file upload — luu tru checksum SHA-256';

-- ----------------------------------------------------------------------------
-- Bang 57: etl_sync_log — Nhat ky dong bo ETL
-- Ghi lai trang thai dong bo du lieu tu Excel, BQMS, API
-- ----------------------------------------------------------------------------
CREATE TABLE etl_sync_log (
    id              BIGSERIAL PRIMARY KEY,
    sync_type       TEXT NOT NULL,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at    TIMESTAMPTZ,
    status          TEXT NOT NULL DEFAULT 'running'
                        CHECK (status IN ('running', 'success', 'error', 'cancelled')),
    files_processed INT DEFAULT 0,
    rows_inserted   INT DEFAULT 0,
    rows_updated    INT DEFAULT 0,
    rows_skipped    INT DEFAULT 0,
    error_message   TEXT,
    delta_token     TEXT                       -- Token de dong bo tang dan
);
COMMENT ON TABLE etl_sync_log IS 'Nhat ky ETL — dong bo tu Excel, BQMS, API';

-- ============================================================================
-- NHOM 17: SYSTEM — He thong (3 bang)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Bang 58: system_settings — Cai dat he thong
-- Luu tru cac tham so cau hinh toan he thong
-- is_sensitive=true cho cac gia tri nhay cam (khong hien thi)
-- ----------------------------------------------------------------------------
CREATE TABLE system_settings (
    id              BIGSERIAL PRIMARY KEY,
    setting_key     TEXT NOT NULL UNIQUE,
    setting_value   JSONB NOT NULL,
    setting_type    TEXT NOT NULL DEFAULT 'string'
                        CHECK (setting_type IN ('string', 'number', 'boolean', 'json')),
    description     TEXT,
    is_sensitive    BOOLEAN NOT NULL DEFAULT false,
    updated_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE system_settings IS 'Cai dat he thong — tham so cau hinh toan cuc';

-- ----------------------------------------------------------------------------
-- Bang 59: user_sessions — Phien dang nhap
-- Quan ly phien dang nhap, ho tro thu hoi (revoke)
-- ----------------------------------------------------------------------------
CREATE TABLE user_sessions (
    id              BIGSERIAL PRIMARY KEY,
    user_id         UUID NOT NULL REFERENCES users(id),
    session_token   TEXT NOT NULL UNIQUE,
    ip_address      INET,
    user_agent      TEXT,
    device_info     JSONB,
    started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_active_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMPTZ NOT NULL,
    is_revoked      BOOLEAN NOT NULL DEFAULT false,
    revoked_at      TIMESTAMPTZ,
    revoked_reason  TEXT
);
COMMENT ON TABLE user_sessions IS 'Phien dang nhap — ho tro thu hoi (revoke)';

-- ----------------------------------------------------------------------------
-- Bang 60: budget_targets — Muc tieu ngan sach
-- Ke hoach va thuc te theo thang/nam
-- ----------------------------------------------------------------------------
CREATE TABLE budget_targets (
    id              BIGSERIAL PRIMARY KEY,
    fiscal_year     SMALLINT NOT NULL,
    fiscal_month    SMALLINT,
    target_type     TEXT NOT NULL,              -- 'revenue', 'profit', 'orders', ...
    business_system business_system,
    customer_id     BIGINT REFERENCES customers(id),
    department      TEXT,
    target_value    NUMERIC(18,2) NOT NULL,
    actual_value    NUMERIC(18,2),
    currency        currency_code DEFAULT 'VND',
    notes           TEXT,
    created_by      UUID NOT NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Unique constraint cho muc tieu — tranh trung lap
CREATE UNIQUE INDEX uq_budget_target
    ON budget_targets (fiscal_year, COALESCE(fiscal_month, 0),
                       target_type,
                       COALESCE(business_system::TEXT, ''),
                       COALESCE(customer_id, 0),
                       COALESCE(department, ''));
COMMENT ON TABLE budget_targets IS 'Muc tieu ngan sach — ke hoach vs thuc te';

-- ============================================================================
-- NHOM 18: FUTURE P2 — Mo rong giai doan 2 (4 bang)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Bang 61: tasks — Cong viec / Nhiem vu
-- Quan ly giao viec noi bo
-- ----------------------------------------------------------------------------
CREATE TABLE tasks (
    id              BIGSERIAL PRIMARY KEY,
    title           TEXT NOT NULL,
    description     TEXT,
    assigned_to     UUID NOT NULL REFERENCES users(id),
    assigned_by     UUID NOT NULL REFERENCES users(id),
    priority        SMALLINT NOT NULL DEFAULT 2 CHECK (priority BETWEEN 1 AND 5),
    status          TEXT NOT NULL DEFAULT 'todo'
                        CHECK (status IN ('todo', 'in_progress', 'done', 'cancelled')),
    due_date        DATE,
    completed_at    TIMESTAMPTZ,
    ref_type        TEXT,
    ref_id          BIGINT,
    tags            TEXT[],
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE tasks IS 'Cong viec — quan ly giao viec noi bo';

-- ----------------------------------------------------------------------------
-- Bang 62: tags — Nhan dan
-- He thong nhan (tags) linh hoat, ap dung cho nhieu doi tuong
-- ----------------------------------------------------------------------------
CREATE TABLE tags (
    id              BIGSERIAL PRIMARY KEY,
    tag_name        TEXT NOT NULL UNIQUE,
    color           TEXT,
    created_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE tags IS 'Nhan dan — he thong tag linh hoat';

-- ----------------------------------------------------------------------------
-- Bang 63: taggings — Lien ket nhan
-- Bang trung gian: gan nhan cho bat ky doi tuong nao (polymorphic)
-- ----------------------------------------------------------------------------
CREATE TABLE taggings (
    id              BIGSERIAL PRIMARY KEY,
    tag_id          BIGINT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    ref_type        TEXT NOT NULL,             -- Ten bang (vd: 'products', 'suppliers')
    ref_id          BIGINT NOT NULL,
    created_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_tagging UNIQUE (tag_id, ref_type, ref_id)
);
COMMENT ON TABLE taggings IS 'Lien ket nhan — polymorphic, ap dung cho moi doi tuong';

-- ----------------------------------------------------------------------------
-- Bang 64: mv_refresh_log — Nhat ky lam moi Materialized View
-- Ghi lai moi lan refresh MV de theo doi hieu suat
-- ----------------------------------------------------------------------------
CREATE TABLE mv_refresh_log (
    id              BIGSERIAL PRIMARY KEY,
    view_name       TEXT NOT NULL,
    refresh_type    TEXT DEFAULT 'full',
    started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at    TIMESTAMPTZ,
    status          TEXT NOT NULL DEFAULT 'running',
    rows_affected   INT,
    duration_ms     INT,
    error_message   TEXT
);
COMMENT ON TABLE mv_refresh_log IS 'Nhat ky refresh Materialized View';

-- ============================================================================
-- 5. INDEXES — ~110 chi muc
-- ============================================================================
-- Quy tac dat ten: idx_{ten_bang}_{ten_cot}
-- Partial index: _active, _not_deleted
-- GIN index: _trgm (trigram search), _gin (JSONB)

-- === CORE ===

-- users
CREATE INDEX idx_users_role ON users (role);
CREATE INDEX idx_users_department ON users (department);
CREATE INDEX idx_users_active ON users (is_active) WHERE is_active = true;
CREATE INDEX idx_users_not_deleted ON users (id) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_email_lower ON users (lower(email));
CREATE INDEX idx_users_m365 ON users (m365_id) WHERE m365_id IS NOT NULL;

-- workflow_instances
CREATE INDEX idx_wf_type ON workflow_instances (workflow_type);
CREATE INDEX idx_wf_status ON workflow_instances (current_status);
CREATE INDEX idx_wf_created_by ON workflow_instances (created_by);
CREATE INDEX idx_wf_assigned_to ON workflow_instances (assigned_to);
CREATE INDEX idx_wf_ref ON workflow_instances (ref_type, ref_id);
CREATE INDEX idx_wf_deadline ON workflow_instances (deadline) WHERE deadline IS NOT NULL;
CREATE INDEX idx_wf_pending ON workflow_instances (assigned_to, current_status)
    WHERE current_status IN ('pending_l1', 'pending_l2');
CREATE INDEX idx_wf_data_gin ON workflow_instances USING GIN (data);

-- workflow_history
CREATE INDEX idx_wfh_instance ON workflow_history (instance_id);
CREATE INDEX idx_wfh_actor ON workflow_history (actor_id);
CREATE INDEX idx_wfh_created ON workflow_history (created_at);

-- === LOOKUP ===

-- exchange_rates
CREATE INDEX idx_exrate_date ON exchange_rates (rate_date DESC);
CREATE INDEX idx_exrate_pair ON exchange_rates (from_currency, to_currency);

-- hs_codes
CREATE INDEX idx_hscode_active ON hs_codes (hs_code) WHERE is_active = true;

-- material_types
CREATE INDEX idx_mattype_active ON material_types (type_code) WHERE is_active = true AND deleted_at IS NULL;

-- fiscal_periods
CREATE INDEX idx_fiscal_year ON fiscal_periods (fiscal_year);
CREATE INDEX idx_fiscal_status ON fiscal_periods (status);

-- dim_date
CREATE INDEX idx_dimdate_year_month ON dim_date (year, month);
CREATE INDEX idx_dimdate_fiscal ON dim_date (fiscal_year, fiscal_quarter, fiscal_month);
CREATE INDEX idx_dimdate_working ON dim_date (date_key) WHERE is_working_day = true;

-- === CRM ===

-- companies
CREATE INDEX idx_company_code ON companies (company_code);

-- customers
CREATE INDEX idx_cust_code ON customers (customer_code);
CREATE INDEX idx_cust_business ON customers (business_system);
CREATE INDEX idx_cust_active ON customers (id) WHERE is_active = true AND deleted_at IS NULL;
CREATE INDEX idx_cust_name_trgm ON customers USING GIN (company_name_unaccent gin_trgm_ops);
CREATE INDEX idx_cust_tax ON customers (tax_code) WHERE tax_code IS NOT NULL;

-- customer_contacts
CREATE INDEX idx_custcontact_customer ON customer_contacts (customer_id);
CREATE INDEX idx_custcontact_primary ON customer_contacts (customer_id) WHERE is_primary = true;

-- === SUPPLIERS ===

-- suppliers
CREATE INDEX idx_supplier_country ON suppliers (country);
CREATE INDEX idx_supplier_active ON suppliers (id) WHERE is_active = true AND deleted_at IS NULL;
CREATE INDEX idx_supplier_name_trgm ON suppliers USING GIN (name_unaccent gin_trgm_ops);
CREATE INDEX idx_supplier_created_by ON suppliers (created_by);
CREATE INDEX idx_supplier_rating ON suppliers (rating DESC) WHERE rating IS NOT NULL;

-- supplier_contracts
CREATE INDEX idx_supcon_supplier ON supplier_contracts (supplier_id);
CREATE INDEX idx_supcon_status ON supplier_contracts (status);
CREATE INDEX idx_supcon_dates ON supplier_contracts (start_date, end_date);

-- contract_price_items
CREATE INDEX idx_cpi_contract ON contract_price_items (contract_id);
CREATE INDEX idx_cpi_product ON contract_price_items (product_id);
CREATE INDEX idx_cpi_valid ON contract_price_items (valid_from, valid_to);

-- === PRODUCTS ===

-- products
CREATE INDEX idx_prod_bqms ON products (bqms_code) WHERE bqms_code IS NOT NULL;
CREATE INDEX idx_prod_imv ON products (imv_code) WHERE imv_code IS NOT NULL;
CREATE INDEX idx_prod_category ON products (category);
CREATE INDEX idx_prod_material ON products (material_type_id);
CREATE INDEX idx_prod_hscode ON products (hs_code_id);
CREATE INDEX idx_prod_active ON products (id) WHERE is_active = true AND deleted_at IS NULL;
CREATE INDEX idx_prod_name_trgm ON products USING GIN (product_name_unaccent gin_trgm_ops);
CREATE INDEX idx_prod_business ON products (business_system);

-- === BQMS ===

-- bqms_rfq
CREATE INDEX idx_brfq_number ON bqms_rfq (rfq_number);
CREATE INDEX idx_brfq_product ON bqms_rfq (product_id);
CREATE INDEX idx_brfq_supplier ON bqms_rfq (supplier_id);
CREATE INDEX idx_brfq_result ON bqms_rfq (result);
CREATE INDEX idx_brfq_pic ON bqms_rfq (person_in_charge);
CREATE INDEX idx_brfq_date ON bqms_rfq (inquiry_date);
CREATE INDEX idx_brfq_bqms_code ON bqms_rfq (bqms_code) WHERE bqms_code IS NOT NULL;

-- bqms_won_quotations
CREATE INDEX idx_bwq_rfq ON bqms_won_quotations (rfq_id);
CREATE INDEX idx_bwq_product ON bqms_won_quotations (product_id);
CREATE INDEX idx_bwq_hscode ON bqms_won_quotations (hs_code_id);

-- bqms_rfq_submissions
CREATE INDEX idx_bsub_rfq ON bqms_rfq_submissions (rfq_number);
CREATE INDEX idx_bsub_company ON bqms_rfq_submissions (company_id);
CREATE INDEX idx_bsub_customer ON bqms_rfq_submissions (customer_id);
CREATE INDEX idx_bsub_status ON bqms_rfq_submissions (status);
CREATE INDEX idx_bsub_workflow ON bqms_rfq_submissions (workflow_id);

-- bqms_quotation_items
CREATE INDEX idx_bqi_submission ON bqms_quotation_items (submission_id);
CREATE INDEX idx_bqi_product ON bqms_quotation_items (product_id);

-- bqms_orders
CREATE INDEX idx_border_rfq ON bqms_orders (rfq_id);
CREATE INDEX idx_border_product ON bqms_orders (product_id);
CREATE INDEX idx_border_customer ON bqms_orders (customer_id);
CREATE INDEX idx_border_status ON bqms_orders (status);

-- bqms_samsung_po
CREATE INDEX idx_bspo_po_number ON bqms_samsung_po (po_number);
CREATE INDEX idx_bspo_product ON bqms_samsung_po (product_id);
CREATE INDEX idx_bspo_status ON bqms_samsung_po (process_status);
CREATE INDEX idx_bspo_date ON bqms_samsung_po (po_date);
CREATE INDEX idx_bspo_bqms_code ON bqms_samsung_po (bqms_code) WHERE bqms_code IS NOT NULL;
CREATE INDEX idx_bspo_raw_gin ON bqms_samsung_po USING GIN (raw_data);

-- bqms_deliveries
CREATE INDEX idx_bdel_samsung_po ON bqms_deliveries (samsung_po_id);
CREATE INDEX idx_bdel_product ON bqms_deliveries (product_id);
CREATE INDEX idx_bdel_status ON bqms_deliveries (delivery_status);
CREATE INDEX idx_bdel_date ON bqms_deliveries (delivery_date);

-- bqms_monthly_po_summary
CREATE INDEX idx_bmps_month ON bqms_monthly_po_summary (month_year);

-- bqms_raw_material_po
CREATE INDEX idx_brmp_product ON bqms_raw_material_po (product_id);
CREATE INDEX idx_brmp_pending ON bqms_raw_material_po (pending) WHERE pending = true;

-- bqms_manufacturing_schedule
CREATE INDEX idx_bms_product ON bqms_manufacturing_schedule (product_id);
CREATE INDEX idx_bms_month ON bqms_manufacturing_schedule (schedule_month);

-- bqms_manufacturing_daily
CREATE INDEX idx_bmd_schedule ON bqms_manufacturing_daily (schedule_id);
CREATE INDEX idx_bmd_date ON bqms_manufacturing_daily (delivery_date);

-- bqms_material_pricing
CREATE INDEX idx_bmp_product ON bqms_material_pricing (product_id);
CREATE INDEX idx_bmp_rfq ON bqms_material_pricing (rfq_number);

-- bqms_records
CREATE INDEX idx_brec_rfq_sub ON bqms_records (rfq_submission_id);
CREATE INDEX idx_brec_samsung ON bqms_records (samsung_po_id);
CREATE INDEX idx_brec_sync ON bqms_records (sync_status);

-- === IMV ===

-- imv_inquiries
CREATE INDEX idx_imviq_product ON imv_inquiries (product_id);
CREATE INDEX idx_imviq_supplier ON imv_inquiries (supplier_id);
CREATE INDEX idx_imviq_pic ON imv_inquiries (person_in_charge);
CREATE INDEX idx_imviq_date ON imv_inquiries (inquiry_date);

-- imv_consolidated
CREATE INDEX idx_imvcon_product ON imv_consolidated (product_id);
CREATE INDEX idx_imvcon_customer ON imv_consolidated (customer_id);
CREATE INDEX idx_imvcon_purchaser ON imv_consolidated (purchaser_id);
CREATE INDEX idx_imvcon_sales ON imv_consolidated (sales_person_id);

-- imv_purchase_orders
CREATE INDEX idx_imvpo_product ON imv_purchase_orders (product_id);
CREATE INDEX idx_imvpo_supplier ON imv_purchase_orders (supplier_id);
CREATE INDEX idx_imvpo_date ON imv_purchase_orders (po_date);
CREATE INDEX idx_imvpo_number ON imv_purchase_orders (po_number);

-- === XNK ===

-- import_export_tracking
CREATE INDEX idx_xnk_company ON import_export_tracking (company_id);
CREATE INDEX idx_xnk_product ON import_export_tracking (product_id);
CREATE INDEX idx_xnk_hscode ON import_export_tracking (hs_code_id);
CREATE INDEX idx_xnk_year ON import_export_tracking (year);
CREATE INDEX idx_xnk_date ON import_export_tracking (transaction_date);

-- customs_declarations
CREATE INDEX idx_cd_type ON customs_declarations (declaration_type);
CREATE INDEX idx_cd_status ON customs_declarations (status);
CREATE INDEX idx_cd_date ON customs_declarations (declaration_date);
CREATE INDEX idx_cd_created_by ON customs_declarations (created_by);

-- customs_declaration_items
CREATE INDEX idx_cdi_declaration ON customs_declaration_items (declaration_id);
CREATE INDEX idx_cdi_product ON customs_declaration_items (product_id);
CREATE INDEX idx_cdi_hscode ON customs_declaration_items (hs_code_id);

-- === INTERNAL PO ===

-- purchase_orders
CREATE INDEX idx_po_supplier ON purchase_orders (supplier_id);
CREATE INDEX idx_po_customer ON purchase_orders (customer_id);
CREATE INDEX idx_po_company ON purchase_orders (company_id);
CREATE INDEX idx_po_workflow ON purchase_orders (workflow_id);
CREATE INDEX idx_po_status ON purchase_orders (status);
CREATE INDEX idx_po_created_by ON purchase_orders (created_by);
CREATE INDEX idx_po_date ON purchase_orders (order_date);
CREATE INDEX idx_po_business ON purchase_orders (business_system);
CREATE INDEX idx_po_active ON purchase_orders (status)
    WHERE status NOT IN ('cancelled', 'closed');

-- po_line_items
CREATE INDEX idx_poli_po ON po_line_items (po_id);
CREATE INDEX idx_poli_product ON po_line_items (product_id);

-- rfq_requests
CREATE INDEX idx_rfqr_status ON rfq_requests (status);
CREATE INDEX idx_rfqr_created_by ON rfq_requests (created_by);

-- rfq_line_items
CREATE INDEX idx_rfqli_rfq ON rfq_line_items (rfq_id);
CREATE INDEX idx_rfqli_product ON rfq_line_items (product_id);

-- rfq_quotations
CREATE INDEX idx_rfqq_rfq ON rfq_quotations (rfq_id);
CREATE INDEX idx_rfqq_supplier ON rfq_quotations (supplier_id);

-- === SALES ===

-- sales_orders
CREATE INDEX idx_so_customer ON sales_orders (customer_id);
CREATE INDEX idx_so_company ON sales_orders (company_id);
CREATE INDEX idx_so_status ON sales_orders (status);
CREATE INDEX idx_so_date ON sales_orders (order_date);
CREATE INDEX idx_so_created_by ON sales_orders (created_by);

-- sales_order_items
CREATE INDEX idx_soi_order ON sales_order_items (sales_order_id);
CREATE INDEX idx_soi_product ON sales_order_items (product_id);

-- === REVENUE ===

-- revenue_invoices
CREATE INDEX idx_revinv_company ON revenue_invoices (company_id);
CREATE INDEX idx_revinv_customer ON revenue_invoices (customer_id);
CREATE INDEX idx_revinv_product ON revenue_invoices (product_id);
CREATE INDEX idx_revinv_date ON revenue_invoices (invoice_date);
CREATE INDEX idx_revinv_yearmonth ON revenue_invoices (invoice_year, invoice_month);
CREATE INDEX idx_revinv_po ON revenue_invoices (po_id);
CREATE INDEX idx_revinv_samsung_po ON revenue_invoices (samsung_po_id);
CREATE INDEX idx_revinv_imv_po ON revenue_invoices (imv_po_id);
CREATE INDEX idx_revinv_sales ON revenue_invoices (sales_order_id);

-- e_invoices
CREATE INDEX idx_einv_revenue ON e_invoices (revenue_invoice_id);
CREATE INDEX idx_einv_status ON e_invoices (signing_status);
CREATE INDEX idx_einv_date ON e_invoices (issue_date);
CREATE INDEX idx_einv_buyer_tax ON e_invoices (buyer_tax_code);

-- === INVENTORY ===

-- inventory
CREATE INDEX idx_inv_product ON inventory (product_id);
CREATE INDEX idx_inv_category ON inventory (category);
CREATE INDEX idx_inv_low_stock ON inventory (product_code)
    WHERE quantity <= min_stock AND min_stock > 0;
CREATE INDEX idx_inv_name_trgm ON inventory USING GIN (name_unaccent gin_trgm_ops);

-- inventory_movements
CREATE INDEX idx_invmov_product ON inventory_movements (product_id);
CREATE INDEX idx_invmov_product_code ON inventory_movements (product_code);
CREATE INDEX idx_invmov_type ON inventory_movements (movement_type);
CREATE INDEX idx_invmov_ref ON inventory_movements (reference_type, reference_id);
CREATE INDEX idx_invmov_created ON inventory_movements (created_at);

-- === FINANCE ===

-- accounts_payable
CREATE INDEX idx_ap_supplier ON accounts_payable (supplier_id);
CREATE INDEX idx_ap_po ON accounts_payable (po_id);
CREATE INDEX idx_ap_status ON accounts_payable (status);
CREATE INDEX idx_ap_due ON accounts_payable (due_date);
CREATE INDEX idx_ap_overdue ON accounts_payable (due_date)
    WHERE status IN ('pending', 'partial_paid');

-- accounts_receivable
CREATE INDEX idx_ar_customer ON accounts_receivable (customer_id);
CREATE INDEX idx_ar_invoice ON accounts_receivable (invoice_id);
CREATE INDEX idx_ar_status ON accounts_receivable (status);
CREATE INDEX idx_ar_due ON accounts_receivable (due_date);
CREATE INDEX idx_ar_overdue ON accounts_receivable (due_date)
    WHERE status IN ('pending', 'partial_paid');

-- payment_transactions
CREATE INDEX idx_pt_ap ON payment_transactions (ap_id);
CREATE INDEX idx_pt_ar ON payment_transactions (ar_id);
CREATE INDEX idx_pt_date ON payment_transactions (payment_date);
CREATE INDEX idx_pt_direction ON payment_transactions (direction);

-- cash_book
CREATE INDEX idx_cb_company ON cash_book (company_id);
CREATE INDEX idx_cb_date ON cash_book (entry_date);
CREATE INDEX idx_cb_category ON cash_book (category_id);
CREATE INDEX idx_cb_direction ON cash_book (direction);

-- payment_requests
CREATE INDEX idx_pr_requester ON payment_requests (requester_id);
CREATE INDEX idx_pr_workflow ON payment_requests (workflow_id);
CREATE INDEX idx_pr_status ON payment_requests (status);

-- delivery_receipts
CREATE INDEX idx_dr_customer ON delivery_receipts (customer_id);
CREATE INDEX idx_dr_sales ON delivery_receipts (sales_order_id);
CREATE INDEX idx_dr_po ON delivery_receipts (po_id);
CREATE INDEX idx_dr_date ON delivery_receipts (receipt_date);

-- === SUPPORT ===

-- price_history
CREATE INDEX idx_ph_product ON price_history (product_code);
CREATE INDEX idx_ph_supplier ON price_history (supplier_id);
CREATE INDEX idx_ph_recorded ON price_history (recorded_at DESC);

-- notifications
CREATE INDEX idx_notif_recipient ON notifications (recipient_id);
CREATE INDEX idx_notif_unread ON notifications (recipient_id, created_at DESC)
    WHERE is_read = false;
CREATE INDEX idx_notif_type ON notifications (type);
CREATE INDEX idx_notif_ref ON notifications (ref_type, ref_id);

-- audit_log
CREATE INDEX idx_audit_user ON audit_log (user_id);
CREATE INDEX idx_audit_table ON audit_log (table_name);
CREATE INDEX idx_audit_record ON audit_log (table_name, record_id);
CREATE INDEX idx_audit_created ON audit_log (created_at DESC);
CREATE INDEX idx_audit_action ON audit_log (action);

-- file_meta
CREATE INDEX idx_fm_ref ON file_meta (ref_type, ref_id);
CREATE INDEX idx_fm_uploaded_by ON file_meta (uploaded_by);

-- etl_sync_log
CREATE INDEX idx_etl_type ON etl_sync_log (sync_type);
CREATE INDEX idx_etl_status ON etl_sync_log (status);

-- === SYSTEM ===

-- system_settings (covered by UNIQUE on setting_key)

-- user_sessions
CREATE INDEX idx_sess_user ON user_sessions (user_id);
CREATE INDEX idx_sess_token ON user_sessions (session_token);
CREATE INDEX idx_sess_active ON user_sessions (user_id, expires_at)
    WHERE is_revoked = false;

-- budget_targets
CREATE INDEX idx_bt_fiscal ON budget_targets (fiscal_year, fiscal_month);
CREATE INDEX idx_bt_type ON budget_targets (target_type);

-- tasks
CREATE INDEX idx_task_assigned_to ON tasks (assigned_to);
CREATE INDEX idx_task_assigned_by ON tasks (assigned_by);
CREATE INDEX idx_task_status ON tasks (status);
CREATE INDEX idx_task_due ON tasks (due_date) WHERE status IN ('todo', 'in_progress');

-- tags (covered by UNIQUE on tag_name)

-- taggings
CREATE INDEX idx_tagging_ref ON taggings (ref_type, ref_id);
CREATE INDEX idx_tagging_tag ON taggings (tag_id);

-- mv_refresh_log
CREATE INDEX idx_mvrl_view ON mv_refresh_log (view_name);

-- ============================================================================
-- 6. TRIGGERS — ~30 trigger
-- ============================================================================

-- ============================================================
-- 6a. updated_at triggers — Tu dong cap nhat thoi gian sua
-- ============================================================

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_workflow_instances_updated_at
    BEFORE UPDATE ON workflow_instances
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_hs_codes_updated_at
    BEFORE UPDATE ON hs_codes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_material_types_updated_at
    BEFORE UPDATE ON material_types
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_customers_updated_at
    BEFORE UPDATE ON customers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_customer_contacts_updated_at
    BEFORE UPDATE ON customer_contacts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_suppliers_updated_at
    BEFORE UPDATE ON suppliers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_supplier_contracts_updated_at
    BEFORE UPDATE ON supplier_contracts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_products_updated_at
    BEFORE UPDATE ON products
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_bqms_rfq_updated_at
    BEFORE UPDATE ON bqms_rfq
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_bqms_rfq_submissions_updated_at
    BEFORE UPDATE ON bqms_rfq_submissions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_bqms_quotation_items_updated_at
    BEFORE UPDATE ON bqms_quotation_items
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_bqms_orders_updated_at
    BEFORE UPDATE ON bqms_orders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_bqms_samsung_po_updated_at
    BEFORE UPDATE ON bqms_samsung_po
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_bqms_deliveries_updated_at
    BEFORE UPDATE ON bqms_deliveries
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_bqms_raw_material_po_updated_at
    BEFORE UPDATE ON bqms_raw_material_po
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_bqms_manufacturing_schedule_updated_at
    BEFORE UPDATE ON bqms_manufacturing_schedule
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_purchase_orders_updated_at
    BEFORE UPDATE ON purchase_orders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_po_line_items_updated_at
    BEFORE UPDATE ON po_line_items
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_rfq_requests_updated_at
    BEFORE UPDATE ON rfq_requests
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_sales_orders_updated_at
    BEFORE UPDATE ON sales_orders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_revenue_invoices_updated_at
    BEFORE UPDATE ON revenue_invoices
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_e_invoices_updated_at
    BEFORE UPDATE ON e_invoices
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_import_export_tracking_updated_at
    BEFORE UPDATE ON import_export_tracking
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_customs_declarations_updated_at
    BEFORE UPDATE ON customs_declarations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_accounts_payable_updated_at
    BEFORE UPDATE ON accounts_payable
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_accounts_receivable_updated_at
    BEFORE UPDATE ON accounts_receivable
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_cash_book_updated_at
    BEFORE UPDATE ON cash_book
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_payment_requests_updated_at
    BEFORE UPDATE ON payment_requests
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_delivery_receipts_updated_at
    BEFORE UPDATE ON delivery_receipts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_system_settings_updated_at
    BEFORE UPDATE ON system_settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_budget_targets_updated_at
    BEFORE UPDATE ON budget_targets
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_tasks_updated_at
    BEFORE UPDATE ON tasks
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_imv_inquiries_updated_at
    BEFORE UPDATE ON imv_inquiries
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_imv_consolidated_updated_at
    BEFORE UPDATE ON imv_consolidated
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_imv_purchase_orders_updated_at
    BEFORE UPDATE ON imv_purchase_orders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- 6b. Workflow notification trigger
-- ============================================================

CREATE TRIGGER trg_workflow_notify
    AFTER UPDATE ON workflow_instances
    FOR EACH ROW EXECUTE FUNCTION notify_workflow_change();

-- ============================================================
-- 6c. PO number generation trigger
-- ============================================================

CREATE TRIGGER trg_po_generate_number
    BEFORE INSERT ON purchase_orders
    FOR EACH ROW EXECUTE FUNCTION generate_po_number();

-- ============================================================
-- 6d. Audit log triggers — Ghi nhat ky tu dong
-- Ap dung cho cac bang tai chinh va kinh doanh quan trong
-- ============================================================

CREATE TRIGGER trg_audit_purchase_orders
    AFTER INSERT OR UPDATE OR DELETE ON purchase_orders
    FOR EACH ROW EXECUTE FUNCTION auto_audit_log();

CREATE TRIGGER trg_audit_workflow_instances
    AFTER INSERT OR UPDATE OR DELETE ON workflow_instances
    FOR EACH ROW EXECUTE FUNCTION auto_audit_log();

CREATE TRIGGER trg_audit_inventory
    AFTER INSERT OR UPDATE OR DELETE ON inventory
    FOR EACH ROW EXECUTE FUNCTION auto_audit_log();

CREATE TRIGGER trg_audit_suppliers
    AFTER INSERT OR UPDATE OR DELETE ON suppliers
    FOR EACH ROW EXECUTE FUNCTION auto_audit_log();

CREATE TRIGGER trg_audit_customers
    AFTER INSERT OR UPDATE OR DELETE ON customers
    FOR EACH ROW EXECUTE FUNCTION auto_audit_log();

CREATE TRIGGER trg_audit_exchange_rates
    AFTER INSERT OR UPDATE OR DELETE ON exchange_rates
    FOR EACH ROW EXECUTE FUNCTION auto_audit_log();

CREATE TRIGGER trg_audit_imv_purchase_orders
    AFTER INSERT OR UPDATE OR DELETE ON imv_purchase_orders
    FOR EACH ROW EXECUTE FUNCTION auto_audit_log();

CREATE TRIGGER trg_audit_import_export_tracking
    AFTER INSERT OR UPDATE OR DELETE ON import_export_tracking
    FOR EACH ROW EXECUTE FUNCTION auto_audit_log();

CREATE TRIGGER trg_audit_revenue_invoices
    AFTER INSERT OR UPDATE OR DELETE ON revenue_invoices
    FOR EACH ROW EXECUTE FUNCTION auto_audit_log();

CREATE TRIGGER trg_audit_sales_orders
    AFTER INSERT OR UPDATE OR DELETE ON sales_orders
    FOR EACH ROW EXECUTE FUNCTION auto_audit_log();

CREATE TRIGGER trg_audit_accounts_payable
    AFTER INSERT OR UPDATE OR DELETE ON accounts_payable
    FOR EACH ROW EXECUTE FUNCTION auto_audit_log();

CREATE TRIGGER trg_audit_accounts_receivable
    AFTER INSERT OR UPDATE OR DELETE ON accounts_receivable
    FOR EACH ROW EXECUTE FUNCTION auto_audit_log();

CREATE TRIGGER trg_audit_bqms_samsung_po
    AFTER INSERT OR UPDATE OR DELETE ON bqms_samsung_po
    FOR EACH ROW EXECUTE FUNCTION auto_audit_log();

CREATE TRIGGER trg_audit_cash_book
    AFTER INSERT OR UPDATE OR DELETE ON cash_book
    FOR EACH ROW EXECUTE FUNCTION auto_audit_log();

-- ============================================================================
-- 7. ROW LEVEL SECURITY (RLS)
-- ============================================================================
-- Kich hoat RLS va tao policy cho cac bang nhay cam
-- Application phai SET app.current_user_id va app.current_user_role truoc khi query

-- ----------------------------------------------------------------------------
-- 7a. workflow_instances — Admin/Manager thay tat ca, staff thay cua minh
-- ----------------------------------------------------------------------------
ALTER TABLE workflow_instances ENABLE ROW LEVEL SECURITY;

CREATE POLICY wf_admin_all ON workflow_instances
    FOR ALL
    USING (
        current_setting('app.current_user_role', true) IN ('admin', 'manager')
    );

CREATE POLICY wf_staff_own ON workflow_instances
    FOR ALL
    USING (
        created_by = current_setting('app.current_user_id', true)::UUID
        OR assigned_to = current_setting('app.current_user_id', true)::UUID
    );

-- ----------------------------------------------------------------------------
-- 7b. purchase_orders — Admin/Manager/Procurement/Accountant full,
--     Warehouse chi thay in_transit
-- ----------------------------------------------------------------------------
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY po_full_access ON purchase_orders
    FOR ALL
    USING (
        current_setting('app.current_user_role', true) IN ('admin', 'manager', 'procurement', 'accountant')
    );

CREATE POLICY po_warehouse_transit ON purchase_orders
    FOR SELECT
    USING (
        current_setting('app.current_user_role', true) = 'warehouse'
        AND status IN ('in_transit', 'partial_received', 'received')
    );

-- ----------------------------------------------------------------------------
-- 7c. notifications — Chi thay thong bao cua minh
-- ----------------------------------------------------------------------------
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY notif_own_only ON notifications
    FOR ALL
    USING (
        recipient_id = current_setting('app.current_user_id', true)::UUID
    );

-- Admin co the thay tat ca thong bao (de ho tro)
CREATE POLICY notif_admin_all ON notifications
    FOR SELECT
    USING (
        current_setting('app.current_user_role', true) = 'admin'
    );

-- ----------------------------------------------------------------------------
-- 7d. file_meta — Theo vai tro
-- ----------------------------------------------------------------------------
ALTER TABLE file_meta ENABLE ROW LEVEL SECURITY;

-- File cong khai — ai cung thay
CREATE POLICY fm_public ON file_meta
    FOR SELECT
    USING (is_public = true);

-- File cua minh
CREATE POLICY fm_own ON file_meta
    FOR ALL
    USING (
        uploaded_by = current_setting('app.current_user_id', true)::UUID
    );

-- Admin thay tat ca
CREATE POLICY fm_admin ON file_meta
    FOR ALL
    USING (
        current_setting('app.current_user_role', true) = 'admin'
    );

-- Manager thay tat ca
CREATE POLICY fm_manager ON file_meta
    FOR SELECT
    USING (
        current_setting('app.current_user_role', true) = 'manager'
    );

-- ============================================================================
-- 8. MATERIALIZED VIEWS — 7 view tom tat
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 8a. bqms_kpi — Chi so KPI BQMS 30 ngay gan nhat
-- Tong so RFQ, trung/thua, ty le trung, doanh thu
-- ----------------------------------------------------------------------------
CREATE MATERIALIZED VIEW bqms_kpi AS
SELECT
    COUNT(*)                                            AS total_rfqs,
    COUNT(*) FILTER (WHERE result = 'won')              AS won_count,
    COUNT(*) FILTER (WHERE result = 'lost')             AS lost_count,
    COUNT(*) FILTER (WHERE result = 'pending')          AS pending_count,
    ROUND(
        COUNT(*) FILTER (WHERE result = 'won') * 100.0
        / NULLIF(COUNT(*) FILTER (WHERE result IN ('won','lost')), 0), 2
    )                                                   AS win_rate_pct,
    COALESCE(SUM(purchase_price_vnd) FILTER (WHERE result = 'won'), 0) AS total_won_value_vnd,
    NOW()                                               AS refreshed_at
FROM bqms_rfq
WHERE inquiry_date >= CURRENT_DATE - INTERVAL '30 days';

CREATE UNIQUE INDEX idx_bqms_kpi ON bqms_kpi (refreshed_at);
COMMENT ON MATERIALIZED VIEW bqms_kpi IS 'KPI BQMS 30 ngay — ty le trung, doanh thu';

-- ----------------------------------------------------------------------------
-- 8b. mv_revenue_monthly — Doanh thu theo thang
-- Tong hop doanh thu, chi phi, loi nhuan theo thang/nam
-- ----------------------------------------------------------------------------
CREATE MATERIALIZED VIEW mv_revenue_monthly AS
SELECT
    invoice_year,
    invoice_month,
    company_id,
    COUNT(*)                    AS invoice_count,
    SUM(amount)                 AS total_revenue,
    SUM(vat_amount)             AS total_vat,
    SUM(total_amount)           AS total_with_vat,
    SUM(total_cost)             AS total_cost,
    SUM(profit)                 AS total_profit,
    ROUND(
        SUM(profit) * 100.0 / NULLIF(SUM(amount), 0), 2
    )                           AS profit_margin_pct,
    NOW()                       AS refreshed_at
FROM revenue_invoices
WHERE invoice_year IS NOT NULL AND invoice_month IS NOT NULL
GROUP BY invoice_year, invoice_month, company_id;

CREATE UNIQUE INDEX idx_mv_rev_monthly
    ON mv_revenue_monthly (invoice_year, invoice_month, COALESCE(company_id, 0));
COMMENT ON MATERIALIZED VIEW mv_revenue_monthly IS 'Doanh thu theo thang — revenue, cost, profit';

-- ----------------------------------------------------------------------------
-- 8c. mv_bqms_win_rate — Ty le trung BQMS theo thang
-- Phan tich xu huong trung/thua bao gia
-- ----------------------------------------------------------------------------
CREATE MATERIALIZED VIEW mv_bqms_win_rate AS
SELECT
    DATE_TRUNC('month', inquiry_date)::DATE     AS month,
    COUNT(*)                                    AS total_rfqs,
    COUNT(*) FILTER (WHERE result = 'won')      AS won,
    COUNT(*) FILTER (WHERE result = 'lost')     AS lost,
    ROUND(
        COUNT(*) FILTER (WHERE result = 'won') * 100.0
        / NULLIF(COUNT(*) FILTER (WHERE result IN ('won','lost')), 0), 2
    )                                           AS win_rate_pct,
    NOW()                                       AS refreshed_at
FROM bqms_rfq
WHERE inquiry_date IS NOT NULL
GROUP BY DATE_TRUNC('month', inquiry_date);

CREATE UNIQUE INDEX idx_mv_bqms_wr ON mv_bqms_win_rate (month);
COMMENT ON MATERIALIZED VIEW mv_bqms_win_rate IS 'Ty le trung BQMS theo thang';

-- ----------------------------------------------------------------------------
-- 8d. mv_supplier_performance — Hieu suat nha cung cap
-- Ty le giao dung hen, thoi gian giao trung binh
-- ----------------------------------------------------------------------------
CREATE MATERIALIZED VIEW mv_supplier_performance AS
SELECT
    s.id                                        AS supplier_id,
    s.name                                      AS supplier_name,
    COUNT(po.id)                                AS total_pos,
    COUNT(po.id) FILTER (WHERE po.status = 'received')  AS completed_pos,
    COUNT(po.id) FILTER (WHERE po.status = 'cancelled') AS cancelled_pos,
    ROUND(AVG(
        CASE WHEN po.received_date IS NOT NULL AND po.order_date IS NOT NULL
             THEN po.received_date - po.order_date
        END
    ), 1)                                       AS avg_lead_time_days,
    COUNT(po.id) FILTER (
        WHERE po.received_date IS NOT NULL
          AND po.expected_date IS NOT NULL
          AND po.received_date <= po.expected_date
    ) * 100.0 / NULLIF(
        COUNT(po.id) FILTER (WHERE po.received_date IS NOT NULL), 0
    )                                           AS on_time_rate_pct,
    s.rating,
    NOW()                                       AS refreshed_at
FROM suppliers s
LEFT JOIN purchase_orders po ON po.supplier_id = s.id
WHERE s.deleted_at IS NULL
GROUP BY s.id, s.name, s.rating;

CREATE UNIQUE INDEX idx_mv_sup_perf ON mv_supplier_performance (supplier_id);
COMMENT ON MATERIALIZED VIEW mv_supplier_performance IS 'Hieu suat NCC — on-time rate, avg lead time';

-- ----------------------------------------------------------------------------
-- 8e. mv_po_pipeline — PO theo trang thai va he thong
-- Dashboard overview don hang
-- ----------------------------------------------------------------------------
CREATE MATERIALIZED VIEW mv_po_pipeline AS
SELECT
    status,
    business_system,
    COUNT(*)                    AS po_count,
    SUM(total_amount)           AS total_value,
    currency,
    NOW()                       AS refreshed_at
FROM purchase_orders
GROUP BY status, business_system, currency;

CREATE UNIQUE INDEX idx_mv_po_pipe
    ON mv_po_pipeline (status, COALESCE(business_system::TEXT, ''), COALESCE(currency::TEXT, ''));
COMMENT ON MATERIALIZED VIEW mv_po_pipeline IS 'PO pipeline — so luong va gia tri theo trang thai';

-- ----------------------------------------------------------------------------
-- 8f. mv_inventory_value — Gia tri ton kho theo danh muc
-- Tinh tong gia tri ton kho hien tai
-- ----------------------------------------------------------------------------
CREATE MATERIALIZED VIEW mv_inventory_value AS
SELECT
    COALESCE(category, 'Chua phan loai')  AS category,
    COUNT(*)                              AS item_count,
    SUM(quantity)                         AS total_qty,
    SUM(quantity * COALESCE(unit_cost, 0))  AS total_value,
    SUM(reserved_qty)                     AS total_reserved,
    SUM(quantity - reserved_qty)          AS total_available,
    NOW()                                 AS refreshed_at
FROM inventory
WHERE quantity > 0
GROUP BY COALESCE(category, 'Chua phan loai');

CREATE UNIQUE INDEX idx_mv_inv_val ON mv_inventory_value (category);
COMMENT ON MATERIALIZED VIEW mv_inventory_value IS 'Gia tri ton kho theo danh muc';

-- ----------------------------------------------------------------------------
-- 8g. mv_vat_declaration_monthly — Tong hop VAT hang thang
-- Phuc vu ke khai thue GTGT
-- Doanh thu dau ra - Dau vao = VAT phai nop
-- ----------------------------------------------------------------------------
CREATE MATERIALIZED VIEW mv_vat_declaration_monthly AS
SELECT
    ri.invoice_year                          AS year,
    ri.invoice_month                         AS month,
    ri.company_id,
    -- Dau ra (ban hang)
    SUM(ri.amount)                           AS output_revenue,
    SUM(ri.vat_amount)                       AS output_vat,
    -- Dau vao (mua hang) — lay tu accounts_payable trong cung thang
    (
        SELECT COALESCE(SUM(ap.amount_vnd * 0.1), 0)
        FROM accounts_payable ap
        WHERE EXTRACT(YEAR FROM ap.invoice_date) = ri.invoice_year
          AND EXTRACT(MONTH FROM ap.invoice_date) = ri.invoice_month
          AND (ri.company_id IS NULL OR ap.supplier_id IS NOT NULL)
    )                                        AS input_vat_estimate,
    -- VAT phai nop (dau ra - dau vao)
    SUM(ri.vat_amount) - (
        SELECT COALESCE(SUM(ap2.amount_vnd * 0.1), 0)
        FROM accounts_payable ap2
        WHERE EXTRACT(YEAR FROM ap2.invoice_date) = ri.invoice_year
          AND EXTRACT(MONTH FROM ap2.invoice_date) = ri.invoice_month
    )                                        AS vat_payable,
    NOW()                                    AS refreshed_at
FROM revenue_invoices ri
WHERE ri.invoice_year IS NOT NULL AND ri.invoice_month IS NOT NULL
GROUP BY ri.invoice_year, ri.invoice_month, ri.company_id;

CREATE UNIQUE INDEX idx_mv_vat_decl
    ON mv_vat_declaration_monthly (year, month, COALESCE(company_id, 0));
COMMENT ON MATERIALIZED VIEW mv_vat_declaration_monthly IS 'Tong hop VAT hang thang — ke khai thue GTGT';

-- ============================================================================
-- 9. POPULATE dim_date — 2020-01-01 den 2030-12-31
-- ============================================================================
-- Dien du lieu ngay voi thong tin:
-- - Ten ngay (tieng Anh va tieng Viet)
-- - Ten thang (tieng Anh va tieng Viet)
-- - Cuoi tuan / Ngay lam viec
-- - Nam/Quy/Thang tai chinh (tai chinh = duong lich tai VN)

INSERT INTO dim_date (
    date_key, year, quarter, month, week_of_year,
    day_of_month, day_of_week, day_name, day_name_vi,
    month_name, month_name_vi,
    is_weekend, is_holiday, holiday_name, is_working_day,
    fiscal_year, fiscal_quarter, fiscal_month
)
SELECT
    d::DATE                                       AS date_key,
    EXTRACT(YEAR FROM d)::SMALLINT                AS year,
    EXTRACT(QUARTER FROM d)::SMALLINT             AS quarter,
    EXTRACT(MONTH FROM d)::SMALLINT               AS month,
    EXTRACT(WEEK FROM d)::SMALLINT                AS week_of_year,
    EXTRACT(DAY FROM d)::SMALLINT                 AS day_of_month,
    EXTRACT(DOW FROM d)::SMALLINT                 AS day_of_week,
    TO_CHAR(d, 'Day')                             AS day_name,
    CASE EXTRACT(DOW FROM d)
        WHEN 0 THEN 'Chu Nhat'
        WHEN 1 THEN 'Thu Hai'
        WHEN 2 THEN 'Thu Ba'
        WHEN 3 THEN 'Thu Tu'
        WHEN 4 THEN 'Thu Nam'
        WHEN 5 THEN 'Thu Sau'
        WHEN 6 THEN 'Thu Bay'
    END                                           AS day_name_vi,
    TO_CHAR(d, 'Month')                           AS month_name,
    'Thang ' || EXTRACT(MONTH FROM d)::TEXT       AS month_name_vi,
    -- Cuoi tuan: Thu 7 (6) va Chu Nhat (0)
    EXTRACT(DOW FROM d) IN (0, 6)                 AS is_weekend,
    false                                         AS is_holiday,
    NULL                                          AS holiday_name,
    -- Ngay lam viec: khong phai cuoi tuan
    NOT (EXTRACT(DOW FROM d) IN (0, 6))           AS is_working_day,
    -- Tai chinh = duong lich tai Viet Nam
    EXTRACT(YEAR FROM d)::SMALLINT                AS fiscal_year,
    EXTRACT(QUARTER FROM d)::SMALLINT             AS fiscal_quarter,
    EXTRACT(MONTH FROM d)::SMALLINT               AS fiscal_month
FROM generate_series('2020-01-01'::DATE, '2030-12-31'::DATE, '1 day'::INTERVAL) AS d;

-- Danh dau ngay le Viet Nam (duong lich co dinh)
-- Tet Duong lich — 1/1
UPDATE dim_date SET is_holiday = true, holiday_name = 'Tet Duong lich', is_working_day = false
WHERE month = 1 AND day_of_month = 1;

-- Ngay Giai phong mien Nam — 30/4
UPDATE dim_date SET is_holiday = true, holiday_name = 'Ngay Giai phong mien Nam', is_working_day = false
WHERE month = 4 AND day_of_month = 30;

-- Ngay Quoc te Lao dong — 1/5
UPDATE dim_date SET is_holiday = true, holiday_name = 'Ngay Quoc te Lao dong', is_working_day = false
WHERE month = 5 AND day_of_month = 1;

-- Ngay Quoc khanh — 2/9
UPDATE dim_date SET is_holiday = true, holiday_name = 'Ngay Quoc khanh', is_working_day = false
WHERE month = 9 AND day_of_month = 2;

-- Gio to Hung Vuong — 10/3 Am lich ~ khoang giua thang 4 Duong lich
-- Vi ngay am lich thay doi hang nam, danh dau khoang 18/4 lam dai dien
-- Thuc te can cap nhat hang nam theo lich am lich chinh xac
UPDATE dim_date SET is_holiday = true, holiday_name = 'Gio to Hung Vuong (10/3 AL)', is_working_day = false
WHERE month = 4 AND day_of_month = 18;

-- ============================================================================
-- 10. SEED DATA — Du lieu khoi tao
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 10a. Admin user — Tai khoan quan tri vien
-- Email: thang@songchau.vn | Pass: SongChau@2026
-- bcrypt hash da tinh san
-- ----------------------------------------------------------------------------
INSERT INTO users (email, full_name, display_name, role, department, hashed_password, is_active)
VALUES (
    'thang@songchau.vn',
    'Nguyen Van Thang',
    'Thang NV',
    'admin',
    'Ban Giam doc',
    '$2b$12$LJ3m4ys5yVxVdTzS8WZ.7eGNfPbRKqRDXNwGJxYBhXpVDKFCymKnq',
    true
);

-- ----------------------------------------------------------------------------
-- 10b. Companies — 2 phap nhan
-- Song Chau va AMA Bac Ninh
-- ----------------------------------------------------------------------------
INSERT INTO companies (company_code, company_name, tax_code) VALUES
    ('SC',  'Cong ty TNHH MTV Song Chau',  '2500574479'),
    ('AMA', 'Cong ty CP AMA Bac Ninh',     '0109945747');

-- ----------------------------------------------------------------------------
-- 10c. Cash book categories — 7 danh muc thu/chi
-- ----------------------------------------------------------------------------
INSERT INTO cash_book_categories (category_code, category_name, direction, sort_order) VALUES
    ('CP_MUA_HANG', 'Chi phi mua hang',       'chi',  1),
    ('CP_VP',       'Chi phi van phong',       'chi',  2),
    ('GD_CHI',      'Giam doc chi',            'chi',  3),
    ('QUY_SN',      'Quy san xuat',           'chi',  4),
    ('CP_VC',       'Chi phi van chuyen',      'chi',  5),
    ('VC_TQ',       'Van chuyen hang TQ',      'chi',  6),
    ('XE_TAI',      'Xe tai',                  'chi',  7);

-- ----------------------------------------------------------------------------
-- 10d. System settings — 7 tham so cau hinh
-- ----------------------------------------------------------------------------
INSERT INTO system_settings (setting_key, setting_value, setting_type, description) VALUES
    ('approval_threshold_l1', '50000000',       'number',  'Nguong duyet cap 1 — 50 trieu VND'),
    ('approval_threshold_l2', '200000000',      'number',  'Nguong duyet cap 2 — 200 trieu VND'),
    ('default_vat_rate',      '10',             'number',  'Thue suat VAT mac dinh (%)'),
    ('po_number_prefix',      '"PO"',           'string',  'Tien to so don dat hang'),
    ('bqms_sync_schedule',    '"23:30"',        'string',  'Lich dong bo BQMS — 23:30 hang ngay'),
    ('report_schedule',       '"07:00"',        'string',  'Lich tao bao cao — 07:00 hang ngay'),
    ('stock_alert_threshold_days', '7',         'number',  'Canh bao ton kho — 7 ngay truoc khi het');

-- ============================================================================
-- 11. FINAL VERIFICATION — Kiem tra tong ket
-- ============================================================================

-- Dem so bang da tao
DO $$
DECLARE
    v_table_count INT;
    v_enum_count  INT;
    v_index_count INT;
    v_trigger_count INT;
    v_mv_count INT;
BEGIN
    SELECT COUNT(*) INTO v_table_count
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE';

    SELECT COUNT(*) INTO v_enum_count
    FROM pg_type
    WHERE typnamespace = 'public'::regnamespace AND typtype = 'e';

    SELECT COUNT(*) INTO v_index_count
    FROM pg_indexes
    WHERE schemaname = 'public';

    SELECT COUNT(*) INTO v_trigger_count
    FROM information_schema.triggers
    WHERE trigger_schema = 'public';

    SELECT COUNT(*) INTO v_mv_count
    FROM pg_matviews
    WHERE schemaname = 'public';

    RAISE NOTICE '=============================================';
    RAISE NOTICE 'SONG CHAU ERP v3 — KET QUA KHOI TAO';
    RAISE NOTICE '=============================================';
    RAISE NOTICE 'Bang (tables):            %', v_table_count;
    RAISE NOTICE 'Enum types:               %', v_enum_count;
    RAISE NOTICE 'Indexes:                  %', v_index_count;
    RAISE NOTICE 'Triggers:                 %', v_trigger_count;
    RAISE NOTICE 'Materialized Views:       %', v_mv_count;
    RAISE NOTICE '=============================================';
    RAISE NOTICE 'HOAN TAT — He thong san sang su dung!';
    RAISE NOTICE '=============================================';
END;
$$;

-- ============================================================================
-- END OF FILE — init_v3.sql
-- Song Chau ERP v3 — Complete Database Schema
-- 64 tables | 14 enums | ~110 indexes | ~30 triggers | 7 MVs | RLS | Seed data
-- ============================================================================
