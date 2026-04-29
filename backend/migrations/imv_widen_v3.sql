-- Widen all 255-char text columns to TEXT (unlimited)
-- IMV portal sometimes returns very long company / model names.
BEGIN;

ALTER TABLE imv_payments
  ALTER COLUMN model         TYPE TEXT,
  ALTER COLUMN customer_name TYPE TEXT,
  ALTER COLUMN customer_dept TYPE TEXT,
  ALTER COLUMN paying_entity TYPE TEXT;

ALTER TABLE imv_orders
  ALTER COLUMN customer_name     TYPE TEXT,
  ALTER COLUMN customer_facility TYPE TEXT,
  ALTER COLUMN model             TYPE TEXT,
  ALTER COLUMN maker             TYPE TEXT,
  ALTER COLUMN delivery_address  TYPE TEXT;

ALTER TABLE imv_deliveries
  ALTER COLUMN customer_name     TYPE TEXT,
  ALTER COLUMN customer_facility TYPE TEXT,
  ALTER COLUMN customer_dept     TYPE TEXT,
  ALTER COLUMN supplier_name     TYPE TEXT,
  ALTER COLUMN ship_to           TYPE TEXT;

ALTER TABLE imv_contracts
  ALTER COLUMN customer_name     TYPE TEXT,
  ALTER COLUMN customer_facility TYPE TEXT,
  ALTER COLUMN status_text       TYPE VARCHAR(200);

ALTER TABLE imv_rfq
  ALTER COLUMN customer_name     TYPE TEXT,
  ALTER COLUMN customer_facility TYPE TEXT,
  ALTER COLUMN model             TYPE TEXT,
  ALTER COLUMN maker             TYPE TEXT,
  ALTER COLUMN handler_name      TYPE VARCHAR(200);

ALTER TABLE imv_rejections
  ALTER COLUMN customer_name     TYPE TEXT,
  ALTER COLUMN status_text       TYPE VARCHAR(200);

COMMIT;
