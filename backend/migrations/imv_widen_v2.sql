-- Widen ALL remaining VARCHAR(40) columns to (100) to prevent overflow.
BEGIN;

ALTER TABLE imv_payments
  ALTER COLUMN customer_code TYPE VARCHAR(100),
  ALTER COLUMN tax_label     TYPE VARCHAR(60),
  ALTER COLUMN unit          TYPE VARCHAR(60),
  ALTER COLUMN currency      TYPE VARCHAR(16);

ALTER TABLE imv_orders
  ALTER COLUMN origin_country TYPE VARCHAR(120);

ALTER TABLE imv_deliveries
  ALTER COLUMN origin_country TYPE VARCHAR(120);

COMMIT;
