-- Vendor Bidding Phase 2 — Full lifecycle clone của sec-bqms (Thang 2026-05-14)
-- Bidding → Contract → MRO PO → Delivery, mirroring Samsung BQMS structure.

-- ─── 1. Enrich procurement_rfq_items với full Samsung fields ───
ALTER TABLE procurement_rfq_items
    ADD COLUMN IF NOT EXISTS maker             TEXT,
    ADD COLUMN IF NOT EXISTS part_no           TEXT,
    ADD COLUMN IF NOT EXISTS cis_code          TEXT,
    ADD COLUMN IF NOT EXISTS moq               TEXT,
    ADD COLUMN IF NOT EXISTS item_deadline     DATE,
    ADD COLUMN IF NOT EXISTS dimension         TEXT,
    ADD COLUMN IF NOT EXISTS specification_full TEXT,
    ADD COLUMN IF NOT EXISTS attachments_paths JSONB NOT NULL DEFAULT '[]'::jsonb;

-- ─── 2. Enrich procurement_rfq_batches với Samsung batch metadata ───
ALTER TABLE procurement_rfq_batches
    ADD COLUMN IF NOT EXISTS reg_dt            TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS req_name          TEXT,
    ADD COLUMN IF NOT EXISTS requester         TEXT,
    ADD COLUMN IF NOT EXISTS department        TEXT,
    ADD COLUMN IF NOT EXISTS person_in_charge  TEXT,
    ADD COLUMN IF NOT EXISTS criteria_currency TEXT,
    ADD COLUMN IF NOT EXISTS ctr_type_name     TEXT,
    ADD COLUMN IF NOT EXISTS dday_text         TEXT,
    ADD COLUMN IF NOT EXISTS source_bqms_rfq_number TEXT;

CREATE INDEX IF NOT EXISTS idx_prfq_batches_reg_dt ON procurement_rfq_batches(reg_dt DESC);

-- ─── 3. Contracts — sau khi award batch ───
CREATE TABLE IF NOT EXISTS procurement_contracts (
    id                  BIGSERIAL PRIMARY KEY,
    contract_no         TEXT NOT NULL UNIQUE,             -- e.g. SC-CT-2026-0001
    batch_id            BIGINT NOT NULL REFERENCES procurement_rfq_batches(id),
    vendor_id           BIGINT REFERENCES vendor_accounts(id),
    vendor_name         TEXT NOT NULL,
    vendor_email        TEXT,
    vendor_phone        TEXT,
    vendor_tax_code     TEXT,
    vendor_address      TEXT,
    -- Pricing
    total_amount        NUMERIC NOT NULL,
    currency            TEXT NOT NULL DEFAULT 'VND',
    payment_terms       TEXT,
    delivery_terms      TEXT,
    warranty_terms      TEXT,
    -- Status
    status              TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','sent','signed','active','completed','cancelled')),
    contract_date       DATE,
    effective_date      DATE,
    expiry_date         DATE,
    sent_to_vendor_at   TIMESTAMPTZ,
    signed_at           TIMESTAMPTZ,
    signed_by_vendor    TEXT,                              -- vendor name who signed
    signed_ip           INET,
    signature_data      JSONB,                             -- optional e-sign info
    -- Documents
    contract_file_path  TEXT,                              -- generated PDF path
    -- Audit
    created_by          UUID NOT NULL REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    notes               TEXT
);

CREATE INDEX IF NOT EXISTS idx_pct_batch  ON procurement_contracts(batch_id);
CREATE INDEX IF NOT EXISTS idx_pct_vendor ON procurement_contracts(vendor_id);
CREATE INDEX IF NOT EXISTS idx_pct_status ON procurement_contracts(status);

-- ─── 4. Contract items — copy từ awarded items ───
CREATE TABLE IF NOT EXISTS procurement_contract_items (
    id                  BIGSERIAL PRIMARY KEY,
    contract_id         BIGINT NOT NULL REFERENCES procurement_contracts(id) ON DELETE CASCADE,
    rfq_item_id         BIGINT REFERENCES procurement_rfq_items(id),
    item_no             INT NOT NULL,
    bqms_code           TEXT,
    specification       TEXT NOT NULL,
    quantity            NUMERIC NOT NULL,
    unit                TEXT NOT NULL DEFAULT 'EA',
    unit_price          NUMERIC NOT NULL,
    total_price         NUMERIC GENERATED ALWAYS AS (quantity * unit_price) STORED,
    lead_time_days      INT,
    notes               TEXT,
    UNIQUE (contract_id, item_no)
);

-- ─── 5. POs (MRO) — Purchase Orders Song Châu đặt NCC ───
CREATE TABLE IF NOT EXISTS procurement_pos (
    id                  BIGSERIAL PRIMARY KEY,
    po_no               TEXT NOT NULL UNIQUE,             -- e.g. SC-PO-2026-0001
    contract_id         BIGINT REFERENCES procurement_contracts(id),  -- nullable for ad-hoc POs
    batch_id            BIGINT REFERENCES procurement_rfq_batches(id),
    vendor_id           BIGINT REFERENCES vendor_accounts(id),
    vendor_name         TEXT NOT NULL,
    -- PO details
    po_date             DATE NOT NULL DEFAULT CURRENT_DATE,
    requested_delivery_date DATE,
    actual_delivery_date    DATE,
    total_amount        NUMERIC NOT NULL,
    currency            TEXT NOT NULL DEFAULT 'VND',
    payment_status      TEXT NOT NULL DEFAULT 'pending'
                        CHECK (payment_status IN ('pending','partial','paid')),
    -- Lifecycle
    status              TEXT NOT NULL DEFAULT 'open'
                        CHECK (status IN ('draft','open','partially_delivered','delivered','closed','cancelled')),
    delivery_address    TEXT,
    notes               TEXT,
    -- Audit
    created_by          UUID NOT NULL REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at           TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ppo_contract ON procurement_pos(contract_id);
CREATE INDEX IF NOT EXISTS idx_ppo_vendor   ON procurement_pos(vendor_id);
CREATE INDEX IF NOT EXISTS idx_ppo_status   ON procurement_pos(status);

-- ─── 6. PO items ───
CREATE TABLE IF NOT EXISTS procurement_po_items (
    id                  BIGSERIAL PRIMARY KEY,
    po_id               BIGINT NOT NULL REFERENCES procurement_pos(id) ON DELETE CASCADE,
    contract_item_id    BIGINT REFERENCES procurement_contract_items(id),
    item_no             INT NOT NULL,
    bqms_code           TEXT,
    specification       TEXT NOT NULL,
    ordered_qty         NUMERIC NOT NULL,
    delivered_qty       NUMERIC NOT NULL DEFAULT 0,
    unit                TEXT NOT NULL DEFAULT 'EA',
    unit_price          NUMERIC NOT NULL,
    total_price         NUMERIC GENERATED ALWAYS AS (ordered_qty * unit_price) STORED,
    notes               TEXT,
    UNIQUE (po_id, item_no)
);

-- ─── 7. Deliveries — giao hàng theo PO ───
CREATE TABLE IF NOT EXISTS procurement_deliveries (
    id                  BIGSERIAL PRIMARY KEY,
    delivery_no         TEXT NOT NULL UNIQUE,             -- e.g. SC-DEL-2026-0001
    po_id               BIGINT NOT NULL REFERENCES procurement_pos(id) ON DELETE CASCADE,
    vendor_id           BIGINT REFERENCES vendor_accounts(id),
    -- Logistics
    delivered_at        TIMESTAMPTZ,
    delivery_method     TEXT,                              -- 'courier','vendor_delivery','pickup','express'
    tracking_no         TEXT,
    -- Status
    status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','shipping','arrived','received','rejected','returned')),
    received_at         TIMESTAMPTZ,
    received_by         UUID REFERENCES users(id),
    rejection_reason    TEXT,
    -- Evidence
    photos              JSONB NOT NULL DEFAULT '[]'::jsonb,
    documents           JSONB NOT NULL DEFAULT '[]'::jsonb,
    notes               TEXT,
    -- Audit
    created_by          UUID REFERENCES users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pdel_po     ON procurement_deliveries(po_id);
CREATE INDEX IF NOT EXISTS idx_pdel_status ON procurement_deliveries(status);

-- ─── 8. Delivery items — actual delivered quantities ───
CREATE TABLE IF NOT EXISTS procurement_delivery_items (
    id                  BIGSERIAL PRIMARY KEY,
    delivery_id         BIGINT NOT NULL REFERENCES procurement_deliveries(id) ON DELETE CASCADE,
    po_item_id          BIGINT NOT NULL REFERENCES procurement_po_items(id),
    delivered_qty       NUMERIC NOT NULL,
    quality_status      TEXT NOT NULL DEFAULT 'ok'
                        CHECK (quality_status IN ('ok','minor_defect','rejected')),
    notes               TEXT
);

CREATE INDEX IF NOT EXISTS idx_pdli_delivery ON procurement_delivery_items(delivery_id);

-- ─── 9. Sequence helpers cho contract_no/po_no/delivery_no ───
CREATE SEQUENCE IF NOT EXISTS procurement_contract_seq START 1;
CREATE SEQUENCE IF NOT EXISTS procurement_po_seq START 1;
CREATE SEQUENCE IF NOT EXISTS procurement_delivery_seq START 1;
