-- ============================================================
-- Migration: IMV Module v2 — orders, deliveries, payments,
--                            contracts, rejections
-- Date: 2026-04-29
-- Source endpoints discovered via recon:
--   S10.S1020020L = Kiểm tra thông tin hợp đồng (contracts)
--   S20.S2010010L = Hiện trạng đặt hàng (orders)
--   S20.S2020020L = Hiện trạng giao hàng (deliveries)
--   S30.S3020010L = Hiện trạng thanh toán (payments)
--   S40.S4010010L = Hiện trạng từ chối giao hàng (rejections)
-- ============================================================

BEGIN;

-- ─── ORDERS (S20.S2010010L) — 67 cells per row ──────────────
CREATE TABLE IF NOT EXISTS imv_orders (
  id                    BIGSERIAL PRIMARY KEY,
  status_text           VARCHAR(80),
  order_type            VARCHAR(80),
  order_date            DATE,
  delivery_due          DATE,
  po_number             VARCHAR(40),
  handler_name          VARCHAR(100),
  handler_login         VARCHAR(60),
  requester_name        VARCHAR(100),
  customer_name         VARCHAR(255),
  customer_facility     VARCHAR(255),
  item_code             VARCHAR(40),
  product_name          TEXT,
  spec                  TEXT,
  model                 VARCHAR(255),
  maker                 VARCHAR(255),
  unit                  VARCHAR(40),
  origin_country        VARCHAR(80),
  tax_label             VARCHAR(40),
  quantity              NUMERIC(18,4),
  currency              VARCHAR(8),
  unit_price            NUMERIC(18,4),
  amount                NUMERIC(18,4),
  delivery_address      VARCHAR(255),
  order_method          VARCHAR(60),
  po_internal_number    VARCHAR(40),
  raw_xml               TEXT,
  first_seen_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(po_internal_number, item_code)
);
CREATE INDEX IF NOT EXISTS idx_imv_orders_order_date ON imv_orders(order_date DESC);
CREATE INDEX IF NOT EXISTS idx_imv_orders_due        ON imv_orders(delivery_due);
CREATE INDEX IF NOT EXISTS idx_imv_orders_status     ON imv_orders(status_text);
CREATE INDEX IF NOT EXISTS idx_imv_orders_customer   ON imv_orders(customer_name);
CREATE INDEX IF NOT EXISTS idx_imv_orders_item       ON imv_orders(item_code);

-- ─── DELIVERIES (S20.S2020020L) — 63 cells per row ──────────
CREATE TABLE IF NOT EXISTS imv_deliveries (
  id                    BIGSERIAL PRIMARY KEY,
  delivery_type         VARCHAR(40),
  ship_to               VARCHAR(255),
  order_no_internal     VARCHAR(40),
  item_code             VARCHAR(40),
  product_name          TEXT,
  spec                  TEXT,
  due_date              DATE,
  shipped_date          DATE,
  confirmed_date        DATE,
  quantity              NUMERIC(18,4),
  confirmed_qty         NUMERIC(18,4),
  origin_country        VARCHAR(80),
  unit                  VARCHAR(40),
  customer_name         VARCHAR(255),
  customer_facility     VARCHAR(255),
  customer_dept         VARCHAR(255),
  po_number             VARCHAR(40),
  delivery_address      VARCHAR(500),
  status                VARCHAR(8),
  stage                 VARCHAR(40),
  stage2                VARCHAR(40),
  shipment_id           VARCHAR(40),
  supplier_name         VARCHAR(255),
  raw_xml               TEXT,
  first_seen_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(shipment_id, item_code)
);
CREATE INDEX IF NOT EXISTS idx_imv_del_due        ON imv_deliveries(due_date);
CREATE INDEX IF NOT EXISTS idx_imv_del_shipped    ON imv_deliveries(shipped_date DESC);
CREATE INDEX IF NOT EXISTS idx_imv_del_status     ON imv_deliveries(status);
CREATE INDEX IF NOT EXISTS idx_imv_del_customer   ON imv_deliveries(customer_name);
CREATE INDEX IF NOT EXISTS idx_imv_del_item       ON imv_deliveries(item_code);

-- ─── PAYMENTS (S30.S3020010L) — 55 cells per row ────────────
CREATE TABLE IF NOT EXISTS imv_payments (
  id                    BIGSERIAL PRIMARY KEY,
  payment_target        VARCHAR(80),
  paying_entity         VARCHAR(255),
  payment_method        VARCHAR(120),
  invoice_id            VARCHAR(40),
  invoice_date          DATE,
  order_no              VARCHAR(40),
  po_no                 VARCHAR(40),
  amount_id             VARCHAR(40),
  shipment_id           VARCHAR(40),
  item_code             VARCHAR(40),
  product_name          TEXT,
  model                 VARCHAR(255),
  quantity              NUMERIC(18,4),
  unit                  VARCHAR(40),
  currency              VARCHAR(8),
  unit_price            NUMERIC(18,4),
  total_amount          NUMERIC(18,4),
  tax_label             VARCHAR(40),
  customer_code         VARCHAR(40),
  customer_name         VARCHAR(255),
  customer_dept         VARCHAR(255),
  payment_type          VARCHAR(40),
  raw_xml               TEXT,
  first_seen_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(invoice_id, item_code)
);
CREATE INDEX IF NOT EXISTS idx_imv_pay_invoice_date ON imv_payments(invoice_date DESC);
CREATE INDEX IF NOT EXISTS idx_imv_pay_invoice_id   ON imv_payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_imv_pay_customer     ON imv_payments(customer_name);

-- ─── CONTRACTS (S10.S1020020L) — empty for us, generic schema
CREATE TABLE IF NOT EXISTS imv_contracts (
  id                    BIGSERIAL PRIMARY KEY,
  contract_id           VARCHAR(40),
  contract_date         DATE,
  customer_name         VARCHAR(255),
  customer_facility     VARCHAR(255),
  item_code             VARCHAR(40),
  product_name          TEXT,
  quantity              NUMERIC(18,4),
  unit                  VARCHAR(40),
  unit_price            NUMERIC(18,4),
  total_amount          NUMERIC(18,4),
  currency              VARCHAR(8),
  status_text           VARCHAR(120),
  rfq_number            VARCHAR(40),
  raw_xml               TEXT,
  first_seen_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(contract_id, item_code)
);
CREATE INDEX IF NOT EXISTS idx_imv_contract_date ON imv_contracts(contract_date DESC);

-- ─── REJECTIONS (S40.S4010010L) — empty for us, generic schema
CREATE TABLE IF NOT EXISTS imv_rejections (
  id                    BIGSERIAL PRIMARY KEY,
  rejection_id          VARCHAR(40),
  rejection_date        DATE,
  shipment_id           VARCHAR(40),
  customer_name         VARCHAR(255),
  item_code             VARCHAR(40),
  product_name          TEXT,
  quantity              NUMERIC(18,4),
  reason                TEXT,
  status_text           VARCHAR(120),
  raw_xml               TEXT,
  first_seen_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(rejection_id, item_code)
);
CREATE INDEX IF NOT EXISTS idx_imv_rej_date ON imv_rejections(rejection_date DESC);

-- ─── Extend sync log with entity_type column ───────────────
ALTER TABLE imv_sync_log
  ADD COLUMN IF NOT EXISTS entity_type VARCHAR(20) DEFAULT 'rfq';
CREATE INDEX IF NOT EXISTS idx_imv_sync_log_entity ON imv_sync_log(entity_type, started_at DESC);

COMMIT;

SELECT 'imv_orders cols'      AS info, COUNT(*) AS v FROM information_schema.columns WHERE table_name = 'imv_orders'
UNION ALL
SELECT 'imv_deliveries cols',  COUNT(*) FROM information_schema.columns WHERE table_name = 'imv_deliveries'
UNION ALL
SELECT 'imv_payments cols',    COUNT(*) FROM information_schema.columns WHERE table_name = 'imv_payments'
UNION ALL
SELECT 'imv_contracts cols',   COUNT(*) FROM information_schema.columns WHERE table_name = 'imv_contracts'
UNION ALL
SELECT 'imv_rejections cols',  COUNT(*) FROM information_schema.columns WHERE table_name = 'imv_rejections';
