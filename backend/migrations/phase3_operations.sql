-- ============================================================
-- PHASE 3: Operations Intelligence — Task assignments, stock alerts, profit reports
-- Run on VPS: psql -U scadmin -d songchau_erp -f phase3_operations.sql
-- ============================================================

-- ─── Task Assignments ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS task_assignments (
    id              BIGSERIAL PRIMARY KEY,
    title           TEXT NOT NULL,
    description     TEXT,
    task_type       TEXT NOT NULL
                        CHECK (task_type IN ('rfq_review','po_followup','delivery_prep','invoice_review','general')),
    priority        INT NOT NULL DEFAULT 3
                        CHECK (priority BETWEEN 1 AND 4),
    status          TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','in_progress','completed','cancelled','overdue')),
    assigned_to     UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    assigned_by     UUID REFERENCES users(id) ON DELETE SET NULL,
    due_date        TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    ref_type        TEXT,  -- 'bqms_rfq', 'purchase_orders', 'shipments', etc.
    ref_id          BIGINT,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ta_assigned_to  ON task_assignments(assigned_to);
CREATE INDEX IF NOT EXISTS idx_ta_assigned_by  ON task_assignments(assigned_by);
CREATE INDEX IF NOT EXISTS idx_ta_status       ON task_assignments(status);
CREATE INDEX IF NOT EXISTS idx_ta_priority     ON task_assignments(priority);
CREATE INDEX IF NOT EXISTS idx_ta_due_date     ON task_assignments(due_date) WHERE due_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ta_ref          ON task_assignments(ref_type, ref_id) WHERE ref_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ta_created      ON task_assignments(created_at DESC);

-- ─── Stock Alerts ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stock_alerts (
    id                  BIGSERIAL PRIMARY KEY,
    product_id          BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    alert_type          TEXT NOT NULL
                            CHECK (alert_type IN ('low_stock','out_of_stock','overstock','reorder_suggested')),
    current_qty         NUMERIC(14,3) NOT NULL,
    threshold_qty       NUMERIC(14,3) NOT NULL,
    suggested_order_qty NUMERIC(14,3),
    status              TEXT NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active','acknowledged','resolved')),
    acknowledged_by     UUID REFERENCES users(id) ON DELETE SET NULL,
    resolved_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sa_product_id   ON stock_alerts(product_id);
CREATE INDEX IF NOT EXISTS idx_sa_status       ON stock_alerts(status);
CREATE INDEX IF NOT EXISTS idx_sa_alert_type   ON stock_alerts(alert_type);
CREATE INDEX IF NOT EXISTS idx_sa_created      ON stock_alerts(created_at DESC);
-- Prevent duplicate active alerts for the same product+type
CREATE UNIQUE INDEX IF NOT EXISTS idx_sa_active_unique
    ON stock_alerts(product_id, alert_type)
    WHERE status = 'active';

-- ─── Profit Reports (cached results) ────────────────────────
CREATE TABLE IF NOT EXISTS profit_reports (
    id              BIGSERIAL PRIMARY KEY,
    report_type     TEXT NOT NULL,  -- 'by_deal', 'by_maker', 'by_supplier', 'by_period', 'by_product'
    period_start    DATE,
    period_end      DATE,
    data            JSONB NOT NULL DEFAULT '{}',
    calculated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pr_report_type  ON profit_reports(report_type);
CREATE INDEX IF NOT EXISTS idx_pr_period       ON profit_reports(period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_pr_calculated   ON profit_reports(calculated_at DESC);

-- ─── Auto-update updated_at for task_assignments ─────────────
CREATE OR REPLACE FUNCTION update_task_assignments_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_task_assignments_updated_at ON task_assignments;
CREATE TRIGGER trg_task_assignments_updated_at
    BEFORE UPDATE ON task_assignments
    FOR EACH ROW EXECUTE FUNCTION update_task_assignments_updated_at();
