-- Widen all VARCHAR columns to 100 in IMV tables to accommodate longer
-- supplier-side identifiers we discovered after first sync attempt.

BEGIN;

ALTER TABLE imv_payments
  ALTER COLUMN invoice_id      TYPE VARCHAR(100),
  ALTER COLUMN order_no        TYPE VARCHAR(100),
  ALTER COLUMN po_no           TYPE VARCHAR(100),
  ALTER COLUMN amount_id       TYPE VARCHAR(100),
  ALTER COLUMN shipment_id     TYPE VARCHAR(100),
  ALTER COLUMN item_code       TYPE VARCHAR(100),
  ALTER COLUMN payment_target  TYPE VARCHAR(120),
  ALTER COLUMN payment_method  TYPE VARCHAR(200),
  ALTER COLUMN payment_type    TYPE VARCHAR(60);

ALTER TABLE imv_orders
  ALTER COLUMN po_number          TYPE VARCHAR(100),
  ALTER COLUMN po_internal_number TYPE VARCHAR(100),
  ALTER COLUMN item_code          TYPE VARCHAR(100),
  ALTER COLUMN handler_login      TYPE VARCHAR(100),
  ALTER COLUMN status_text        TYPE VARCHAR(120),
  ALTER COLUMN order_type         TYPE VARCHAR(120),
  ALTER COLUMN unit               TYPE VARCHAR(60),
  ALTER COLUMN currency           TYPE VARCHAR(16),
  ALTER COLUMN tax_label          TYPE VARCHAR(60),
  ALTER COLUMN order_method       TYPE VARCHAR(120);

ALTER TABLE imv_deliveries
  ALTER COLUMN order_no_internal TYPE VARCHAR(100),
  ALTER COLUMN shipment_id       TYPE VARCHAR(100),
  ALTER COLUMN item_code         TYPE VARCHAR(100),
  ALTER COLUMN po_number         TYPE VARCHAR(100),
  ALTER COLUMN delivery_type     TYPE VARCHAR(60),
  ALTER COLUMN unit              TYPE VARCHAR(60),
  ALTER COLUMN status            TYPE VARCHAR(40),
  ALTER COLUMN stage             TYPE VARCHAR(60),
  ALTER COLUMN stage2            TYPE VARCHAR(60);

ALTER TABLE imv_rfq
  ALTER COLUMN rfq_number   TYPE VARCHAR(100),
  ALTER COLUMN item_code    TYPE VARCHAR(100),
  ALTER COLUMN doc_type     TYPE VARCHAR(40),
  ALTER COLUMN flow_status  TYPE VARCHAR(40);

ALTER TABLE imv_contracts
  ALTER COLUMN contract_id  TYPE VARCHAR(100),
  ALTER COLUMN item_code    TYPE VARCHAR(100),
  ALTER COLUMN rfq_number   TYPE VARCHAR(100);

ALTER TABLE imv_rejections
  ALTER COLUMN rejection_id TYPE VARCHAR(100),
  ALTER COLUMN shipment_id  TYPE VARCHAR(100),
  ALTER COLUMN item_code    TYPE VARCHAR(100);

COMMIT;
