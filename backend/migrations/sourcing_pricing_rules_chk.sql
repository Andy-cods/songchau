-- CHECK constraints cho sourcing_pricing_rules — chặn negative + giá trị vô lý.
-- Tách riêng khỏi expand_cols.sql để dễ rollback constraint mà giữ cột.
-- Thang 2026-06-13.

DO $$
BEGIN
    -- Negative guards
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'spr_chk_markup_pct_nonneg') THEN
        ALTER TABLE sourcing_pricing_rules
            ADD CONSTRAINT spr_chk_markup_pct_nonneg CHECK (markup_pct >= 0);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'spr_chk_tax_pct_nonneg') THEN
        ALTER TABLE sourcing_pricing_rules
            ADD CONSTRAINT spr_chk_tax_pct_nonneg CHECK (tax_pct >= 0);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'spr_chk_shipping_fee_nonneg') THEN
        ALTER TABLE sourcing_pricing_rules
            ADD CONSTRAINT spr_chk_shipping_fee_nonneg CHECK (shipping_fee_vnd >= 0);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'spr_chk_import_tax_pct_nonneg') THEN
        ALTER TABLE sourcing_pricing_rules
            ADD CONSTRAINT spr_chk_import_tax_pct_nonneg CHECK (import_tax_pct >= 0);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'spr_chk_vat_pct_nonneg') THEN
        ALTER TABLE sourcing_pricing_rules
            ADD CONSTRAINT spr_chk_vat_pct_nonneg CHECK (vat_pct >= 0);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'spr_chk_purchase_cost_pct_nonneg') THEN
        ALTER TABLE sourcing_pricing_rules
            ADD CONSTRAINT spr_chk_purchase_cost_pct_nonneg CHECK (purchase_cost_pct >= 0);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'spr_chk_transfer_fee_pct_nonneg') THEN
        ALTER TABLE sourcing_pricing_rules
            ADD CONSTRAINT spr_chk_transfer_fee_pct_nonneg CHECK (transfer_fee_pct >= 0);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'spr_chk_swift_fee_usd_nonneg') THEN
        ALTER TABLE sourcing_pricing_rules
            ADD CONSTRAINT spr_chk_swift_fee_usd_nonneg CHECK (swift_fee_usd >= 0);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'spr_chk_profit_pct_import_nonneg') THEN
        ALTER TABLE sourcing_pricing_rules
            ADD CONSTRAINT spr_chk_profit_pct_import_nonneg CHECK (profit_pct_import >= 0);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'spr_chk_profit_pct_domestic_nonneg') THEN
        ALTER TABLE sourcing_pricing_rules
            ADD CONSTRAINT spr_chk_profit_pct_domestic_nonneg CHECK (profit_pct_domestic >= 0);
    END IF;

    -- Sanity caps: phần trăm không vượt 1000%
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'spr_chk_import_tax_pct_cap') THEN
        ALTER TABLE sourcing_pricing_rules
            ADD CONSTRAINT spr_chk_import_tax_pct_cap CHECK (import_tax_pct <= 1000);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'spr_chk_vat_pct_cap') THEN
        ALTER TABLE sourcing_pricing_rules
            ADD CONSTRAINT spr_chk_vat_pct_cap CHECK (vat_pct <= 1000);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'spr_chk_purchase_cost_pct_cap') THEN
        ALTER TABLE sourcing_pricing_rules
            ADD CONSTRAINT spr_chk_purchase_cost_pct_cap CHECK (purchase_cost_pct <= 1000);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'spr_chk_transfer_fee_pct_cap') THEN
        ALTER TABLE sourcing_pricing_rules
            ADD CONSTRAINT spr_chk_transfer_fee_pct_cap CHECK (transfer_fee_pct <= 100);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'spr_chk_profit_pct_import_cap') THEN
        ALTER TABLE sourcing_pricing_rules
            ADD CONSTRAINT spr_chk_profit_pct_import_cap CHECK (profit_pct_import <= 1000);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'spr_chk_profit_pct_domestic_cap') THEN
        ALTER TABLE sourcing_pricing_rules
            ADD CONSTRAINT spr_chk_profit_pct_domestic_cap CHECK (profit_pct_domestic <= 1000);
    END IF;
END$$;
