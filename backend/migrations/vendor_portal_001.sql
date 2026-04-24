-- Vendor Portal — Database Schema
-- Date: 2026-04-06
-- 7 tables for supplier bidding platform

-- 1. Add 'vendor' to role_enum if not exists
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'vendor' AND enumtypid = 'role_enum'::regtype) THEN
        ALTER TYPE role_enum ADD VALUE 'vendor';
    END IF;
END
$$;

-- 2. Vendor accounts — links user to supplier
CREATE TABLE IF NOT EXISTS vendor_accounts (
    id              BIGSERIAL PRIMARY KEY,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    supplier_id     BIGINT REFERENCES suppliers(id),
    company_name    TEXT NOT NULL,
    contact_name    TEXT NOT NULL,
    phone           TEXT,
    address         TEXT,
    tax_code        TEXT,
    product_categories TEXT[],         -- e.g. {'jig', 'conveyor', 'sensor'}
    is_approved     BOOLEAN DEFAULT false,
    approved_by     UUID REFERENCES users(id),
    approved_at     TIMESTAMPTZ,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id)
);

-- 3. Procurement RFQ batches — Song Chau groups items for bidding
CREATE TABLE IF NOT EXISTS procurement_rfq_batches (
    id              BIGSERIAL PRIMARY KEY,
    batch_code      TEXT NOT NULL UNIQUE,           -- e.g. 'BATCH-2026-0042'
    title           TEXT NOT NULL,                   -- e.g. 'Linh kiện CNC tháng 4/2026'
    description     TEXT,
    status          TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'published', 'closed', 'awarded', 'cancelled')),
    award_mode      TEXT NOT NULL DEFAULT 'per_item'
                    CHECK (award_mode IN ('per_item', 'per_batch')),
    published_at    TIMESTAMPTZ,
    closed_at       TIMESTAMPTZ,
    created_by      UUID NOT NULL REFERENCES users(id),
    item_count      INT DEFAULT 0,
    quote_count     INT DEFAULT 0,
    notes_internal  TEXT,                            -- internal notes (NEVER shown to vendors)
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Procurement RFQ items — individual items in a batch (sanitized for vendors)
CREATE TABLE IF NOT EXISTS procurement_rfq_items (
    id              BIGSERIAL PRIMARY KEY,
    batch_id        BIGINT NOT NULL REFERENCES procurement_rfq_batches(id) ON DELETE CASCADE,
    item_no         INT NOT NULL,                    -- sequential within batch
    specification   TEXT NOT NULL,                   -- product spec (sanitized)
    bqms_code       TEXT,                            -- optional BQMS reference
    quantity        NUMERIC NOT NULL,
    unit            TEXT NOT NULL DEFAULT 'EA',
    required_material TEXT,                          -- e.g. 'SUS304', 'POM', 'Al6061'
    drawing_url     TEXT,                            -- link to drawing file
    notes           TEXT,                            -- visible to vendors
    target_price    NUMERIC,                         -- Song Chau's target (NEVER shown to vendors)
    source_bqms_rfq_id BIGINT,                      -- link to bqms_rfq (NEVER shown to vendors)
    awarded_vendor_id  BIGINT REFERENCES vendor_accounts(id),
    awarded_price      NUMERIC,
    awarded_currency   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (batch_id, item_no)
);

CREATE INDEX IF NOT EXISTS idx_prfq_items_batch ON procurement_rfq_items(batch_id);

-- 5. Procurement RFQ invitations — which vendors are invited
CREATE TABLE IF NOT EXISTS procurement_rfq_invitations (
    id              BIGSERIAL PRIMARY KEY,
    batch_id        BIGINT NOT NULL REFERENCES procurement_rfq_batches(id) ON DELETE CASCADE,
    vendor_id       BIGINT NOT NULL REFERENCES vendor_accounts(id),
    invited_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    viewed_at       TIMESTAMPTZ,
    quoted_at       TIMESTAMPTZ,
    email_sent      BOOLEAN DEFAULT false,
    UNIQUE (batch_id, vendor_id)
);

-- 6. Vendor quotes — one quote per vendor per batch (sealed)
CREATE TABLE IF NOT EXISTS vendor_quotes (
    id              BIGSERIAL PRIMARY KEY,
    batch_id        BIGINT NOT NULL REFERENCES procurement_rfq_batches(id),
    vendor_id       BIGINT NOT NULL REFERENCES vendor_accounts(id),
    currency        TEXT NOT NULL DEFAULT 'USD'
                    CHECK (currency IN ('USD', 'RMB')),
    total_amount    NUMERIC,                         -- auto-calculated sum
    lead_time_days  INT,                             -- delivery lead time
    moq_notes       TEXT,                            -- MOQ conditions
    notes           TEXT,
    attachment_path TEXT,                             -- uploaded Excel/PDF
    status          TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'submitted', 'awarded', 'rejected')),
    submitted_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (batch_id, vendor_id)
);

-- 7. Vendor quote items — per-item pricing
CREATE TABLE IF NOT EXISTS vendor_quote_items (
    id              BIGSERIAL PRIMARY KEY,
    quote_id        BIGINT NOT NULL REFERENCES vendor_quotes(id) ON DELETE CASCADE,
    item_id         BIGINT NOT NULL REFERENCES procurement_rfq_items(id),
    unit_price      NUMERIC NOT NULL,
    quantity        NUMERIC,                         -- vendor can adjust qty
    lead_time_days  INT,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (quote_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_vqi_quote ON vendor_quote_items(quote_id);
CREATE INDEX IF NOT EXISTS idx_vqi_item ON vendor_quote_items(item_id);

-- 8. Indexes
CREATE INDEX IF NOT EXISTS idx_va_approved ON vendor_accounts(is_approved);
CREATE INDEX IF NOT EXISTS idx_prfq_batch_status ON procurement_rfq_batches(status);
CREATE INDEX IF NOT EXISTS idx_vq_batch ON vendor_quotes(batch_id);
CREATE INDEX IF NOT EXISTS idx_vq_vendor ON vendor_quotes(vendor_id);
