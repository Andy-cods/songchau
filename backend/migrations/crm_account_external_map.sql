-- CRM account external mapping
-- Phase 0 kickoff: replace fragile text-match with explicit aliases.

CREATE TABLE IF NOT EXISTS crm_account_external_map (
    id              BIGSERIAL PRIMARY KEY,
    customer_id     BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    source_system   TEXT NOT NULL,
    match_field     TEXT NOT NULL,
    match_value     TEXT NOT NULL,
    is_primary      BOOLEAN NOT NULL DEFAULT false,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (customer_id, source_system, match_field, match_value)
);

CREATE INDEX IF NOT EXISTS idx_crm_map_customer
    ON crm_account_external_map(customer_id);

CREATE INDEX IF NOT EXISTS idx_crm_map_lookup
    ON crm_account_external_map(source_system, match_field);

CREATE INDEX IF NOT EXISTS idx_crm_map_match_value_lower
    ON crm_account_external_map(LOWER(match_value));

-- Seed current customer aliases so existing CRM routes can stop relying on
-- direct `ILIKE short_name` checks. These seeds are safe and idempotent.
INSERT INTO crm_account_external_map (customer_id, source_system, match_field, match_value, is_primary, notes)
SELECT id, 'bqms_samsung_po', 'company', short_name, true, 'seeded from customers.short_name'
FROM customers
WHERE short_name IS NOT NULL AND BTRIM(short_name) <> ''
ON CONFLICT (customer_id, source_system, match_field, match_value) DO NOTHING;

INSERT INTO crm_account_external_map (customer_id, source_system, match_field, match_value, is_primary, notes)
SELECT id, 'bqms_deliveries', 'sev_type', short_name, true, 'seeded from customers.short_name'
FROM customers
WHERE short_name IS NOT NULL AND BTRIM(short_name) <> ''
ON CONFLICT (customer_id, source_system, match_field, match_value) DO NOTHING;

INSERT INTO crm_account_external_map (customer_id, source_system, match_field, match_value, is_primary, notes)
SELECT id, 'bqms_orders', 'customer_name', company_name, true, 'seeded from customers.company_name'
FROM customers
WHERE company_name IS NOT NULL AND BTRIM(company_name) <> ''
ON CONFLICT (customer_id, source_system, match_field, match_value) DO NOTHING;

INSERT INTO crm_account_external_map (customer_id, source_system, match_field, match_value, is_primary, notes)
SELECT id, 'bqms_orders', 'customer_name', short_name, false, 'seeded from customers.short_name'
FROM customers
WHERE short_name IS NOT NULL AND BTRIM(short_name) <> ''
ON CONFLICT (customer_id, source_system, match_field, match_value) DO NOTHING;

