-- ============================================================
-- payment_requests <-> sourcing_orders link
-- Additive migration on top of init_v3.sql:1721-1746.
-- Date: 2026-06-03 (Thang)
--
-- Rationale (recap):
--   * REUSE existing payment_requests table — has all columns we need
--     (workflow_id, status check, requester_id, amount, currency,
--      beneficiary fields, attachments, approved_by/at, paid_at).
--   * sourcing_orders already has payment_request_id (back-ref).
--   * Forward-link payment_requests.sourcing_order_id so list/filter SQL
--     does not have to LATERAL-scan sourcing_orders on every request.
--   * Add rejection_reason / rejected_by / rejected_at + metadata jsonb
--     so the reject endpoint can persist structured audit without
--     polluting the free-text `notes` column.
--   * Backfill: turn the legacy pseudo_pr_id = order_id rows already
--     written by sourcing.py:2285 into REAL payment_requests rows.
-- ============================================================

BEGIN;

-- 1) Forward link payment_requests -> sourcing_orders + reject audit fields.
ALTER TABLE payment_requests
    ADD COLUMN IF NOT EXISTS sourcing_order_id BIGINT REFERENCES sourcing_orders(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS rejection_reason  TEXT,
    ADD COLUMN IF NOT EXISTS rejected_by       UUID REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS rejected_at       TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS metadata          JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_pr_sourcing_order ON payment_requests (sourcing_order_id);
CREATE INDEX IF NOT EXISTS idx_pr_status_created ON payment_requests (status, created_at DESC);

-- updated_at trigger (idempotent — payment_requests doesn't have one yet)
CREATE OR REPLACE FUNCTION set_updated_at_payment_requests()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_pr_updated_at ON payment_requests;
CREATE TRIGGER trg_pr_updated_at
    BEFORE UPDATE ON payment_requests
    FOR EACH ROW EXECUTE FUNCTION set_updated_at_payment_requests();

-- 3) Backfill — turn pseudo PR rows (payment_request_id = order_id) into real PRs.
--    sourcing.py previously stored the order_id itself as the pseudo PR id; this
--    moves those rows into real payment_requests so the new endpoints can act on
--    them.
INSERT INTO payment_requests (
    company_id, requester_id, requester_name, department, request_date,
    description, amount, currency, payment_method,
    beneficiary_name, beneficiary_bank, beneficiary_account,
    status, sourcing_order_id, metadata, created_at, updated_at
)
SELECT
    NULL,
    COALESCE(so.assigned_to, (SELECT id FROM users WHERE role = 'admin' LIMIT 1)),
    so.created_by_email,
    'Sales',
    CURRENT_DATE,
    'Backfill — Don ' || so.order_number || ' / KH ' || so.customer_name,
    so.total_value_vnd,
    COALESCE(so.currency, 'VND')::currency_code,
    NULL, NULL, NULL, NULL,
    CASE so.status
        WHEN 'payment_requested' THEN 'pending'
        WHEN 'payment_approved'  THEN 'approved'
        WHEN 'cancelled'         THEN 'cancelled'
        ELSE 'pending'
    END,
    so.id,
    jsonb_build_object('backfilled', true, 'pseudo_pr_id', so.payment_request_id),
    NOW(), NOW()
FROM sourcing_orders so
WHERE so.payment_request_id = so.id  -- exactly the pseudo-id pattern from sourcing.py:2285
  AND NOT EXISTS (
      SELECT 1 FROM payment_requests pr WHERE pr.sourcing_order_id = so.id
  );

-- 4) Rewire sourcing_orders.payment_request_id to the real PR row id.
UPDATE sourcing_orders so
   SET payment_request_id = pr.id
  FROM payment_requests pr
 WHERE pr.sourcing_order_id = so.id
   AND so.payment_request_id = so.id;

COMMIT;
