-- Extend quarterly invoice staging tables with configurable cost fields.
-- Date: 2026-04-13

ALTER TABLE sales_invoices_q
    ADD COLUMN IF NOT EXISTS shipping_cost NUMERIC DEFAULT 0,
    ADD COLUMN IF NOT EXISTS customs_fee NUMERIC DEFAULT 0,
    ADD COLUMN IF NOT EXISTS commission NUMERIC DEFAULT 0,
    ADD COLUMN IF NOT EXISTS other_costs NUMERIC DEFAULT 0,
    ADD COLUMN IF NOT EXISTS manual_adjustment NUMERIC DEFAULT 0;

ALTER TABLE purchase_invoices_q
    ADD COLUMN IF NOT EXISTS shipping_cost NUMERIC DEFAULT 0,
    ADD COLUMN IF NOT EXISTS customs_fee NUMERIC DEFAULT 0,
    ADD COLUMN IF NOT EXISTS other_costs NUMERIC DEFAULT 0,
    ADD COLUMN IF NOT EXISTS manual_adjustment NUMERIC DEFAULT 0;
