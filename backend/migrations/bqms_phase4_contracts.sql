-- Phase 4.2 (Thang 2026-05-12 audit follow-up):
-- Dedicated table cho contract đã ký với Samsung, link tới Trúng BG.
-- Source: bqms_vendor_portal_staging WHERE module='contract' (50 staging rows
-- ngày 12/5/2026). Mỗi contract có 1 contract_no unique + nhiều items.

BEGIN;

CREATE TABLE IF NOT EXISTS bqms_contracts (
    id                  BIGSERIAL PRIMARY KEY,
    contract_no         TEXT UNIQUE NOT NULL,
    request_no          TEXT,                            -- RFQ number (e.g. QT26039894)
    contract_kind       TEXT,                            -- 'Unit Price Contract', 'Lump Sum Contract'
    contract_type       TEXT,                            -- 'Quotation', 'Direct', ...
    subject             TEXT,                            -- request title
    status              TEXT,                            -- 'Progress', 'Done', 'Cancelled'
    amount              NUMERIC(15, 2),
    currency            TEXT DEFAULT 'VND',
    contract_period     TEXT,                            -- '5/11/2026 ~ 8/11/2026' raw
    contract_start      DATE,
    contract_end        DATE,
    vendor_name         TEXT,
    created_by_samsung  TEXT,                            -- Samsung PIC who created
    reconciliation      TEXT,                            -- 'Yes' | 'No'
    won_quotation_id    BIGINT REFERENCES bqms_won_quotations(id),
    rfq_id              BIGINT REFERENCES bqms_rfq(id),
    raw_data            JSONB,
    synced_at           TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bqms_contracts_request_no    ON bqms_contracts(request_no);
CREATE INDEX IF NOT EXISTS idx_bqms_contracts_won_quot_id   ON bqms_contracts(won_quotation_id);
CREATE INDEX IF NOT EXISTS idx_bqms_contracts_rfq_id        ON bqms_contracts(rfq_id);
CREATE INDEX IF NOT EXISTS idx_bqms_contracts_contract_start ON bqms_contracts(contract_start);

COMMENT ON TABLE bqms_contracts IS 'Hợp đồng đã ký với Samsung, merge từ vendor_portal_staging module=contract (Thang 2026-05-12)';
COMMENT ON COLUMN bqms_contracts.contract_no IS 'CO26xxxxx — unique';
COMMENT ON COLUMN bqms_contracts.request_no IS 'RFQ number gốc — match với bqms_rfq.rfq_number';

-- Contract line items (1 contract có thể có nhiều items)
CREATE TABLE IF NOT EXISTS bqms_contract_items (
    id              BIGSERIAL PRIMARY KEY,
    contract_id     BIGINT NOT NULL REFERENCES bqms_contracts(id) ON DELETE CASCADE,
    item_no         TEXT,
    bqms_code       TEXT,                                -- item_code
    description     TEXT,
    specification   TEXT,
    quantity        NUMERIC(15, 3),
    unit            TEXT,
    unit_price      NUMERIC(15, 4),
    amount          NUMERIC(15, 2),
    currency        TEXT DEFAULT 'VND',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bqms_contract_items_contract_id ON bqms_contract_items(contract_id);
CREATE INDEX IF NOT EXISTS idx_bqms_contract_items_bqms_code   ON bqms_contract_items(bqms_code);

COMMENT ON TABLE bqms_contract_items IS 'Line items của contract — 1:N với bqms_contracts';

COMMIT;
