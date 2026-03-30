-- ════════════════════════════════════════════════════════════════════════════
-- Song Chau ERP — Database Schema v2.0
-- Complete schema derived from analysis of 28 Excel files
-- PostgreSQL 16 | Generated: 2026-03-29
--
-- NAMING CONVENTIONS (per MASTER_CONTEXT):
--   Tables:      snake_case, plural   (users, purchase_orders)
--   Columns:     snake_case           (created_at, po_number)
--   Indexes:     idx_{table}_{column}
--   Constraints: chk_{table}_{rule}
--   FKs:         implicit via REFERENCES
--
-- COLUMN ORDERING:
--   1. Primary key  2. Foreign keys  3. Business columns
--   4. Status/enum  5. Metadata (created_at, updated_at, created_by)
-- ════════════════════════════════════════════════════════════════════════════

-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │  EXTENSIONS                                                              │
-- └──────────────────────────────────────────────────────────────────────────┘

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";     -- bcrypt for passwords
CREATE EXTENSION IF NOT EXISTS "pg_trgm";      -- Fuzzy / trigram search
CREATE EXTENSION IF NOT EXISTS "unaccent";     -- Vietnamese diacritics removal

-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │  ENUMS                                                                   │
-- └──────────────────────────────────────────────────────────────────────────┘

CREATE TYPE role_enum AS ENUM (
    'admin',        -- Full system access (Thắng / IT)
    'manager',      -- Approval authority, KPI dashboards
    'procurement',  -- RFQ / PO / BQMS processing
    'warehouse',    -- Receiving, stock management
    'staff',        -- General office tasks
    'accountant'    -- Read-only financial reports
);

CREATE TYPE workflow_status AS ENUM (
    'draft',
    'pending_l1',   -- Chờ duyệt cấp 1 (Manager)
    'pending_l2',   -- Chờ duyệt cấp 2 (Director)
    'approved',
    'rejected',
    'cancelled'
);

CREATE TYPE workflow_type AS ENUM (
    'purchase_approval',   -- Phê duyệt mua hàng
    'po_approval',         -- Phê duyệt PO
    'rfq_approval',        -- Phê duyệt báo giá
    'bqms_quotation',      -- Báo giá Samsung BQMS
    'expense_approval',    -- Phê duyệt chi phí
    'task_assignment'      -- Giao việc
);

CREATE TYPE po_status AS ENUM (
    'draft',
    'pending_approval',
    'approved',
    'sent_to_supplier',
    'confirmed',
    'in_transit',
    'partial_received',
    'received',
    'closed',
    'cancelled'
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

CREATE TYPE currency_code AS ENUM (
    'VND', 'USD', 'RMB', 'KRW', 'JPY', 'EUR'
);

CREATE TYPE business_system AS ENUM (
    'bqms',   -- Samsung SEV/SEVT via BQMS portal
    'imv'     -- iMarket Vietnam
);

CREATE TYPE goods_type AS ENUM (
    'gia_cong',    -- Gia công (processing/manufacturing)
    'thuong_mai'   -- Thương mại (trading)
);

CREATE TYPE delivery_status AS ENUM (
    'chua_giao',       -- Chưa giao
    'dang_giao',       -- Đang giao
    'da_giao',         -- Đã giao
    'giao_mot_phan'    -- Giao một phần
);

CREATE TYPE rfq_result AS ENUM (
    'pending',    -- Đang chờ
    'won',        -- Trúng thầu (Y)
    'lost',       -- Thua (N)
    'cancelled'   -- Hủy
);

CREATE TYPE quotation_status AS ENUM (
    'draft',
    'pending',
    'submitted',
    'won',
    'lost',
    'expired',
    'cancelled'
);

CREATE TYPE samsung_po_process_status AS ENUM (
    'new',
    'confirmed',
    'unconfirmed',
    'shipped',
    'received',
    'invoiced',
    'closed'
);

-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │  1. CORE TABLES — Users, Workflow, Audit                                │
-- └──────────────────────────────────────────────────────────────────────────┘

-- Người dùng hệ thống — 18 nhân viên nội bộ Song Châu
CREATE TABLE users (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    email           TEXT        NOT NULL UNIQUE,
    full_name       TEXT        NOT NULL,
    display_name    TEXT,                           -- Tên ngắn hiển thị
    role            role_enum   NOT NULL,
    department      TEXT,
    phone           TEXT,
    hashed_password TEXT        NOT NULL,           -- bcrypt rounds=12
    m365_id         TEXT UNIQUE,                    -- Microsoft Azure AD ID (SSO)
    is_active       BOOLEAN     NOT NULL DEFAULT true,
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by      UUID        REFERENCES users(id)
);
COMMENT ON TABLE users IS 'Người dùng hệ thống Song Châu ERP — 18 nhân viên, 6 roles';

-- Workflow phê duyệt đa cấp
CREATE TABLE workflow_instances (
    id              BIGSERIAL   PRIMARY KEY,
    workflow_type   workflow_type NOT NULL,
    current_status  workflow_status NOT NULL DEFAULT 'draft',
    title           TEXT        NOT NULL,
    description     TEXT,
    amount          NUMERIC(15,2),                 -- Giá trị liên quan (nếu có)
    currency        TEXT        DEFAULT 'VND',
    priority        SMALLINT    DEFAULT 2,         -- 1=low, 2=normal, 3=high, 4=urgent
    data            JSONB       NOT NULL DEFAULT '{}',
    ref_type        TEXT,                          -- 'purchase_order', 'bqms_rfq', etc.
    ref_id          BIGINT,
    created_by      UUID        NOT NULL REFERENCES users(id),
    assigned_to     UUID        REFERENCES users(id),
    deadline        TIMESTAMPTZ,
    closed_at       TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE workflow_instances IS 'Luồng phê duyệt đa cấp — PO, RFQ, BQMS, chi phí';

-- Lịch sử trạng thái workflow — immutable
CREATE TABLE workflow_history (
    id              BIGSERIAL   PRIMARY KEY,
    instance_id     BIGINT      NOT NULL REFERENCES workflow_instances(id) ON DELETE CASCADE,
    from_status     workflow_status,
    to_status       workflow_status NOT NULL,
    action          TEXT        NOT NULL,          -- 'submit', 'approve', 'reject', 'cancel'
    actor_id        UUID        NOT NULL REFERENCES users(id),
    comment         TEXT,
    ip_address      INET,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE workflow_history IS 'Lịch sử chuyển trạng thái workflow — không sửa/xóa bao giờ';

-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │  2. LOOKUP / REFERENCE TABLES                                            │
-- └──────────────────────────────────────────────────────────────────────────┘

-- Tỷ giá ngoại tệ — Source: sheet TGUSD (~1485 entries) + daily updates
CREATE TABLE exchange_rates (
    id              BIGSERIAL   PRIMARY KEY,
    rate_date       DATE        NOT NULL,
    from_currency   currency_code NOT NULL DEFAULT 'USD',
    to_currency     currency_code NOT NULL DEFAULT 'VND',
    rate            NUMERIC(15,4) NOT NULL,        -- e.g. 25,445.0000 for USD/VND
    source          TEXT        DEFAULT 'manual',  -- 'manual', 'vcb_api', 'excel_import'
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_exchange_rate_date UNIQUE (rate_date, from_currency, to_currency)
);
COMMENT ON TABLE exchange_rates IS 'Lịch sử tỷ giá — từ sheet TGUSD (2019–nay), hỗ trợ VND/USD/RMB/KRW/JPY';

-- Mã HS (Harmonized System) — dùng cho XNK và BQMS
CREATE TABLE hs_codes (
    id              BIGSERIAL   PRIMARY KEY,
    hs_code         TEXT        NOT NULL UNIQUE,
    description_vi  TEXT,                          -- Miêu tả tiếng Việt
    description_en  TEXT,
    tax_rate        NUMERIC(5,2),                  -- Thuế suất %
    is_active       BOOLEAN     NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE hs_codes IS 'Danh mục mã HS — dùng cho khai hải quan, tính thuế XNK';

-- Loại phôi & đơn giá — Source: file "Gia phoi" (~80 materials)
CREATE TABLE material_types (
    id              BIGSERIAL   PRIMARY KEY,
    type_code       TEXT        NOT NULL UNIQUE,    -- e.g. 'PB108', 'ACETAL', 'PEEK'
    type_name       TEXT        NOT NULL,
    unit_price_kg   NUMERIC(15,2),                 -- Đơn giá VND/KG
    density_g_cm3   NUMERIC(8,4),                  -- Tỷ trọng (g/cm3) cho tính trọng lượng
    supplier_name   TEXT,                           -- NCC phôi
    notes           TEXT,
    is_active       BOOLEAN     NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE material_types IS 'Danh mục loại phôi (PB108, Acetal, PEEK...) — Source: file Gia phoi';

-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │  3. CUSTOMERS & CONTACTS                                                 │
-- └──────────────────────────────────────────────────────────────────────────┘

-- Khách hàng — Samsung SEV/SEVT, LG, Canon, Foxconn, etc.
CREATE TABLE customers (
    id              BIGSERIAL   PRIMARY KEY,
    customer_code   TEXT        UNIQUE,             -- Mã KH nội bộ
    company_name    TEXT        NOT NULL,
    company_name_unaccent TEXT GENERATED ALWAYS AS (unaccent(lower(company_name))) STORED,
    short_name      TEXT,                           -- Tên viết tắt (e.g. 'SEV', 'SEVT')
    tax_code        TEXT,                           -- MST
    address         TEXT,
    business_system business_system,                -- bqms / imv
    customer_type   TEXT,                           -- 'thuong_mai' / 'su_dung' (from Khách hàng lẻ)
    is_active       BOOLEAN     NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE customers IS 'Danh sách khách hàng — Samsung, LG, Canon, khách lẻ (~270 KH)';

-- Liên hệ khách hàng — Source: sheet DANH BẠ (~1025 contacts)
CREATE TABLE customer_contacts (
    id              BIGSERIAL   PRIMARY KEY,
    customer_id     BIGINT      REFERENCES customers(id),
    full_name       TEXT        NOT NULL,           -- Tên
    email           TEXT,                           -- Mail
    phone           TEXT,                           -- SĐT
    department      TEXT,                           -- Bộ phận
    delivery_info   TEXT,                           -- Thông tin giao hàng
    warehouse_code  TEXT,                           -- Kho nhận (KHO NHẬN)
    is_primary      BOOLEAN     NOT NULL DEFAULT false,
    is_active       BOOLEAN     NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE customer_contacts IS 'Danh bạ KH Samsung — Source: sheet DANH BẠ (~1025 liên hệ)';

-- Khách hàng lẻ — Source: file "Khách hàng lẻ" (~270 entries)
-- Extends customers table but keeps inquiry-specific data
CREATE TABLE retail_customer_inquiries (
    id              BIGSERIAL   PRIMARY KEY,
    customer_id     BIGINT      REFERENCES customers(id),
    inquiry_date    DATE,                           -- Ngày hỏi hàng
    person_in_charge UUID       REFERENCES users(id), -- Người phụ trách
    contact_name    TEXT,                           -- Tên khách
    company_name    TEXT,                           -- Tên công ty
    address         TEXT,                           -- Địa chỉ
    tax_code        TEXT,                           -- MST
    phone           TEXT,                           -- SĐT
    email           TEXT,                           -- Email
    customer_type   TEXT,                           -- 'thuong_mai' / 'su_dung'
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE retail_customer_inquiries IS 'Hỏi hàng KH lẻ — Source: file Khách hàng lẻ (~270 entries)';

-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │  4. SUPPLIERS                                                            │
-- └──────────────────────────────────────────────────────────────────────────┘

-- Nhà cung cấp — NCC Trung Quốc, Hàn Quốc, nội địa
CREATE TABLE suppliers (
    id              BIGSERIAL   PRIMARY KEY,
    name            TEXT        NOT NULL,
    name_unaccent   TEXT GENERATED ALWAYS AS (unaccent(lower(name))) STORED,
    contact_name    TEXT,
    contact_email   TEXT,
    contact_phone   TEXT,
    contact_wechat  TEXT,                           -- Quan trọng với NCC Trung Quốc
    country         TEXT        NOT NULL DEFAULT 'CN',
    address         TEXT,
    payment_terms   TEXT,                           -- 'T/T 30% deposit', etc.
    lead_time_days  SMALLINT,
    rating          NUMERIC(3,1) CHECK (rating BETWEEN 0 AND 5),
    default_currency currency_code DEFAULT 'USD',
    tax_code        TEXT,
    notes           TEXT,
    is_active       BOOLEAN     NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by      UUID        NOT NULL REFERENCES users(id)
);
COMMENT ON TABLE suppliers IS 'Nhà cung cấp — NCC TQ/KR/nội địa, field NCC trong BQMS/IMV files';

-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │  5. PRODUCT / MATERIAL MASTER                                            │
-- └──────────────────────────────────────────────────────────────────────────┘

-- Danh mục sản phẩm / vật tư — Source: BQMS Sheet "Sheet2" (Material master)
-- + IMV Tổng hợp Mã Hàng, + BQMS code from all files
CREATE TABLE products (
    id              BIGSERIAL   PRIMARY KEY,
    bqms_code       TEXT        UNIQUE,             -- BQMS code (e.g. Z0000001-709890)
    imv_code        TEXT        UNIQUE,             -- IMV item code (e.g. 1043874600)
    customer_code   TEXT,                           -- Mã hàng khách hàng
    product_name    TEXT        NOT NULL,
    product_name_vi TEXT,                           -- Tên tiếng Việt (from Material master)
    product_name_unaccent TEXT GENERATED ALWAYS AS (unaccent(lower(COALESCE(product_name_vi, product_name)))) STORED,
    specification   TEXT,                           -- Spec / Quy cách
    maker           TEXT,                           -- Nhà sản xuất / Maker 업체
    category        TEXT,                           -- Category from Samsung
    material_type_id BIGINT     REFERENCES material_types(id),
    hs_code_id      BIGINT      REFERENCES hs_codes(id),
    unit            TEXT        NOT NULL DEFAULT 'EA', -- ĐVT: EA, PCS, KG, M, SET
    country_origin  TEXT,                           -- Xuất xứ
    weight_kg       NUMERIC(10,4),                  -- Cân nặng (KG)
    dimensions_l    NUMERIC(10,3),                  -- Chiều dài (mm)
    dimensions_w    NUMERIC(10,3),                  -- Chiều rộng (mm)
    dimensions_h    NUMERIC(10,3),                  -- Chiều cao (mm)
    business_system business_system,                -- bqms / imv
    image_path      TEXT,                           -- Hình ảnh sản phẩm
    is_active       BOOLEAN     NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE products IS 'Master sản phẩm/vật tư — BQMS code, IMV code, specs, maker, HS code';

-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │  6. BQMS MODULE (Samsung SEV/SEVT) — Files 1, 2, 3, 4, 5, 6, 11, 12    │
-- └──────────────────────────────────────────────────────────────────────────┘

-- 6A. BQMS Hỏi Hàng (RFQ Inquiries) — Source: file 1 (~8200 rows)
-- Core RFQ from Samsung BQMS portal
CREATE TABLE bqms_rfq (
    id              BIGSERIAL   PRIMARY KEY,
    rfq_number      TEXT        NOT NULL,           -- RFQ No. (e.g. QT23033303)
    product_id      BIGINT      REFERENCES products(id),
    bqms_code       TEXT,                           -- BQMS code (e.g. Z0000001-709890), denormalized for import
    specification   TEXT,                           -- Spec
    maker           TEXT,                           -- Maker
    inquiry_date    DATE,                           -- Ngày hỏi
    person_in_charge UUID      REFERENCES users(id), -- Người phụ trách
    person_in_charge_name TEXT,                     -- Tên NV (for legacy data without user mapping)
    expected_qty    NUMERIC(12,3),                  -- Số lượng dự kiến
    unit            TEXT        DEFAULT 'EA',
    -- Pricing
    purchase_price_rmb   NUMERIC(15,4),             -- Giá nhập RMB
    purchase_price_vnd   NUMERIC(15,2),             -- Giá nhập VND
    quoted_price_ama     NUMERIC(15,4),             -- Giá báo cho AMA
    quoted_price_bqms_v1 NUMERIC(15,4),             -- Giá báo cho BQMS V1
    quoted_price_bqms_v2 NUMERIC(15,4),             -- Giá báo cho BQMS V2
    quoted_price_bqms_v3 NUMERIC(15,4),             -- Giá báo cho BQMS V3
    quoted_price_bqms_v4 NUMERIC(15,4),             -- Giá báo cho BQMS V4
    supplier_id     BIGINT      REFERENCES suppliers(id),
    supplier_name   TEXT,                           -- NCC (denormalized for import)
    result          rfq_result  NOT NULL DEFAULT 'pending', -- Kết quả Y/N
    report          TEXT,                           -- Báo cáo
    notes           TEXT,                           -- Ghi chú
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE bqms_rfq IS 'BQMS hỏi hàng — Source: file BQMS Hỏi Hàng (~8200 rows), RFQ từ Samsung';

-- 6B. BQMS Won Quotations — Source: sheet "TRUNG BG" in file 1
CREATE TABLE bqms_won_quotations (
    id              BIGSERIAL   PRIMARY KEY,
    rfq_id          BIGINT      REFERENCES bqms_rfq(id),
    rfq_number      TEXT,                           -- RFQ No.
    bqms_code       TEXT,                           -- BQMS code
    product_id      BIGINT      REFERENCES products(id),
    person_in_charge_name TEXT,                     -- Người phụ trách
    description     TEXT,                           -- Description
    specification   TEXT,                           -- Spec
    quantity        NUMERIC(12,3),                  -- Số lượng
    unit            TEXT        DEFAULT 'EA',
    po_price        NUMERIC(15,4),                  -- Giá PO
    po_deadline     DATE,                           -- Hạn PO
    supplier_name   TEXT,                           -- NCC
    hs_code         TEXT,                           -- HS code
    goods_description TEXT,                         -- Miêu tả hàng hóa
    customs_char_count INTEGER,                     -- SL kí tự khai hàng
    notes           TEXT,                           -- Ghi chú
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE bqms_won_quotations IS 'Báo giá BQMS đã trúng — Source: sheet TRUNG BG trong file Hỏi Hàng';

-- 6C. BQMS RFQ Submissions (Auto-fill quotation output)
CREATE TABLE bqms_rfq_submissions (
    id              BIGSERIAL   PRIMARY KEY,
    rfq_number      TEXT        NOT NULL,           -- Samsung RFQ number
    req_no          TEXT,                           -- Samsung REQ_NO
    submission_date DATE        NOT NULL,
    deadline        DATE,
    customer_id     BIGINT      REFERENCES customers(id),
    vendor_name     TEXT,                           -- Tên vendor (Song Châu)
    vendor_tax_code TEXT,
    vendor_address  TEXT,
    status          quotation_status NOT NULL DEFAULT 'draft',
    items_count     SMALLINT,
    pdf_path        TEXT,                           -- Path file RFQ PDF gốc
    excel_cam_ket   TEXT,                           -- Path file Excel CAM KẾT output
    excel_commercial TEXT,                          -- Path file Commercial output
    workflow_id     BIGINT      REFERENCES workflow_instances(id),
    submitted_by    UUID        REFERENCES users(id),
    approved_by     UUID        REFERENCES users(id),
    submitted_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE bqms_rfq_submissions IS 'Báo giá BQMS đã submit — output từ Auto-fill Tool 1';

-- 6D. BQMS Quotation Line Items — Source: Samsung Quotation Template (BG MAU)
CREATE TABLE bqms_quotation_items (
    id              BIGSERIAL   PRIMARY KEY,
    submission_id   BIGINT      NOT NULL REFERENCES bqms_rfq_submissions(id) ON DELETE CASCADE,
    line_number     SMALLINT    NOT NULL,
    product_id      BIGINT      REFERENCES products(id),
    bqms_code       TEXT,
    specification   TEXT,
    -- Material breakdown
    material_type   TEXT,                           -- Material type
    material_spec   TEXT,                           -- Material specification
    material_qty    NUMERIC(12,3),
    material_unit_price NUMERIC(15,4),
    -- Process costs (Drilling, Lathe, Grinding, Laser, etc.)
    process_costs   JSONB       DEFAULT '{}',       -- {"drilling": 1500, "lathe": 3000, ...}
    quantity        NUMERIC(12,3) NOT NULL,
    unit            TEXT        DEFAULT 'EA',
    unit_price      NUMERIC(15,4) NOT NULL,
    currency        currency_code NOT NULL DEFAULT 'VND',
    amount          NUMERIC(15,2),
    notes           TEXT
);
COMMENT ON TABLE bqms_quotation_items IS 'Chi tiết dòng báo giá BQMS — material breakdown + process costs';

-- 6E. BQMS Đặt Hàng (Orders) — Source: file 3 (~200 rows)
CREATE TABLE bqms_orders (
    id              BIGSERIAL   PRIMARY KEY,
    rfq_id          BIGINT      REFERENCES bqms_rfq(id),
    rfq_number      TEXT,                           -- RFQ No.
    product_id      BIGINT      REFERENCES products(id),
    bqms_code       TEXT,                           -- BQMS code
    specification   TEXT,                           -- Spec
    customer_id     BIGINT      REFERENCES customers(id),
    customer_name   TEXT,                           -- Khách hàng (denorm)
    expected_qty    NUMERIC(12,3),                  -- Số lượng dự kiến
    order_qty       NUMERIC(12,3),                  -- SL đặt hàng
    unit            TEXT        DEFAULT 'EA',       -- ĐVT
    order_date      DATE,                           -- Ngày đặt hàng
    validity_date   DATE,                           -- Thời hạn hiệu lực
    status          TEXT        NOT NULL DEFAULT 'pending', -- Trạng thái
    delivered_qty   NUMERIC(12,3) DEFAULT 0,        -- SL giao
    delivery_date   DATE,                           -- Ngày giao
    notes           TEXT,                           -- Ghi chú
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE bqms_orders IS 'BQMS Đặt Hàng — Source: file BQMS Đặt Hàng (~200 rows)';

-- 6F. Samsung PO from portal — Source: file 11 (~666 rows)
-- Direct Samsung PO data with all portal fields
CREATE TABLE bqms_samsung_po (
    id              BIGSERIAL   PRIMARY KEY,
    po_date         DATE,                           -- P/O Date
    po_number       TEXT        NOT NULL UNIQUE,    -- P/O No (e.g. 2112307188)
    po_seq          TEXT,                           -- P/O Seq
    request_no      TEXT,                           -- Request No (RFQ)
    request_seq     TEXT,                           -- Request Seq
    process_status  samsung_po_process_status DEFAULT 'new',
    confirm_status  TEXT,                           -- Confirm/Unconfirm
    pcr_flag        TEXT,                           -- PCR Flag
    close_po        BOOLEAN     DEFAULT false,      -- CLOSE P/O
    vendor_code     TEXT,                           -- Vendor
    buyer_name      TEXT,                           -- Buyer
    buyer_email     TEXT,
    company         TEXT,                           -- Company (SEV/SEVT)
    plant           TEXT,                           -- Plant
    product_id      BIGINT      REFERENCES products(id),
    specification   TEXT,                           -- Spec
    maker           TEXT,                           -- Maker
    part_no         TEXT,                           -- Part No
    bqms_code       TEXT,                           -- BQMS Code
    old_item_code   TEXT,                           -- Old Item Code
    cis_code        TEXT,                           -- CIS Code
    category        TEXT,                           -- Category
    order_qty       NUMERIC(12,3),                  -- Order Qty
    unit_price      NUMERIC(15,4),                  -- Unit Price
    amount          NUMERIC(15,2),                  -- Amount
    currency        currency_code DEFAULT 'VND',    -- Currency
    recipient_name  TEXT,                           -- Recipient
    delivery_address TEXT,                          -- Address
    preferred_delivery_date DATE,                   -- Delivery preferred date
    shipping_qty    NUMERIC(12,3),                  -- Shipping Qty
    gr_qty          NUMERIC(12,3),                  -- GR Qty (Goods Receipt)
    invoice_qty     NUMERIC(12,3),                  -- Invoice Qty
    remark          TEXT,                           -- Remark
    shipping_type   TEXT,                           -- Shipping Type
    raw_data        JSONB,                          -- Full portal data
    synced_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE bqms_samsung_po IS 'PO từ Samsung portal — Source: file BQMS PO (~666 rows), sync nightly';

-- 6G. BQMS Giao Hàng (Deliveries) — Source: file 2 (~6300 rows, 2023-2026)
CREATE TABLE bqms_deliveries (
    id              BIGSERIAL   PRIMARY KEY,
    samsung_po_id   BIGINT      REFERENCES bqms_samsung_po(id),
    po_date         DATE,                           -- Ngày PO
    po_number       TEXT,                           -- Số PO (e.g. 2112584477)
    shipping_no     TEXT,                           -- Shipping No (e.g. 3015880288)
    quotation_no    TEXT,                           -- Số QT
    product_id      BIGINT      REFERENCES products(id),
    bqms_code       TEXT,                           -- BQMS code
    specification   TEXT,                           -- Spec
    quantity        NUMERIC(12,3),                  -- SL
    unit            TEXT        DEFAULT 'EA',       -- Đơn vị
    unit_price      NUMERIC(15,4),                  -- Đơn giá
    amount          NUMERIC(15,2),                  -- Thành tiền
    sev_type        TEXT,                           -- SEV/T (SEV or SEVT)
    buyer_email     TEXT,                           -- MAIL PUR
    recipient_name  TEXT,                           -- TÊN NGƯỜI NHẬN
    receiving_warehouse TEXT,                       -- KHO NHẬN
    buyer_phone     TEXT,                           -- SĐT PUR
    delivery_status delivery_status NOT NULL DEFAULT 'chua_giao', -- TÌNH TRẠNG
    delivery_date   DATE,                           -- NGÀY GIAO HÀNG
    actual_delivered_qty NUMERIC(12,3),             -- SL GIAO THỰC TẾ
    delivery_info   TEXT,                           -- THÔNG TIN GIAO HÀNG
    delivery_method TEXT,                           -- CÁCH THỨC GIAO HÀNG
    country_origin  TEXT,                           -- XUẤT XỨ
    total_delivered_value_vnd NUMERIC(15,2),        -- TỔNG GIÁ TRỊ ĐÃ GIAO (VND)
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE bqms_deliveries IS 'BQMS Giao Hàng — Source: file Giao Hàng 2023-2026 (~6300 rows)';

-- 6H. BQMS PO Tháng (Monthly PO summary) — Source: sheet "PO Tháng" in file 2
CREATE TABLE bqms_monthly_po_summary (
    id              BIGSERIAL   PRIMARY KEY,
    month_year      DATE        NOT NULL,           -- First day of month
    order_count     INTEGER,                        -- Số lượng PO
    total_amount    NUMERIC(15,2),                  -- Tổng giá trị
    currency        currency_code DEFAULT 'VND',
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE bqms_monthly_po_summary IS 'Tổng hợp PO theo tháng — Source: sheet PO Tháng';

-- 6I. Theo dõi PO phôi (Raw Material PO Tracking) — Source: file 4 (~560 rows)
CREATE TABLE bqms_raw_material_po (
    id              BIGSERIAL   PRIMARY KEY,
    po_date         DATE,                           -- Ngày PO
    po_number       TEXT,                           -- Số PO
    product_id      BIGINT      REFERENCES products(id),
    bqms_code       TEXT,                           -- BQMS code
    specification   TEXT,                           -- Spec
    po_qty          NUMERIC(12,3),                  -- SL PO
    unit            TEXT        DEFAULT 'EA',       -- Đơn vị
    in_stock        BOOLEAN     DEFAULT false,      -- HÀNG SẴN
    remaining_qty   NUMERIC(12,3) DEFAULT 0,        -- SL CÒN THIẾU
    delivered_qty   NUMERIC(12,3) DEFAULT 0,        -- SL ĐÃ GIAO
    pending         BOOLEAN     DEFAULT true,       -- PENDING
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE bqms_raw_material_po IS 'Theo dõi PO phôi — Source: file THEO DOI PO PHOI (~560 rows)';

-- 6J. Gia công (Manufacturing schedule) — Source: file 5 (~230 rows)
-- Complex calendar layout: BQMS code + daily delivery quantities
CREATE TABLE bqms_manufacturing_schedule (
    id              BIGSERIAL   PRIMARY KEY,
    product_id      BIGINT      REFERENCES products(id),
    bqms_code       TEXT,                           -- BQMS code
    specification   TEXT,                           -- Spec
    total_qty       NUMERIC(12,3),                  -- Tổng SL
    schedule_month  DATE,                           -- Tháng (first day)
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE bqms_manufacturing_schedule IS 'Lịch gia công tổng — Source: file Gia cong (~230 rows)';

-- Daily delivery entries for manufacturing schedule
CREATE TABLE bqms_manufacturing_daily (
    id              BIGSERIAL   PRIMARY KEY,
    schedule_id     BIGINT      NOT NULL REFERENCES bqms_manufacturing_schedule(id) ON DELETE CASCADE,
    delivery_date   DATE        NOT NULL,           -- Ngày giao
    quantity        NUMERIC(12,3) NOT NULL DEFAULT 0, -- SL giao trong ngày
    notes           TEXT
);
COMMENT ON TABLE bqms_manufacturing_daily IS 'Chi tiết giao hàng gia công theo ngày — pivot từ calendar layout';

-- 6K. Kết quả phôi trượt (Material Pricing Results) — Source: file 6 (~80 rows)
CREATE TABLE bqms_material_pricing (
    id              BIGSERIAL   PRIMARY KEY,
    rfq_number      TEXT,                           -- RFQ No.
    product_id      BIGINT      REFERENCES products(id),
    bqms_code       TEXT,                           -- BQMS code
    specification   TEXT,                           -- Spec
    unit_price_vnd  NUMERIC(15,2),                  -- Đơn giá (VND)
    weight_kg       NUMERIC(10,4),                  -- Trọng lượng (KG)
    dimension_l     NUMERIC(10,3),                  -- L (mm)
    dimension_w     NUMERIC(10,3),                  -- W (mm)
    dimension_h     NUMERIC(10,3),                  -- H (mm)
    material_type   TEXT,                           -- Type (PB108, etc.)
    density_g_m3    NUMERIC(10,4),                  -- gr/m3
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE bqms_material_pricing IS 'Kết quả phôi trượt — Source: file KET QUA PHOI TRUOT (~80 rows)';

-- 6L. BQMS Records — PO sync from Samsung API (nightly job)
CREATE TABLE bqms_records (
    id              BIGSERIAL   PRIMARY KEY,
    po_no           TEXT        NOT NULL UNIQUE,    -- Samsung PO number
    req_no          TEXT,
    rfq_submission_id BIGINT    REFERENCES bqms_rfq_submissions(id),
    item_code       TEXT,
    specification   TEXT,
    manufacturer    TEXT,
    receiver_name   TEXT,                           -- Từ Samsung API
    req_delivery_date DATE,
    po_qty          INTEGER,
    secure_key      TEXT,                           -- Để download PDF
    pdf_path        TEXT,
    raw_data        JSONB,                          -- Toàn bộ 60 fields từ Samsung API
    sync_status     TEXT        NOT NULL DEFAULT 'pending', -- pending, processed, error
    synced_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at    TIMESTAMPTZ
);
COMMENT ON TABLE bqms_records IS 'PO records synced from Samsung BQMS API — nightly Celery job';

-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │  7. IMV MODULE (iMarket Vietnam) — Files 8, 9, 10                       │
-- └──────────────────────────────────────────────────────────────────────────┘

-- 7A. IMV Hỏi Hàng (Inquiry Statistics) — Source: file 9 (~31,500 rows)
CREATE TABLE imv_inquiries (
    id              BIGSERIAL   PRIMARY KEY,
    customer_name   TEXT,                           -- Tên KH
    person_in_charge UUID      REFERENCES users(id), -- Ng phụ trách
    person_in_charge_name TEXT,                     -- Tên NV (for legacy)
    model           TEXT,                           -- Model
    product_name    TEXT,                           -- Tên sp
    product_id      BIGINT      REFERENCES products(id),
    maker           TEXT,                           -- Maker
    inquiry_date    DATE,                           -- Ngày hỏi giá
    -- Multi-currency purchase prices
    purchase_price  NUMERIC(15,4),                  -- Giá nhập (value)
    purchase_currency currency_code,                -- Giá nhập (currency: YEN/USD/WON/RMB/VND)
    selling_price   NUMERIC(15,4),                  -- Giá bán
    quantity        NUMERIC(12,3),                  -- Số lượng
    tax_rate        NUMERIC(5,2),                   -- Thuế xuất (%)
    hs_code         TEXT,                           -- HS Code
    weight_kg       NUMERIC(10,4),                  -- Cân nặng
    coefficient     NUMERIC(10,4),                  -- Hệ số
    supplier_id     BIGINT      REFERENCES suppliers(id),
    supplier_name   TEXT,                           -- NCC (denormalized)
    exchange_rate   NUMERIC(15,4),                  -- Tỷ giá tại thời điểm
    image_path      TEXT,                           -- Hình ảnh
    notes           TEXT,                           -- Ghi chú
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE imv_inquiries IS 'IMV hỏi hàng — Source: file IMV Thống kê hỏi hàng (~31,500 rows)';

-- 7B. IMV Tổng hợp (Consolidated Quotation/PO Overview) — Source: file 10 (~7500 rows)
CREATE TABLE imv_consolidated (
    id              BIGSERIAL   PRIMARY KEY,
    quotation_no    TEXT,                           -- Báo Giá Số
    status          TEXT,                           -- Trạng Thái
    purchaser_name  TEXT,                           -- Người Phụ Trách Mua Hàng
    purchaser_id    UUID        REFERENCES users(id),
    customer_id     BIGINT      REFERENCES customers(id),
    customer_name   TEXT,                           -- Khách Hàng (denorm)
    customer_branch TEXT,                           -- Cơ Sở Khách Hàng
    customer_item_code TEXT,                        -- Mã Hàng Khách Hàng
    product_id      BIGINT      REFERENCES products(id),
    product_code    TEXT,                           -- Mã Hàng
    rfq_number      TEXT,                           -- Báo Giá Yêu Cầu Số
    product_name    TEXT,                           -- Tên Sản Phẩm
    model           TEXT,                           -- Kiểu Mẫu
    specification   TEXT,                           -- Quy Cách
    maker           TEXT,                           -- Nhà Sản Xuất
    unit            TEXT        DEFAULT 'EA',       -- ĐVT
    expected_order_qty NUMERIC(12,3),               -- Số Lượng Đặt Hàng Dự Kiến
    prev_year_po_count INTEGER,                     -- Số PO Năm Trước
    request_date    DATE,                           -- Ngày Lên YCBG
    quote_deadline  DATE,                           -- Hạn BG
    end_date        DATE,                           -- Thời Gian Kết Thúc
    moq             NUMERIC(12,3),                  -- MOQ (Minimum Order Quantity)
    sales_person_name TEXT,                         -- Người phụ trách (sales side)
    sales_person_id UUID       REFERENCES users(id),
    quoted_price    NUMERIC(15,4),                  -- Đơn giá báo
    purchase_price  NUMERIC(15,4),                  -- Đơn giá nhập
    price_diff      NUMERIC(15,4),                  -- Chênh lệch
    po_status       TEXT,                           -- Trạng thái P/O
    po_qty          NUMERIC(12,3),                  -- SL P/O
    po_amount       NUMERIC(15,2),                  -- Thành tiền P/O
    profit          NUMERIC(15,2),                  -- Lợi nhuận
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE imv_consolidated IS 'IMV Tổng hợp báo giá/PO — Source: file IMV Tổng hợp (~7500 rows)';

-- 7C. IMV PO (Purchase Orders from iMarket) — Source: file 8 (~500 rows)
CREATE TABLE imv_purchase_orders (
    id              BIGSERIAL   PRIMARY KEY,
    po_date         DATE,                           -- Ngày PO
    po_number       TEXT        NOT NULL,           -- Số PO (e.g. 1000394337)
    product_id      BIGINT      REFERENCES products(id),
    product_code    TEXT,                           -- Mã hàng (e.g. 1043874600)
    product_name    TEXT,                           -- Tên hàng
    unit            TEXT        DEFAULT 'EA',       -- ĐVT
    requested_qty   NUMERIC(12,3),                  -- SL YC
    unit_price      NUMERIC(15,4),                  -- Đơn giá (selling)
    amount          NUMERIC(15,2),                  -- Thành tiền
    vat_amount      NUMERIC(15,2),                  -- VAT
    total_amount    NUMERIC(15,2),                  -- Tổng
    purchasing_dept TEXT,                           -- Đơn vị mua hàng
    -- Delivery tracking
    delivered_qty   NUMERIC(12,3) DEFAULT 0,        -- SL đã giao
    actual_delivery_date DATE,                      -- Ngày giao thực tế
    invoice_date    DATE,                           -- Ngày xuất hóa đơn
    remaining_qty   NUMERIC(12,3) DEFAULT 0,        -- Còn thiếu
    -- Buying side (Song Châu's purchase from NCC)
    buying_qty      NUMERIC(12,3),                  -- SL mua
    buying_unit_price NUMERIC(15,4),                -- ĐG (buying price from NCC)
    buying_exchange_rate NUMERIC(15,4),             -- Tỷ giá
    buying_price_vnd NUMERIC(15,2),                 -- Đơn giá VND
    buying_amount   NUMERIC(15,2),                  -- Thành tiền mua
    shipping_cost   NUMERIC(15,2),                  -- Chi phí VC
    buying_total    NUMERIC(15,2),                  -- Tổng mua
    paid_amount     NUMERIC(15,2) DEFAULT 0,        -- Đã thanh toán
    outstanding     NUMERIC(15,2) DEFAULT 0,        -- Nợ
    supplier_id     BIGINT      REFERENCES suppliers(id),
    supplier_name   TEXT,                           -- NCC (denorm)
    document_ref    TEXT,                           -- Chứng từ
    notes           TEXT,                           -- Ghi chú
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE imv_purchase_orders IS 'IMV PO — Source: file IMV PO (~500 rows), selling + buying side';

-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │  8. IMPORT/EXPORT TRACKING — File 7                                      │
-- └──────────────────────────────────────────────────────────────────────────┘

-- TT XNK (Import/Export) — Source: file 7 (~6400 rows/year)
CREATE TABLE import_export_tracking (
    id              BIGSERIAL   PRIMARY KEY,
    tracking_date   DATE,                           -- Ngày Tháng
    rfq_number      TEXT,                           -- Đơn hàng (RFQ No)
    product_id      BIGINT      REFERENCES products(id),
    bqms_code       TEXT,                           -- BMSQ / BQMS code
    product_name    TEXT,                           -- Tên hàng hóa
    detail_explain  TEXT,                           -- Explain for detail
    goods_type      goods_type,                     -- Gia công / Thương mại
    maker           TEXT,                           -- Maker 업체
    unit_calc       TEXT,                           -- Đơn vị tính
    quantity_calc   NUMERIC(12,3),                  -- Số lượng (for calculation)
    quote_deadline  DATE,                           -- Quote Deadline
    transaction_date DATE,                          -- Ngày GD (giao dịch)
    -- Customs declaration
    customs_description TEXT,                       -- Miêu tả hàng hóa
    hs_code         TEXT,                           -- Mã HS
    unit            TEXT,                           -- ĐVT
    quantity        NUMERIC(12,3),                  -- SL
    total_usd       NUMERIC(15,2),                  -- Tổng cộng USD
    unit_price_usd  NUMERIC(15,4),                  -- Đơn giá USD
    unit_price_vnd  NUMERIC(15,2),                  -- Đơn giá VND
    buyer_name      TEXT,                           -- Bên mua
    seller_name     TEXT,                           -- Bên bán
    purchased_qty   NUMERIC(12,3),                  -- SL Đã mua
    alt_supplier    TEXT,                           -- Nhà cung cấp khác
    notes           TEXT,                           -- Ghi chú
    year            SMALLINT,                       -- Năm (partition key)
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE import_export_tracking IS 'Theo dõi XNK — Source: file TT XNK (~6400 rows/năm)';

-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │  9. INTERNAL PURCHASE ORDERS (Song Châu → NCC)                           │
-- └──────────────────────────────────────────────────────────────────────────┘

CREATE SEQUENCE po_number_seq START 1;

-- Purchase Orders — Song Châu's internal PO to suppliers
CREATE TABLE purchase_orders (
    id              BIGSERIAL   PRIMARY KEY,
    po_number       TEXT        NOT NULL UNIQUE,    -- Auto: PO-2026-0001
    supplier_id     BIGINT      NOT NULL REFERENCES suppliers(id),
    customer_id     BIGINT      REFERENCES customers(id),  -- Khách hàng đặt (if applicable)
    workflow_id     BIGINT      REFERENCES workflow_instances(id),
    status          po_status   NOT NULL DEFAULT 'draft',
    -- Financial
    subtotal        NUMERIC(15,2) NOT NULL DEFAULT 0,
    tax_amount      NUMERIC(15,2) NOT NULL DEFAULT 0,
    shipping_cost   NUMERIC(15,2) NOT NULL DEFAULT 0,
    total_amount    NUMERIC(15,2) NOT NULL DEFAULT 0,
    currency        currency_code NOT NULL DEFAULT 'USD',
    exchange_rate   NUMERIC(15,4),                  -- Tỷ giá tại thời điểm tạo PO
    amount_vnd      NUMERIC(18,0) GENERATED ALWAYS AS
                    (total_amount * COALESCE(exchange_rate, 1)) STORED,
    -- Dates
    order_date      DATE,
    expected_date   DATE,
    confirmed_date  DATE,
    received_date   DATE,
    -- Delivery
    incoterms       TEXT,                           -- 'FOB', 'CIF', 'EXW'
    shipping_method TEXT,
    tracking_number TEXT,
    -- Files
    attachment_path TEXT,
    -- Meta
    notes           TEXT,
    internal_note   TEXT,
    business_system business_system,                -- bqms / imv
    created_by      UUID        NOT NULL REFERENCES users(id),
    approved_by     UUID        REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE purchase_orders IS 'PO nội bộ Song Châu gửi NCC — tạo thủ công hoặc từ BQMS/IMV flow';

-- PO Line Items
CREATE TABLE po_line_items (
    id              BIGSERIAL   PRIMARY KEY,
    po_id           BIGINT      NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    line_number     SMALLINT    NOT NULL,
    product_id      BIGINT      REFERENCES products(id),
    product_code    TEXT,
    product_name    TEXT        NOT NULL,
    specification   TEXT,
    maker           TEXT,
    quantity        NUMERIC(12,3) NOT NULL,
    unit            TEXT        NOT NULL DEFAULT 'EA',
    unit_price      NUMERIC(15,4) NOT NULL,
    subtotal        NUMERIC(15,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
    currency        currency_code NOT NULL DEFAULT 'USD',
    notes           TEXT
);
COMMENT ON TABLE po_line_items IS 'Chi tiết dòng PO — sản phẩm, SL, đơn giá';

-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │  10. RFQ (Internal Request for Quotation)                                │
-- └──────────────────────────────────────────────────────────────────────────┘

CREATE TABLE rfq_requests (
    id              BIGSERIAL   PRIMARY KEY,
    rfq_number      TEXT        NOT NULL UNIQUE,    -- Auto: RFQ-2026-0001
    title           TEXT        NOT NULL,
    description     TEXT,
    deadline        DATE        NOT NULL,
    status          TEXT        NOT NULL DEFAULT 'draft', -- draft, sent, received, selected, cancelled
    business_system business_system,
    created_by      UUID        NOT NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE rfq_requests IS 'Yêu cầu báo giá nội bộ — gửi đến nhiều NCC để so sánh';

CREATE TABLE rfq_line_items (
    id              BIGSERIAL   PRIMARY KEY,
    rfq_id          BIGINT      NOT NULL REFERENCES rfq_requests(id) ON DELETE CASCADE,
    product_id      BIGINT      REFERENCES products(id),
    product_code    TEXT,
    product_name    TEXT        NOT NULL,
    specification   TEXT,
    maker           TEXT,
    quantity        NUMERIC(12,3) NOT NULL,
    unit            TEXT        NOT NULL DEFAULT 'EA',
    notes           TEXT
);
COMMENT ON TABLE rfq_line_items IS 'Chi tiết dòng yêu cầu báo giá';

CREATE TABLE rfq_quotations (
    id              BIGSERIAL   PRIMARY KEY,
    rfq_id          BIGINT      NOT NULL REFERENCES rfq_requests(id),
    supplier_id     BIGINT      NOT NULL REFERENCES suppliers(id),
    unit_price      NUMERIC(15,4),
    currency        currency_code DEFAULT 'USD',
    lead_time_days  SMALLINT,
    validity_date   DATE,
    terms           TEXT,
    is_selected     BOOLEAN     NOT NULL DEFAULT false,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE rfq_quotations IS 'Báo giá từ NCC — so sánh để chọn NCC tốt nhất';

-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │  11. REVENUE / INVOICES — File 13                                        │
-- └──────────────────────────────────────────────────────────────────────────┘

-- Doanh thu (Revenue) — Source: file 13 (monthly sheets)
CREATE TABLE revenue_invoices (
    id              BIGSERIAL   PRIMARY KEY,
    invoice_number  TEXT,                           -- Số hóa đơn
    invoice_date    DATE,                           -- Ngày hóa đơn
    invoice_month   SMALLINT,                       -- Tháng (for quick filter)
    invoice_year    SMALLINT,                       -- Năm
    customer_id     BIGINT      REFERENCES customers(id),
    customer_name   TEXT,                           -- Tên KH (denorm)
    product_id      BIGINT      REFERENCES products(id),
    product_name    TEXT,                           -- Tên hàng
    unit            TEXT        DEFAULT 'EA',       -- ĐVT
    quantity        NUMERIC(12,3),                  -- SL
    unit_price      NUMERIC(15,4),                  -- Đơn giá bán
    amount          NUMERIC(15,2),                  -- Thành tiền
    tax_rate        NUMERIC(5,2),                   -- Thuế suất (%)
    vat_amount      NUMERIC(15,2),                  -- Thuế GTGT
    total_amount    NUMERIC(15,2),                  -- Tổng (incl VAT)
    -- Related PO
    po_number       TEXT,                           -- Số PO
    -- Cost breakdown
    purchase_price  NUMERIC(15,4),                  -- Giá mua
    purchase_vat    NUMERIC(15,2),                  -- VAT mua
    shipping_cost   NUMERIC(15,2),                  -- Vận chuyển
    commission      NUMERIC(15,2),                  -- COM (hoa hồng)
    customer_quoted NUMERIC(15,4),                  -- KH gửi giá
    invoice_buying  NUMERIC(15,2),                  -- Mua HĐ
    customs_fee     NUMERIC(15,2),                  -- Hải quan
    export_tax      NUMERIC(15,2),                  -- Thuế XK
    other_costs     NUMERIC(15,2),                  -- CP khác
    total_cost      NUMERIC(15,2),                  -- Tổng chi phí
    profit          NUMERIC(15,2),                  -- Lợi nhuận
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE revenue_invoices IS 'Doanh thu / Hóa đơn — Source: file Doanh thu (monthly sheets), P&L per item';

-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │  12. INVENTORY                                                           │
-- └──────────────────────────────────────────────────────────────────────────┘

-- Tồn kho realtime
CREATE TABLE inventory (
    id              BIGSERIAL   PRIMARY KEY,
    product_id      BIGINT      REFERENCES products(id),
    product_code    TEXT        NOT NULL UNIQUE,
    product_name    TEXT        NOT NULL,
    name_unaccent   TEXT GENERATED ALWAYS AS (unaccent(lower(product_name))) STORED,
    category        TEXT,
    brand           TEXT,
    specification   TEXT,
    unit            TEXT        NOT NULL DEFAULT 'EA',
    quantity        NUMERIC(12,3) NOT NULL DEFAULT 0,
    reserved_qty    NUMERIC(12,3) NOT NULL DEFAULT 0,  -- Đã cam kết giao
    available_qty   NUMERIC(12,3) GENERATED ALWAYS AS (quantity - reserved_qty) STORED,
    min_stock       NUMERIC(12,3) NOT NULL DEFAULT 0,
    max_stock       NUMERIC(12,3),
    location        TEXT,                           -- Vị trí kho
    unit_cost       NUMERIC(15,4),                  -- Giá nhập bình quân
    last_updated    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    notes           TEXT
);
COMMENT ON TABLE inventory IS 'Tồn kho realtime — cập nhật qua inventory_movements';

-- Lịch sử xuất/nhập kho
CREATE TABLE inventory_movements (
    id              BIGSERIAL   PRIMARY KEY,
    product_code    TEXT        NOT NULL,
    movement_type   TEXT        NOT NULL,           -- 'in', 'out', 'adjust'
    quantity        NUMERIC(12,3) NOT NULL,
    reference_type  TEXT,                           -- 'po', 'sale', 'bqms_delivery', 'adjustment'
    reference_id    BIGINT,
    before_qty      NUMERIC(12,3) NOT NULL,
    after_qty       NUMERIC(12,3) NOT NULL,
    unit_cost       NUMERIC(15,4),
    notes           TEXT,
    created_by      UUID        NOT NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE inventory_movements IS 'Lịch sử xuất/nhập/điều chỉnh kho — immutable audit trail';

-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │  13. PRICE HISTORY                                                       │
-- └──────────────────────────────────────────────────────────────────────────┘

-- Lịch sử giá NCC — để so sánh, trend, dự đoán
CREATE TABLE price_history (
    id              BIGSERIAL   PRIMARY KEY,
    product_id      BIGINT      REFERENCES products(id),
    product_code    TEXT        NOT NULL,
    supplier_id     BIGINT      NOT NULL REFERENCES suppliers(id),
    unit_price      NUMERIC(15,4) NOT NULL,
    currency        currency_code NOT NULL DEFAULT 'USD',
    quantity        NUMERIC(12,3),
    exchange_rate   NUMERIC(15,4),                  -- Tỷ giá lúc ghi nhận
    price_vnd       NUMERIC(15,2),                  -- Quy đổi VND
    po_id           BIGINT      REFERENCES purchase_orders(id),
    source          TEXT,                           -- 'bqms', 'imv', 'manual'
    recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE price_history IS 'Lịch sử giá NCC — so sánh, trend analysis, hỗ trợ báo giá';

-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │  14. SUPPORT TABLES — Notifications, Audit, Files, ETL                   │
-- └──────────────────────────────────────────────────────────────────────────┘

-- Thông báo trong hệ thống
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
COMMENT ON TABLE notifications IS 'Thông báo hệ thống — workflow, deadline, stock alert, BQMS';

-- Audit log — immutable, KHÔNG sửa/xóa bao giờ
CREATE TABLE audit_log (
    id              BIGSERIAL   PRIMARY KEY,
    user_id         UUID        REFERENCES users(id),
    user_email      TEXT,                           -- Denormalized cho immutability
    action          TEXT        NOT NULL,           -- 'CREATE', 'UPDATE', 'DELETE', 'LOGIN'
    table_name      TEXT        NOT NULL,
    record_id       TEXT,
    old_data        JSONB,
    new_data        JSONB,
    ip_address      INET,
    user_agent      TEXT,
    request_id      TEXT,                           -- Correlation ID
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE audit_log IS 'Audit log — immutable, ghi lại mọi thay đổi dữ liệu';

-- File metadata — uploaded files (PDF, Excel, images)
CREATE TABLE file_meta (
    id              BIGSERIAL   PRIMARY KEY,
    filename        TEXT        NOT NULL,
    stored_filename TEXT        NOT NULL UNIQUE,    -- UUID-based filename
    file_path       TEXT        NOT NULL,
    mime_type       TEXT        NOT NULL,
    file_size       BIGINT      NOT NULL,           -- Bytes
    checksum        TEXT,                           -- SHA256
    ref_type        TEXT,                           -- Context: 'bqms_rfq', 'po', etc.
    ref_id          BIGINT,
    is_public       BOOLEAN     NOT NULL DEFAULT false,
    uploaded_by     UUID        NOT NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE file_meta IS 'Metadata file upload — PDF, Excel, hình ảnh sản phẩm';

-- ETL sync log — tracks OneDrive → DB synchronization
CREATE TABLE etl_sync_log (
    id              BIGSERIAL   PRIMARY KEY,
    sync_type       TEXT        NOT NULL,           -- 'onedrive_delta', 'bqms_po', 'bqms_rfq', 'excel_import'
    source_file     TEXT,                           -- Tên file Excel nguồn
    started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at    TIMESTAMPTZ,
    status          TEXT        NOT NULL DEFAULT 'running', -- running, success, error
    files_processed INTEGER     DEFAULT 0,
    rows_inserted   INTEGER     DEFAULT 0,
    rows_updated    INTEGER     DEFAULT 0,
    rows_skipped    INTEGER     DEFAULT 0,
    error_message   TEXT,
    delta_token     TEXT                            -- OneDrive delta token
);
COMMENT ON TABLE etl_sync_log IS 'Log ETL sync — theo dõi import từ OneDrive Excel / BQMS API';

-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │  15. MATERIALIZED VIEWS                                                  │
-- └──────────────────────────────────────────────────────────────────────────┘

-- KPI tổng hợp BQMS 30 ngày gần nhất
CREATE MATERIALIZED VIEW bqms_kpi AS
SELECT
    COUNT(*)                                            AS total_items,
    COUNT(*) FILTER (WHERE sync_status = 'processed')  AS processed,
    COUNT(DISTINCT manufacturer)                        AS maker_count,
    MAX(synced_at)                                      AS last_synced
FROM bqms_records
WHERE synced_at > NOW() - INTERVAL '30 days';

-- Revenue summary by month
CREATE MATERIALIZED VIEW mv_revenue_monthly AS
SELECT
    invoice_year,
    invoice_month,
    COUNT(*)                AS invoice_count,
    SUM(amount)             AS total_revenue,
    SUM(total_cost)         AS total_cost,
    SUM(profit)             AS total_profit,
    SUM(vat_amount)         AS total_vat
FROM revenue_invoices
GROUP BY invoice_year, invoice_month
ORDER BY invoice_year DESC, invoice_month DESC;

-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │  INDEXES                                                                 │
-- └──────────────────────────────────────────────────────────────────────────┘

-- Users
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role) WHERE is_active = true;

-- Workflow
CREATE INDEX idx_wf_assigned_pending ON workflow_instances(assigned_to, current_status)
    WHERE current_status IN ('pending_l1', 'pending_l2');
CREATE INDEX idx_wf_created_by ON workflow_instances(created_by, created_at DESC);
CREATE INDEX idx_wf_ref ON workflow_instances(ref_type, ref_id) WHERE ref_id IS NOT NULL;
CREATE INDEX idx_wf_history_instance ON workflow_history(instance_id, created_at DESC);

-- Exchange rates
CREATE INDEX idx_exrate_date ON exchange_rates(rate_date DESC, from_currency, to_currency);

-- Customers
CREATE INDEX idx_cust_name_trgm ON customers USING GIN(company_name_unaccent gin_trgm_ops);
CREATE INDEX idx_cust_system ON customers(business_system) WHERE is_active = true;

-- Customer contacts
CREATE INDEX idx_contact_customer ON customer_contacts(customer_id);
CREATE INDEX idx_contact_email ON customer_contacts(email) WHERE email IS NOT NULL;

-- Suppliers
CREATE INDEX idx_sup_name_trgm ON suppliers USING GIN(name_unaccent gin_trgm_ops);
CREATE INDEX idx_sup_active ON suppliers(country, is_active);

-- Products
CREATE INDEX idx_prod_bqms ON products(bqms_code) WHERE bqms_code IS NOT NULL;
CREATE INDEX idx_prod_imv ON products(imv_code) WHERE imv_code IS NOT NULL;
CREATE INDEX idx_prod_name_trgm ON products USING GIN(product_name_unaccent gin_trgm_ops);
CREATE INDEX idx_prod_maker ON products(maker) WHERE maker IS NOT NULL;
CREATE INDEX idx_prod_system ON products(business_system);

-- BQMS RFQ
CREATE INDEX idx_bqms_rfq_number ON bqms_rfq(rfq_number);
CREATE INDEX idx_bqms_rfq_bqms_code ON bqms_rfq(bqms_code);
CREATE INDEX idx_bqms_rfq_date ON bqms_rfq(inquiry_date DESC);
CREATE INDEX idx_bqms_rfq_result ON bqms_rfq(result) WHERE result = 'pending';
CREATE INDEX idx_bqms_rfq_person ON bqms_rfq(person_in_charge);

-- BQMS Samsung PO
CREATE INDEX idx_samsung_po_number ON bqms_samsung_po(po_number);
CREATE INDEX idx_samsung_po_bqms ON bqms_samsung_po(bqms_code);
CREATE INDEX idx_samsung_po_date ON bqms_samsung_po(po_date DESC);
CREATE INDEX idx_samsung_po_status ON bqms_samsung_po(process_status)
    WHERE process_status NOT IN ('closed');

-- BQMS Deliveries
CREATE INDEX idx_bqms_del_po ON bqms_deliveries(po_number);
CREATE INDEX idx_bqms_del_status ON bqms_deliveries(delivery_status)
    WHERE delivery_status IN ('chua_giao', 'dang_giao');
CREATE INDEX idx_bqms_del_date ON bqms_deliveries(delivery_date DESC);
CREATE INDEX idx_bqms_del_bqms ON bqms_deliveries(bqms_code);
CREATE INDEX idx_bqms_del_ship ON bqms_deliveries(shipping_no) WHERE shipping_no IS NOT NULL;

-- BQMS Raw Material PO
CREATE INDEX idx_bqms_rawmat_po ON bqms_raw_material_po(po_number);
CREATE INDEX idx_bqms_rawmat_pending ON bqms_raw_material_po(pending) WHERE pending = true;

-- BQMS Manufacturing
CREATE INDEX idx_bqms_mfg_code ON bqms_manufacturing_schedule(bqms_code);
CREATE INDEX idx_bqms_mfg_daily ON bqms_manufacturing_daily(schedule_id, delivery_date);

-- BQMS Records (API sync)
CREATE INDEX idx_bqms_rec_delivery ON bqms_records(req_delivery_date);
CREATE INDEX idx_bqms_rec_sync ON bqms_records(sync_status, synced_at DESC);

-- IMV Inquiries
CREATE INDEX idx_imv_inq_date ON imv_inquiries(inquiry_date DESC);
CREATE INDEX idx_imv_inq_customer ON imv_inquiries(customer_name);
CREATE INDEX idx_imv_inq_maker ON imv_inquiries(maker) WHERE maker IS NOT NULL;
CREATE INDEX idx_imv_inq_person ON imv_inquiries(person_in_charge);

-- IMV Consolidated
CREATE INDEX idx_imv_cons_quotation ON imv_consolidated(quotation_no) WHERE quotation_no IS NOT NULL;
CREATE INDEX idx_imv_cons_customer ON imv_consolidated(customer_id);
CREATE INDEX idx_imv_cons_rfq ON imv_consolidated(rfq_number) WHERE rfq_number IS NOT NULL;
CREATE INDEX idx_imv_cons_status ON imv_consolidated(status);

-- IMV PO
CREATE INDEX idx_imv_po_number ON imv_purchase_orders(po_number);
CREATE INDEX idx_imv_po_date ON imv_purchase_orders(po_date DESC);
CREATE INDEX idx_imv_po_product ON imv_purchase_orders(product_code);

-- Import/Export
CREATE INDEX idx_xnk_date ON import_export_tracking(tracking_date DESC);
CREATE INDEX idx_xnk_rfq ON import_export_tracking(rfq_number) WHERE rfq_number IS NOT NULL;
CREATE INDEX idx_xnk_bqms ON import_export_tracking(bqms_code) WHERE bqms_code IS NOT NULL;
CREATE INDEX idx_xnk_type ON import_export_tracking(goods_type);
CREATE INDEX idx_xnk_year ON import_export_tracking(year);

-- Purchase Orders (internal)
CREATE INDEX idx_po_supplier_status ON purchase_orders(supplier_id, status, created_at DESC);
CREATE INDEX idx_po_status_date ON purchase_orders(status, expected_date)
    WHERE status NOT IN ('closed', 'cancelled');
CREATE INDEX idx_po_number ON purchase_orders(po_number);
CREATE INDEX idx_po_system ON purchase_orders(business_system);

-- Revenue
CREATE INDEX idx_rev_date ON revenue_invoices(invoice_date DESC);
CREATE INDEX idx_rev_month ON revenue_invoices(invoice_year, invoice_month);
CREATE INDEX idx_rev_customer ON revenue_invoices(customer_id);
CREATE INDEX idx_rev_invoice ON revenue_invoices(invoice_number) WHERE invoice_number IS NOT NULL;
CREATE INDEX idx_rev_po ON revenue_invoices(po_number) WHERE po_number IS NOT NULL;

-- Inventory
CREATE INDEX idx_inv_code ON inventory(product_code);
CREATE INDEX idx_inv_product ON inventory(product_id) WHERE product_id IS NOT NULL;
CREATE INDEX idx_inv_low_stock ON inventory(quantity) WHERE quantity <= min_stock;
CREATE INDEX idx_inv_name_trgm ON inventory USING GIN(name_unaccent gin_trgm_ops);

-- Inventory movements
CREATE INDEX idx_inv_mov_code ON inventory_movements(product_code, created_at DESC);
CREATE INDEX idx_inv_mov_ref ON inventory_movements(reference_type, reference_id);

-- Notifications
CREATE INDEX idx_notif_recipient_unread ON notifications(recipient_id, created_at DESC)
    WHERE is_read = false;

-- Audit log
CREATE INDEX idx_audit_user ON audit_log(user_id, created_at DESC);
CREATE INDEX idx_audit_table ON audit_log(table_name, created_at DESC);

-- Price history
CREATE INDEX idx_price_product ON price_history(product_code, recorded_at DESC);
CREATE INDEX idx_price_supplier ON price_history(supplier_id, recorded_at DESC);
CREATE INDEX idx_price_product_id ON price_history(product_id, recorded_at DESC) WHERE product_id IS NOT NULL;

-- ETL sync
CREATE INDEX idx_etl_type ON etl_sync_log(sync_type, started_at DESC);

-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │  ROW LEVEL SECURITY                                                      │
-- └──────────────────────────────────────────────────────────────────────────┘

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

-- Workflow: Admin/Manager/Accountant see all, others only their own
CREATE POLICY wf_access ON workflow_instances
    FOR ALL TO app_user
    USING (
        current_setting('app.current_role', true) IN ('admin', 'manager', 'accountant')
        OR created_by = current_setting('app.current_user_id', true)::uuid
        OR assigned_to = current_setting('app.current_user_id', true)::uuid
    );

-- PO: Procurement/Manager/Admin/Accountant see all, Warehouse limited
CREATE POLICY po_access ON purchase_orders
    FOR ALL TO app_user
    USING (
        current_setting('app.current_role', true) IN ('admin', 'manager', 'procurement', 'accountant')
        OR (
            current_setting('app.current_role', true) = 'warehouse'
            AND status IN ('in_transit', 'partial_received')
        )
    );

-- Notifications: only own
CREATE POLICY notif_own ON notifications
    FOR ALL TO app_user
    USING (recipient_id = current_setting('app.current_user_id', true)::uuid);

-- Files: public files for all, others only if they uploaded or have matching ref
CREATE POLICY file_access ON file_meta
    FOR ALL TO app_user
    USING (
        is_public = true
        OR uploaded_by = current_setting('app.current_user_id', true)::uuid
        OR current_setting('app.current_role', true) IN ('admin', 'manager')
    );

-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │  TRIGGERS                                                                │
-- └──────────────────────────────────────────────────────────────────────────┘

-- Auto-update updated_at timestamp
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
CREATE TRIGGER trg_products_updated_at BEFORE UPDATE ON products
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_customers_updated_at BEFORE UPDATE ON customers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_bqms_rfq_updated_at BEFORE UPDATE ON bqms_rfq
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_bqms_orders_updated_at BEFORE UPDATE ON bqms_orders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_bqms_del_updated_at BEFORE UPDATE ON bqms_deliveries
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_bqms_samsung_po_updated_at BEFORE UPDATE ON bqms_samsung_po
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_bqms_rawmat_updated_at BEFORE UPDATE ON bqms_raw_material_po
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_bqms_mfg_updated_at BEFORE UPDATE ON bqms_manufacturing_schedule
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_imv_cons_updated_at BEFORE UPDATE ON imv_consolidated
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_imv_po_updated_at BEFORE UPDATE ON imv_purchase_orders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_rev_updated_at BEFORE UPDATE ON revenue_invoices
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_xnk_updated_at BEFORE UPDATE ON import_export_tracking
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Workflow change notification (WebSocket realtime)
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
            'created_by',   NEW.created_by,
            'ref_type',     NEW.ref_type,
            'ref_id',       NEW.ref_id
        )::text
    );
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_wf_notify
    AFTER INSERT OR UPDATE OF current_status ON workflow_instances
    FOR EACH ROW EXECUTE FUNCTION notify_workflow_change();

-- Auto-generate PO number: PO-YYYY-NNNN
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

-- Audit log trigger — automatic recording of all data changes
CREATE OR REPLACE FUNCTION auto_audit_log()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO audit_log (user_id, user_email, action, table_name, record_id, old_data, new_data, ip_address)
    VALUES (
        NULLIF(current_setting('app.current_user_id', true), '')::uuid,
        current_setting('app.current_user_email', true),
        TG_OP,
        TG_TABLE_NAME,
        COALESCE(NEW.id::text, OLD.id::text),
        CASE TG_OP WHEN 'DELETE' THEN row_to_json(OLD)::jsonb
                    WHEN 'UPDATE' THEN row_to_json(OLD)::jsonb
                    ELSE NULL END,
        CASE TG_OP WHEN 'DELETE' THEN NULL ELSE row_to_json(NEW)::jsonb END,
        NULLIF(current_setting('app.client_ip', true), '')::inet
    );
    RETURN COALESCE(NEW, OLD);
END;
$$;

-- Audit triggers on critical tables
CREATE TRIGGER audit_purchase_orders AFTER INSERT OR UPDATE OR DELETE ON purchase_orders
    FOR EACH ROW EXECUTE FUNCTION auto_audit_log();
CREATE TRIGGER audit_workflow_instances AFTER INSERT OR UPDATE OR DELETE ON workflow_instances
    FOR EACH ROW EXECUTE FUNCTION auto_audit_log();
CREATE TRIGGER audit_inventory AFTER INSERT OR UPDATE OR DELETE ON inventory
    FOR EACH ROW EXECUTE FUNCTION auto_audit_log();
CREATE TRIGGER audit_bqms_rfq AFTER INSERT OR UPDATE OR DELETE ON bqms_rfq
    FOR EACH ROW EXECUTE FUNCTION auto_audit_log();
CREATE TRIGGER audit_bqms_samsung_po AFTER INSERT OR UPDATE OR DELETE ON bqms_samsung_po
    FOR EACH ROW EXECUTE FUNCTION auto_audit_log();
CREATE TRIGGER audit_bqms_deliveries AFTER INSERT OR UPDATE OR DELETE ON bqms_deliveries
    FOR EACH ROW EXECUTE FUNCTION auto_audit_log();
CREATE TRIGGER audit_revenue_invoices AFTER INSERT OR UPDATE OR DELETE ON revenue_invoices
    FOR EACH ROW EXECUTE FUNCTION auto_audit_log();
CREATE TRIGGER audit_products AFTER INSERT OR UPDATE OR DELETE ON products
    FOR EACH ROW EXECUTE FUNCTION auto_audit_log();

-- BQMS delivery status change notification
CREATE OR REPLACE FUNCTION notify_bqms_delivery_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.delivery_status IS DISTINCT FROM NEW.delivery_status THEN
        PERFORM pg_notify(
            'bqms_delivery_events',
            json_build_object(
                'id',           NEW.id,
                'po_number',    NEW.po_number,
                'bqms_code',    NEW.bqms_code,
                'old_status',   OLD.delivery_status,
                'new_status',   NEW.delivery_status,
                'delivery_date', NEW.delivery_date
            )::text
        );
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_bqms_delivery_notify
    AFTER UPDATE OF delivery_status ON bqms_deliveries
    FOR EACH ROW EXECUTE FUNCTION notify_bqms_delivery_change();

-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │  SEED DATA — Enums/Lookups                                               │
-- └──────────────────────────────────────────────────────────────────────────┘

-- Default admin user (Password: SongChau@2026, bcrypt hash)
INSERT INTO users (email, full_name, display_name, role, hashed_password)
VALUES (
    'thang@songchau.vn',
    'Nguyễn Đức Thắng',
    'Thắng',
    'admin',
    '$2b$12$LJ3m4ys5yVxVdTzS8WZ.7eGNfPbRKqRDXNwGJxYBhXpVDKFCymKnq'
);

-- Key customers
INSERT INTO customers (company_name, short_name, business_system) VALUES
    ('Samsung Electro-Mechanics Vietnam', 'SEV', 'bqms'),
    ('Samsung Electro-Mechanics Vietnam Thai Nguyen', 'SEVT', 'bqms'),
    ('iMarket Vietnam', 'IMV', 'imv');

-- Common material types from "Gia phoi" file
INSERT INTO material_types (type_code, type_name, notes) VALUES
    ('PB108',    'PB108 (Đồng phosphor)',       'Phôi đồng phosphor bronze'),
    ('ACETAL',   'Acetal (POM)',                 'Polyoxymethylene / Delrin'),
    ('PEEK',     'PEEK',                        'Polyether ether ketone'),
    ('SUS304',   'SUS304 (Inox 304)',           'Thép không gỉ 304'),
    ('SUS316',   'SUS316 (Inox 316)',           'Thép không gỉ 316'),
    ('AL6061',   'AL6061 (Nhôm 6061)',          'Nhôm hợp kim 6061'),
    ('AL7075',   'AL7075 (Nhôm 7075)',          'Nhôm hợp kim 7075'),
    ('S45C',     'S45C (Thép C45)',             'Thép carbon trung bình'),
    ('SCM440',   'SCM440 (Thép hợp kim)',       'Chromium-molybdenum steel'),
    ('MC_NYLON', 'MC Nylon',                    'Cast nylon / Polyamide'),
    ('TEFLON',   'Teflon (PTFE)',               'Polytetrafluoroethylene'),
    ('TUNGSTEN', 'Tungsten Carbide',            'Hợp kim cứng carbide');

-- Common exchange rate seed (recent)
INSERT INTO exchange_rates (rate_date, from_currency, to_currency, rate, source) VALUES
    ('2026-03-29', 'USD', 'VND', 25445.0000, 'manual'),
    ('2026-03-29', 'RMB', 'VND', 3495.0000, 'manual'),
    ('2026-03-29', 'KRW', 'VND', 18.5000, 'manual'),
    ('2026-03-29', 'JPY', 'VND', 168.0000, 'manual');

-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │  TABLE-TO-EXCEL MAPPING REFERENCE (for ETL pipeline)                     │
-- └──────────────────────────────────────────────────────────────────────────┘
--
-- File 1:  BQMS Hỏi Hàng        → bqms_rfq, bqms_won_quotations, products
-- File 2:  BQMS Giao Hàng        → bqms_deliveries, bqms_monthly_po_summary, customer_contacts
-- File 3:  BQMS Đặt Hàng         → bqms_orders
-- File 4:  THEO DOI PO PHOI      → bqms_raw_material_po
-- File 5:  Gia cong               → bqms_manufacturing_schedule, bqms_manufacturing_daily
-- File 6:  KET QUA PHOI TRUOT    → bqms_material_pricing
-- File 7:  TT XNK                → import_export_tracking, exchange_rates
-- File 8:  IMV PO                → imv_purchase_orders
-- File 9:  IMV Thống kê hỏi hàng → imv_inquiries
-- File 10: IMV Tổng hợp          → imv_consolidated
-- File 11: BQMS PO (Samsung)     → bqms_samsung_po
-- File 12: BG MAU (Template)     → bqms_rfq_submissions, bqms_quotation_items
-- File 13: Doanh thu             → revenue_invoices
-- File 14: DANH BẠ               → customer_contacts
-- File 15: Khách hàng lẻ         → customers, retail_customer_inquiries
-- File 16: Gia phoi              → material_types
-- File 17: Exchange Rates        → exchange_rates
--
-- ════════════════════════════════════════════════════════════════════════════
-- END OF SCHEMA
-- ════════════════════════════════════════════════════════════════════════════
