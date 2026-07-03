-- ============================================================
-- phase3_chain_activation.sql
--
-- PHASE 3 — Đơn ↔ PO ↔ Giao hàng ↔ Tài chính event spine
--           + auto công nợ (AR) + unified dashboard view.
--
-- ⚠️ STAGED MIGRATION — additive + IDEMPOTENT. Safe to run later.
--    This migration ONLY adds columns / indexes / a read-only VIEW.
--    It does NOT alter any data, drop anything, or change any
--    existing column. Running it does NOT by itself change financial
--    behavior — the auto-AR write path is gated behind the
--    PHASE3_AUTO_AR_ENABLED application flag (default FALSE).
--
-- REUSES the existing event spine (do NOT recreate):
--   * revenue_chain        — deal-level linker  (phase2_revenue_chain.sql)
--   * domain_events        — central event bus  (phase2_revenue_chain.sql)
--   * accounts_receivable  — công nợ phải thu   (init_v3.sql:1654)
--
-- Author: Phase 3 build — 2026-06-17
-- Run on VPS: psql -U scadmin -d songchau_erp -f phase3_chain_activation.sql
-- ============================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- 1) accounts_receivable — Phase-3 chain link columns
--    (table already has: customer_id, invoice_id, sales_order_id,
--     invoice_number, invoice_date, due_date, amount, currency,
--     paid_amount, status, notes, created_by, created_at, updated_at)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE accounts_receivable
    ADD COLUMN IF NOT EXISTS sourcing_order_id   BIGINT,
    ADD COLUMN IF NOT EXISTS payment_request_id  BIGINT,
    ADD COLUMN IF NOT EXISTS delivery_id         BIGINT,
    ADD COLUMN IF NOT EXISTS chain_code          TEXT;

-- One AR row per sourcing order — the idempotency guard the auto-AR
-- hook relies on (ensure_ar_for_order uses ON CONFLICT DO NOTHING).
CREATE UNIQUE INDEX IF NOT EXISTS uq_ar_sourcing_order
    ON accounts_receivable (sourcing_order_id)
    WHERE sourcing_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ar_chain_code
    ON accounts_receivable (chain_code)
    WHERE chain_code IS NOT NULL;

-- ─────────────────────────────────────────────────────────────
-- 2) sourcing_orders — chain anchor + Samsung PO ref + AR back-ref
-- ─────────────────────────────────────────────────────────────
ALTER TABLE sourcing_orders
    ADD COLUMN IF NOT EXISTS chain_code             TEXT,
    ADD COLUMN IF NOT EXISTS samsung_po_number      TEXT,
    ADD COLUMN IF NOT EXISTS accounts_receivable_id BIGINT;

CREATE INDEX IF NOT EXISTS idx_so_chain_code
    ON sourcing_orders (chain_code)
    WHERE chain_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_so_samsung_po
    ON sourcing_orders (samsung_po_number)
    WHERE samsung_po_number IS NOT NULL;

-- ─────────────────────────────────────────────────────────────
-- 3) bqms_deliveries — link to sourcing order + chain, index po_number
-- ─────────────────────────────────────────────────────────────
ALTER TABLE bqms_deliveries
    ADD COLUMN IF NOT EXISTS sourcing_order_id BIGINT,
    ADD COLUMN IF NOT EXISTS chain_code        TEXT;

CREATE INDEX IF NOT EXISTS idx_bd_po_number
    ON bqms_deliveries (po_number)
    WHERE po_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bd_sourcing_order
    ON bqms_deliveries (sourcing_order_id)
    WHERE sourcing_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bd_chain_code
    ON bqms_deliveries (chain_code)
    WHERE chain_code IS NOT NULL;

-- ─────────────────────────────────────────────────────────────
-- 4) purchase_orders — link to sourcing order
-- ─────────────────────────────────────────────────────────────
ALTER TABLE purchase_orders
    ADD COLUMN IF NOT EXISTS sourcing_order_id BIGINT;

CREATE INDEX IF NOT EXISTS idx_po_sourcing_order
    ON purchase_orders (sourcing_order_id)
    WHERE sourcing_order_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────
-- 5) v_unified_orders — read-only unified dashboard view.
--    Anchored on sourcing_orders (the ERP-side order). LEFT JOINs
--    everything else so a row appears even when downstream artifacts
--    (PO / delivery / AR / chain) do not yet exist. Defensive COALESCE
--    so the dashboard never sees NULL where a sensible default exists.
--
--    Joins:
--      sourcing_orders  so   (anchor)
--      revenue_chain    rc   ON rc.chain_code = so.chain_code
--      accounts_receivable ar ON ar.sourcing_order_id = so.id  (unique)
--      purchase_orders  po   ON po.sourcing_order_id = so.id   (latest)
--      bqms_deliveries  bd   ON bd.sourcing_order_id = so.id   (aggregate)
--      customers        c    ON c.id = so.customer_id
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW v_unified_orders AS
SELECT
    so.id                                       AS order_id,
    so.order_number                             AS order_ref,
    so.chain_code                               AS chain_code,
    so.source_type                              AS source_type,
    so.samsung_po_number                        AS samsung_po_number,

    -- Customer (snapshot name on the order is authoritative; fall back to
    -- the linked customer record)
    COALESCE(NULLIF(so.customer_name, ''), c.company_name, '—') AS customer_name,
    so.customer_id                              AS customer_id,

    -- Order snapshot
    so.status                                   AS order_status,
    so.order_date                               AS order_date,
    so.delivery_date                            AS delivery_date,
    so.payment_terms                            AS payment_terms,
    so.currency                                 AS currency,
    COALESCE(so.total_value_vnd, 0)             AS revenue_vnd,
    so.assigned_to                              AS assigned_to,
    so.created_by_email                         AS created_by_email,
    so.updated_at                               AS order_updated_at,

    -- Revenue chain stage snapshot (additive — present once spine is active)
    rc.current_stage                            AS chain_stage,
    rc.is_complete                              AS chain_complete,
    COALESCE(rc.revenue_vnd, so.total_value_vnd, 0) AS chain_revenue_vnd,
    rc.margin_pct                               AS chain_margin_pct,

    -- Purchase order snapshot (latest PO linked to the order)
    po.id                                       AS po_id,
    po.po_number                                AS po_number,
    po.status::text                             AS po_status,

    -- Delivery roll-up (Samsung BQMS side)
    bd.delivery_count                           AS delivery_count,
    bd.delivered_count                          AS delivered_count,
    bd.last_delivery_status                     AS last_delivery_status,
    bd.last_delivery_date                       AS last_delivery_date,

    -- Accounts receivable (công nợ) snapshot — 1 AR per order
    ar.id                                       AS ar_id,
    ar.status::text                             AS ar_status,
    COALESCE(ar.amount, 0)                      AS ar_amount,
    COALESCE(ar.paid_amount, 0)                 AS ar_paid_amount,
    COALESCE(ar.amount, 0) - COALESCE(ar.paid_amount, 0) AS ar_outstanding,
    ar.due_date                                 AS ar_due_date,
    CASE
        WHEN ar.id IS NULL                                    THEN 'none'
        WHEN ar.status::text = 'paid'                         THEN 'paid'
        WHEN ar.due_date IS NOT NULL AND ar.due_date < CURRENT_DATE
             AND ar.status::text <> 'paid'                    THEN 'overdue'
        ELSE 'open'
    END                                         AS ar_state
FROM sourcing_orders so
LEFT JOIN customers c
       ON c.id = so.customer_id
LEFT JOIN revenue_chain rc
       ON rc.chain_code = so.chain_code
      AND so.chain_code IS NOT NULL
LEFT JOIN accounts_receivable ar
       ON ar.sourcing_order_id = so.id
LEFT JOIN LATERAL (
        SELECT p.id, p.po_number, p.status
          FROM purchase_orders p
         WHERE p.sourcing_order_id = so.id
         ORDER BY p.created_at DESC, p.id DESC
         LIMIT 1
     ) po ON TRUE
LEFT JOIN LATERAL (
        SELECT
            COUNT(*)                                            AS delivery_count,
            COUNT(*) FILTER (WHERE d.delivery_status = 'da_giao') AS delivered_count,
            (ARRAY_AGG(d.delivery_status::text ORDER BY d.updated_at DESC))[1] AS last_delivery_status,
            MAX(d.delivery_date)                                AS last_delivery_date
          FROM bqms_deliveries d
         WHERE d.sourcing_order_id = so.id
     ) bd ON TRUE
WHERE so.deleted_at IS NULL;

COMMENT ON VIEW v_unified_orders IS
    'Phase 3 — unified order spine: sourcing_orders ⨝ revenue_chain ⨝ purchase_orders ⨝ bqms_deliveries ⨝ accounts_receivable (read-only).';

COMMIT;
