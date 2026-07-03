-- ============================================================
-- procurement_ap_001_payables.sql
--
-- ĐỢT 5 — Procurement auto công nợ phải trả (AP) chain link.
--          Wire procurement deliveries -> accounts_payable so that
--          when a procurement_delivery transitions to status='received'
--          the app can auto-create exactly ONE accounts_payable row for
--          THAT delivery (amount = value of that delivery only).
--
-- ⚠️ STAGED MIGRATION — additive + IDEMPOTENT. Safe to run later.
--    This migration ONLY adds columns / indexes (ALL via ADD COLUMN
--    IF NOT EXISTS / CREATE ... IF NOT EXISTS) and seeds ONE app_config
--    flag row in the OFF state. It does NOT alter any data, drop
--    anything, or change any existing column. In particular it does
--    NOT touch accounts_payable.supplier_id (stays NOT NULL) — the
--    auto-AP hook resolves supplier_id from the delivery's vendor
--    account and GRACEFULLY SKIPS when that vendor has no supplier_id
--    (exactly like ensure_ar_for_order skips a null customer).
--
--    Running it does NOT by itself change financial behavior — the
--    auto-AP write path is gated behind the PROCUREMENT_AUTO_AP_ENABLED
--    application flag (env, default FALSE) + the procurement_auto_ap_enabled
--    app_config runtime override (seeded here as 'false'). Flag stays OFF
--    on deploy — Thang enables it later after owner sign-off.
--
-- MIRRORS the AR precedent (phase3_chain_activation.sql §1):
--   * additive ADD COLUMN IF NOT EXISTS link columns
--   * one UNIQUE partial index = the idempotency guard the hook relies on
--     (1 AP per delivery; insert uses ON CONFLICT DO NOTHING)
--
-- REUSES existing tables (do NOT recreate):
--   * accounts_payable       — công nợ phải trả   (init_v3.sql:1629)
--   * procurement_pos        — đặt hàng NCC       (vendor_bidding_phase2_lifecycle.sql:88)
--   * procurement_deliveries — giao hàng NCC      (vendor_bidding_phase2_lifecycle.sql:137)
--   * vendor_accounts        — tài khoản NCC      (vendor_portal_001.sql:15)
--   * app_config             — runtime flag store (key TEXT PK, value JSONB)
--
-- CHAIN = STANDALONE: procurement runs parallel to sourcing, so there is
--    NO revenue_chain / chain_code linkage here. AP is linked only via
--    procurement_po_id + delivery_id + vendor_id.
--
-- Author: Đợt 5 build — 2026-06-19
-- Run on VPS: psql -U scadmin -d songchau_erp -f procurement_ap_001_payables.sql
-- ============================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- 1) accounts_payable — procurement chain link columns.
--    (table already has: supplier_id NOT NULL, po_id (legacy
--     purchase_orders), invoice_number, invoice_date, due_date,
--     amount, currency, exchange_rate, amount_vnd, paid_amount,
--     status, payment_terms, notes, created_by, created_at, updated_at)
--
--    procurement_po_id / delivery_id / vendor_id are the NEW links to
--    the procurement spine. po_id (legacy purchase_orders FK) is left
--    untouched and stays NULL for procurement-sourced AP rows.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE accounts_payable
    ADD COLUMN IF NOT EXISTS procurement_po_id BIGINT REFERENCES procurement_pos(id),
    ADD COLUMN IF NOT EXISTS delivery_id       BIGINT REFERENCES procurement_deliveries(id),
    ADD COLUMN IF NOT EXISTS vendor_id         BIGINT REFERENCES vendor_accounts(id);

-- One AP row per procurement delivery — the idempotency guard the
-- auto-AP hook relies on (insert uses ON CONFLICT DO NOTHING). Partial
-- so legacy / non-procurement AP rows (delivery_id IS NULL) are exempt.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ap_procurement_delivery
    ON accounts_payable (delivery_id)
    WHERE delivery_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ap_procurement_po
    ON accounts_payable (procurement_po_id)
    WHERE procurement_po_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────
-- 2) app_config — seed the runtime gate flag in the OFF state.
--    Mirrors the phase3 phase3_auto_ar_enabled flag. ON CONFLICT
--    DO NOTHING so re-running NEVER flips a flag Thang has already
--    turned on. Default 'false'::jsonb → hook is a no-op until enabled.
-- ─────────────────────────────────────────────────────────────
INSERT INTO app_config (key, value)
VALUES ('procurement_auto_ap_enabled', 'false'::jsonb)
ON CONFLICT (key) DO NOTHING;

COMMIT;
