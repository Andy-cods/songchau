-- ============================================================
-- Migration: IMV Module — RFQ list + sync log
-- Date: 2026-04-28
-- Source: https://www.imvmall.com/mro (action.S10.S1020010L)
-- Supplier code in IMV: 30007266 (SONGCHAU2)
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS imv_rfq (
  id                    BIGSERIAL PRIMARY KEY,
  rfq_number            VARCHAR(40) NOT NULL,
  status_text           VARCHAR(80),
  handler_name          VARCHAR(100),
  handler_login         VARCHAR(60),
  customer_name         VARCHAR(255),
  customer_facility     VARCHAR(255),
  customer_item_code    VARCHAR(80),
  item_code             VARCHAR(40),
  product_name          TEXT,
  model                 VARCHAR(255),
  spec                  TEXT,
  maker                 VARCHAR(255),
  unit                  VARCHAR(40),
  quantity              NUMERIC(18,4),
  offered_qty           NUMERIC(18,4),
  request_date          DATE,
  due_date              DATE,
  due_time              VARCHAR(12),
  doc_type              VARCHAR(8),
  flow_status           VARCHAR(8),
  request_id            VARCHAR(40),
  item_code_internal    VARCHAR(40),
  requester_id          VARCHAR(40),
  raw_xml               TEXT,
  first_seen_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(rfq_number, item_code)
);

CREATE INDEX IF NOT EXISTS idx_imv_rfq_request_date ON imv_rfq(request_date DESC);
CREATE INDEX IF NOT EXISTS idx_imv_rfq_due_date     ON imv_rfq(due_date);
CREATE INDEX IF NOT EXISTS idx_imv_rfq_status       ON imv_rfq(flow_status);
CREATE INDEX IF NOT EXISTS idx_imv_rfq_customer     ON imv_rfq(customer_name);
CREATE INDEX IF NOT EXISTS idx_imv_rfq_item         ON imv_rfq(item_code);
CREATE INDEX IF NOT EXISTS idx_imv_rfq_handler      ON imv_rfq(handler_login);

CREATE TABLE IF NOT EXISTS imv_sync_log (
  id              BIGSERIAL PRIMARY KEY,
  status          VARCHAR(20) NOT NULL,         -- running | success | error
  total_records   INT,
  new_records     INT,
  updated_records INT,
  error_message   TEXT,
  duration_seconds NUMERIC(8,2),
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_imv_sync_log_started ON imv_sync_log(started_at DESC);

COMMIT;

SELECT 'imv_rfq columns' AS info, COUNT(*) AS v FROM information_schema.columns WHERE table_name = 'imv_rfq'
UNION ALL
SELECT 'imv_sync_log columns', COUNT(*) FROM information_schema.columns WHERE table_name = 'imv_sync_log';
