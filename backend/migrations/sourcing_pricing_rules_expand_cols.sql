-- Mở rộng sourcing_pricing_rules để khớp "Bảng tính giá 2026" template.
-- Thêm cột import_tax_pct, vat_pct, purchase_cost_pct, transfer_fee_pct,
-- swift_fee_usd, profit_pct_import, profit_pct_domestic.
-- Engine compute_sale_vnd() sẽ dùng các cột này thay vì hardcode.
-- Backward-compat: vat_pct mirror từ tax_pct cũ; markup_pct giữ nguyên (unused
-- in template formula nhưng vẫn cho phép legacy entries).
-- Thang 2026-06-13.

ALTER TABLE sourcing_pricing_rules
    ADD COLUMN IF NOT EXISTS import_tax_pct      NUMERIC(6, 3) NOT NULL DEFAULT 20.000,
    ADD COLUMN IF NOT EXISTS vat_pct             NUMERIC(6, 3) NOT NULL DEFAULT 10.000,
    ADD COLUMN IF NOT EXISTS purchase_cost_pct   NUMERIC(6, 3) NOT NULL DEFAULT 25.000,
    ADD COLUMN IF NOT EXISTS transfer_fee_pct    NUMERIC(6, 3) NOT NULL DEFAULT 0.200,
    ADD COLUMN IF NOT EXISTS swift_fee_usd       NUMERIC(10, 3) NOT NULL DEFAULT 5.000,
    ADD COLUMN IF NOT EXISTS profit_pct_import   NUMERIC(6, 3) NOT NULL DEFAULT 12.000,
    ADD COLUMN IF NOT EXISTS profit_pct_domestic NUMERIC(6, 3) NOT NULL DEFAULT 20.000;

-- Sync vat_pct = tax_pct cho rows cũ (nếu admin đã set tax_pct khác default)
UPDATE sourcing_pricing_rules
   SET vat_pct = tax_pct
 WHERE vat_pct = 10.000
   AND tax_pct <> 10.000;

COMMENT ON COLUMN sourcing_pricing_rules.import_tax_pct IS
    'Thuế nhập khẩu % (N = (K+M) * import_tax_pct/100). Set 0 khi is_domestic_vn.';
COMMENT ON COLUMN sourcing_pricing_rules.vat_pct IS
    'Thuế VAT % (O = (K+M+N) * vat_pct/100). Default 10%.';
COMMENT ON COLUMN sourcing_pricing_rules.purchase_cost_pct IS
    'Chi phí mua hộ % (P = K * purchase_cost_pct/100). Default 25%.';
COMMENT ON COLUMN sourcing_pricing_rules.transfer_fee_pct IS
    'Phí chuyển tiền % (Q phần 1 = (K+M+P) * transfer_fee_pct/100). Default 0.2%.';
COMMENT ON COLUMN sourcing_pricing_rules.swift_fee_usd IS
    'Phí Swift USD (Q phần 2 = swift_fee_usd * USD-VND rate). Default 5 USD.';
COMMENT ON COLUMN sourcing_pricing_rules.profit_pct_import IS
    'Lợi nhuận % cho hàng nhập khẩu (R = (K+L+M+N+O+P+Q) * profit_pct_import/100). Default 12%.';
COMMENT ON COLUMN sourcing_pricing_rules.profit_pct_domestic IS
    'Lợi nhuận % cho hàng nội địa VN (R = ... * profit_pct_domestic/100). Default 20%.';
