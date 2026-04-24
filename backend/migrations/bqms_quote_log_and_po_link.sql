-- ============================================================
-- Migration: bqms_quote_log + po_rfq_link + item_type on rfq
-- Date: 2026-04-24
-- Purpose: Per-round audit trail (vòng 1/2/3) + win-back-trace PO→RFQ
-- ============================================================

BEGIN;

-- 1. item_type on bqms_rfq (TM = thương mại, GC = gia công)
ALTER TABLE bqms_rfq
  ADD COLUMN IF NOT EXISTS item_type VARCHAR(2)
    CHECK (item_type IN ('TM','GC'));

-- backfill from xnk_price_lookup by bqms_code when unambiguous
UPDATE bqms_rfq r SET item_type = sub.item_type
FROM (
  SELECT bqms_code, MODE() WITHIN GROUP (ORDER BY item_type) AS item_type
  FROM xnk_price_lookup
  WHERE item_type IN ('TM','GC')
  GROUP BY bqms_code
) sub
WHERE r.item_type IS NULL AND r.bqms_code = sub.bqms_code;

-- 2. bqms_quote_log — per-round audit
CREATE TABLE IF NOT EXISTS bqms_quote_log (
  id             BIGSERIAL PRIMARY KEY,
  rfq_id         INTEGER NOT NULL REFERENCES bqms_rfq(id) ON DELETE CASCADE,
  round          SMALLINT NOT NULL CHECK (round BETWEEN 1 AND 4),
  quoted_price   NUMERIC(14,4),
  quoted_currency VARCHAR(8) DEFAULT 'USD',
  item_type      VARCHAR(2) CHECK (item_type IN ('TM','GC')),
  quoted_by      UUID REFERENCES users(id),
  quoted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_qlog_rfq ON bqms_quote_log(rfq_id);
CREATE INDEX IF NOT EXISTS idx_qlog_quoted_at ON bqms_quote_log(quoted_at DESC);
CREATE INDEX IF NOT EXISTS idx_qlog_round ON bqms_quote_log(round, quoted_at DESC);
CREATE INDEX IF NOT EXISTS idx_qlog_by ON bqms_quote_log(quoted_by, quoted_at DESC);

-- 3. Link Samsung PO → RFQ for win-trace
ALTER TABLE bqms_samsung_po
  ADD COLUMN IF NOT EXISTS rfq_id INTEGER REFERENCES bqms_rfq(id),
  ADD COLUMN IF NOT EXISTS won_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS won_margin_pct NUMERIC(6,3);

CREATE INDEX IF NOT EXISTS idx_spo_rfq ON bqms_samsung_po(rfq_id);
CREATE INDEX IF NOT EXISTS idx_spo_won_by ON bqms_samsung_po(won_by);

-- Backfill: auto-link PO to latest RFQ for same bqms_code
UPDATE bqms_samsung_po po SET rfq_id = sub.rfq_id
FROM (
  SELECT DISTINCT ON (bqms_code) id AS rfq_id, bqms_code
  FROM bqms_rfq
  WHERE bqms_code IS NOT NULL
  ORDER BY bqms_code, inquiry_date DESC NULLS LAST, id DESC
) sub
WHERE po.rfq_id IS NULL AND po.bqms_code = sub.bqms_code;

-- Derive won_by from latest quote_log entry (once quote_log starts getting populated)
-- This UPDATE is safe to run repeatedly as more data accumulates.
UPDATE bqms_samsung_po po SET won_by = sub.quoted_by
FROM (
  SELECT DISTINCT ON (rfq_id) rfq_id, quoted_by
  FROM bqms_quote_log
  WHERE quoted_by IS NOT NULL
  ORDER BY rfq_id, quoted_at DESC
) sub
WHERE po.rfq_id = sub.rfq_id AND po.won_by IS NULL;

-- 4b. Extended customer intake fields (Khối C)
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS contact_name      VARCHAR(200),
  ADD COLUMN IF NOT EXISTS contact_role      VARCHAR(100),
  ADD COLUMN IF NOT EXISTS industry          VARCHAR(50),
  ADD COLUMN IF NOT EXISTS company_size      VARCHAR(50),
  ADD COLUMN IF NOT EXISTS lead_source       VARCHAR(50),
  ADD COLUMN IF NOT EXISTS preferred_channel VARCHAR(20),
  ADD COLUMN IF NOT EXISTS website           VARCHAR(255),
  ADD COLUMN IF NOT EXISTS notes             TEXT;

CREATE INDEX IF NOT EXISTS idx_customers_industry ON customers(industry) WHERE industry IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customers_lead_source ON customers(lead_source) WHERE lead_source IS NOT NULL;

-- 4. System config table (revenue cutoff + other runtime switches)
CREATE TABLE IF NOT EXISTS system_config (
  key   VARCHAR(100) PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES users(id),
  notes TEXT
);

INSERT INTO system_config (key, value, notes)
VALUES ('revenue_tracking_start_date', '2026-05-01',
        'Cutoff date for new revenue KPI; data before this is legacy (M30 quarterly)')
ON CONFLICT (key) DO NOTHING;

COMMIT;

-- Verify
SELECT 'quote_log rows' AS metric, COUNT(*) AS v FROM bqms_quote_log
UNION ALL
SELECT 'rfq with item_type', COUNT(*) FROM bqms_rfq WHERE item_type IS NOT NULL
UNION ALL
SELECT 'po linked to rfq', COUNT(*) FROM bqms_samsung_po WHERE rfq_id IS NOT NULL
UNION ALL
SELECT 'system_config keys', COUNT(*) FROM system_config;
