-- ============================================================
-- Migration: M40 — Employee Productivity (KPI tháng theo nhân viên)
-- Date: 2026-05-06
-- Plan: plans/employee-productivity/PLAN.md §4.1, §4.2, §4.6
-- ============================================================
--
-- Idempotent. Run with:  psql -f m40_employee_kpi.sql "$DATABASE_URL"
--
-- Adds:
--   - Table  employee_monthly_kpi   (materialised, per (user, year, month))
--   - View   employee_current_month_kpi  (live, in-progress month)
--   - Helper indexes on existing tables (sales_orders, customers, products,
--                                        bqms_samsung_po, revenue_chain)
--
-- Notes vs PLAN.md (schema-reality fixes verified against init_v3.sql):
--   * supplier_product_map has no `created_by` column → fallback to audit_log.
--   * bqms_rfq has no `created_by`        → use `result_updated_by` for
--                                            daily_reports authorship.
--   * products / customers have no `created_by` → audit_log fallback (already
--                                                  in plan).
-- ============================================================

BEGIN;

-- ─── 1. employee_monthly_kpi ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS employee_monthly_kpi (
    id                       BIGSERIAL PRIMARY KEY,
    user_id                  UUID NOT NULL REFERENCES users(id),
    department               TEXT,
    period_year              SMALLINT NOT NULL CHECK (period_year BETWEEN 2024 AND 2099),
    period_month             SMALLINT NOT NULL CHECK (period_month BETWEEN 1 AND 12),
    period_key               INT GENERATED ALWAYS AS (period_year * 100 + period_month) STORED,

    -- Revenue (sales_orders.created_by)
    revenue_vnd              NUMERIC(18,2) NOT NULL DEFAULT 0,
    orders_count             INT           NOT NULL DEFAULT 0,
    avg_order_value          NUMERIC(18,2) NOT NULL DEFAULT 0,

    -- Acquisition
    new_customers            INT           NOT NULL DEFAULT 0,
    new_products             INT           NOT NULL DEFAULT 0,
    new_supplier_codes       INT           NOT NULL DEFAULT 0,

    -- Sales activity
    quotes_sent              INT           NOT NULL DEFAULT 0,
    quotes_won               INT           NOT NULL DEFAULT 0,
    deals_closed             INT           NOT NULL DEFAULT 0,

    -- Reports & engagement
    daily_reports_submitted  INT           NOT NULL DEFAULT 0,
    leave_days_taken         NUMERIC(4,1)  NOT NULL DEFAULT 0,
    active_days              INT           NOT NULL DEFAULT 0,
    total_actions            INT           NOT NULL DEFAULT 0,
    workdays_present         INT           NOT NULL DEFAULT 0,

    computed_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_final                 BOOLEAN     NOT NULL DEFAULT false,

    CONSTRAINT uq_emp_kpi_period UNIQUE (user_id, period_year, period_month)
);

COMMENT ON TABLE  employee_monthly_kpi IS
    'M40 — KPI tháng cho từng nhân viên. UPSERT bởi app.tasks.kpi_aggregator.';
COMMENT ON COLUMN employee_monthly_kpi.department IS
    'Snapshot department tại thời điểm tính (nhân viên có thể đổi phòng giữa tháng).';
COMMENT ON COLUMN employee_monthly_kpi.workdays_present IS
    'Mon-Fri trong tháng - leave_days_taken. Chưa trừ ngày lễ (xem M42).';
COMMENT ON COLUMN employee_monthly_kpi.is_final IS
    'true = tháng đã đóng và aggregator đã chạy. false = view động hoặc đang tính.';

CREATE INDEX IF NOT EXISTS idx_emp_kpi_user
    ON employee_monthly_kpi (user_id);
CREATE INDEX IF NOT EXISTS idx_emp_kpi_period_key
    ON employee_monthly_kpi (period_key);
CREATE INDEX IF NOT EXISTS idx_emp_kpi_dept_period
    ON employee_monthly_kpi (department, period_key);
CREATE INDEX IF NOT EXISTS idx_emp_kpi_revenue
    ON employee_monthly_kpi (period_key, revenue_vnd DESC);


-- ─── 2. Helper indexes on existing tables ───────────────────────────
-- Aggregator's main GROUP BY paths.
CREATE INDEX IF NOT EXISTS idx_so_created_by_date
    ON sales_orders (created_by, created_at);

CREATE INDEX IF NOT EXISTS idx_customers_created_at
    ON customers (created_at) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_products_created_at
    ON products (created_at) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_spo_won_by_created
    ON bqms_samsung_po (won_by, created_at) WHERE won_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_rc_completed_at
    ON revenue_chain (completed_at) WHERE is_complete = true;

CREATE INDEX IF NOT EXISTS idx_spm_created_at
    ON supplier_product_map (created_at);

-- Audit-log lookups for INSERT events of customers/products
-- (audit_log is partitioned/indexed already; add a partial covering index)
CREATE INDEX IF NOT EXISTS idx_audit_table_action_created
    ON audit_log (table_name, action, created_at)
    WHERE action = 'INSERT';

-- Exchange-rate lookup used by the revenue CTE LATERAL join.
-- Existing init_v3.sql has (rate_date DESC) and (from_currency, to_currency);
-- composite is faster for the LATERAL probe.
CREATE INDEX IF NOT EXISTS idx_exrate_lookup
    ON exchange_rates (from_currency, to_currency, rate_date DESC);


-- ─── 3. employee_current_month_kpi (live view) ─────────────────────
-- Same column shape as the table (minus id / is_final marker = always false).
-- The aggregator and this view share identical CTE structure; keeping them
-- in lockstep is enforced by an integration test (test_aggregator_view_parity).
DROP VIEW IF EXISTS employee_current_month_kpi;
CREATE VIEW employee_current_month_kpi AS
WITH bounds AS (
    SELECT
        date_trunc('month', NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date          AS d_start,
        (date_trunc('month', NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh') + INTERVAL '1 month')::date AS d_end_excl,
        EXTRACT(YEAR  FROM (NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh'))::SMALLINT     AS y,
        EXTRACT(MONTH FROM (NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh'))::SMALLINT     AS m
),
weekdays_in_month AS (
    SELECT b.y, b.m, COUNT(*)::INT AS wd
    FROM bounds b,
         generate_series(b.d_start, b.d_end_excl - INTERVAL '1 day', INTERVAL '1 day') AS d
    WHERE EXTRACT(ISODOW FROM d) < 6
    GROUP BY b.y, b.m
),
revenue AS (
    -- Multi-currency: convert non-VND via exchange_rates LATERAL.
    SELECT so.created_by AS user_id,
           SUM(
               so.total_amount *
               CASE WHEN so.currency = 'VND' THEN 1
                    ELSE COALESCE(fx.rate, 0) END
           )                 AS revenue_vnd,
           COUNT(*)          AS orders_count
    FROM sales_orders so
    CROSS JOIN bounds b
    LEFT JOIN LATERAL (
        SELECT er.rate
        FROM exchange_rates er
        WHERE er.from_currency = so.currency
          AND er.to_currency   = 'VND'
          AND er.rate_date    <= so.created_at::date
        ORDER BY er.rate_date DESC,
                 (er.rate_type = 'transfer') DESC
        LIMIT 1
    ) fx ON so.currency <> 'VND'
    WHERE so.created_at >= b.d_start
      AND so.created_at <  b.d_end_excl
      AND so.status NOT IN ('draft', 'cancelled')
    GROUP BY so.created_by
),
new_cust AS (
    SELECT al.user_id, COUNT(*)::INT AS n
    FROM audit_log al, bounds b
    WHERE al.table_name = 'customers'
      AND al.action     = 'INSERT'
      AND al.created_at >= b.d_start AND al.created_at < b.d_end_excl
      AND al.user_id IS NOT NULL
    GROUP BY al.user_id
),
new_prod AS (
    SELECT al.user_id, COUNT(*)::INT AS n
    FROM audit_log al, bounds b
    WHERE al.table_name = 'products'
      AND al.action     = 'INSERT'
      AND al.created_at >= b.d_start AND al.created_at < b.d_end_excl
      AND al.user_id IS NOT NULL
    GROUP BY al.user_id
),
new_supp_codes AS (
    -- supplier_product_map has no created_by; use audit_log fallback.
    SELECT al.user_id, COUNT(*)::INT AS n
    FROM audit_log al, bounds b
    WHERE al.table_name = 'supplier_product_map'
      AND al.action     = 'INSERT'
      AND al.created_at >= b.d_start AND al.created_at < b.d_end_excl
      AND al.user_id IS NOT NULL
    GROUP BY al.user_id
),
quotes_sent_cte AS (
    SELECT q.quoted_by AS user_id, COUNT(*)::INT AS n
    FROM bqms_quote_log q, bounds b
    WHERE q.quoted_at >= b.d_start AND q.quoted_at < b.d_end_excl
      AND q.quoted_by IS NOT NULL
    GROUP BY q.quoted_by
),
quotes_won_cte AS (
    SELECT po.won_by AS user_id, COUNT(*)::INT AS n
    FROM bqms_samsung_po po, bounds b
    WHERE po.created_at >= b.d_start AND po.created_at < b.d_end_excl
      AND po.won_by IS NOT NULL
    GROUP BY po.won_by
),
deals_closed_cte AS (
    SELECT rc.created_by AS user_id, COUNT(*)::INT AS n
    FROM revenue_chain rc, bounds b
    WHERE rc.is_complete = true
      AND rc.completed_at >= b.d_start
      AND rc.completed_at <  b.d_end_excl
      AND rc.created_by IS NOT NULL
    GROUP BY rc.created_by
),
daily_reports AS (
    -- bqms_rfq.report = morning summary text. Author = result_updated_by
    -- (the user who last touched the result/report fields). Distinct by date
    -- so multiple edits to the same RFQ on the same day count once.
    SELECT r.result_updated_by AS user_id,
           COUNT(DISTINCT DATE(r.updated_at AT TIME ZONE 'Asia/Ho_Chi_Minh'))::INT AS n
    FROM bqms_rfq r, bounds b
    WHERE r.report IS NOT NULL
      AND r.report ILIKE 'Báo cáo %'
      AND r.updated_at >= b.d_start AND r.updated_at < b.d_end_excl
      AND r.result_updated_by IS NOT NULL
    GROUP BY r.result_updated_by
),
leave_days AS (
    SELECT lr.user_id,
           SUM(
               (SELECT COUNT(*)
                FROM generate_series(GREATEST(lr.start_date, b.d_start),
                                     LEAST(lr.end_date, b.d_end_excl - INTERVAL '1 day'),
                                     INTERVAL '1 day') AS d
                WHERE EXTRACT(ISODOW FROM d) < 6)
               - CASE WHEN lr.half_day_start AND lr.start_date >= b.d_start THEN 0.5 ELSE 0 END
               - CASE WHEN lr.half_day_end   AND lr.end_date   <  b.d_end_excl THEN 0.5 ELSE 0 END
           )::NUMERIC(4,1) AS days
    FROM leave_requests lr, bounds b
    WHERE lr.status = 'approved'
      AND lr.start_date < b.d_end_excl
      AND lr.end_date  >= b.d_start
    GROUP BY lr.user_id
),
activity AS (
    SELECT ual.user_id,
           COUNT(DISTINCT DATE(ual.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh'))::INT AS active_days,
           COUNT(*)::INT AS total_actions
    FROM user_activity_log ual, bounds b
    WHERE ual.created_at >= b.d_start AND ual.created_at < b.d_end_excl
    GROUP BY ual.user_id
)
SELECT
    u.id                                AS user_id,
    u.department                        AS department,
    b.y                                 AS period_year,
    b.m                                 AS period_month,
    (b.y * 100 + b.m)::INT              AS period_key,
    COALESCE(r.revenue_vnd, 0)::NUMERIC(18,2) AS revenue_vnd,
    COALESCE(r.orders_count, 0)::INT          AS orders_count,
    CASE WHEN COALESCE(r.orders_count, 0) > 0
         THEN (r.revenue_vnd / r.orders_count)::NUMERIC(18,2)
         ELSE 0::NUMERIC(18,2) END     AS avg_order_value,
    COALESCE(nc.n,  0)                  AS new_customers,
    COALESCE(np.n,  0)                  AS new_products,
    COALESCE(nsc.n, 0)                  AS new_supplier_codes,
    COALESCE(qs.n,  0)                  AS quotes_sent,
    COALESCE(qw.n,  0)                  AS quotes_won,
    COALESCE(dc.n,  0)                  AS deals_closed,
    COALESCE(dr.n,  0)                  AS daily_reports_submitted,
    COALESCE(ld.days, 0)::NUMERIC(4,1)  AS leave_days_taken,
    COALESCE(act.active_days, 0)        AS active_days,
    COALESCE(act.total_actions, 0)      AS total_actions,
    GREATEST(0, wd.wd - COALESCE(ld.days, 0)::INT) AS workdays_present,
    NOW()                               AS computed_at,
    false                               AS is_final
FROM users u
CROSS JOIN bounds b
CROSS JOIN weekdays_in_month wd
LEFT JOIN revenue          r   ON r.user_id   = u.id
LEFT JOIN new_cust         nc  ON nc.user_id  = u.id
LEFT JOIN new_prod         np  ON np.user_id  = u.id
LEFT JOIN new_supp_codes   nsc ON nsc.user_id = u.id
LEFT JOIN quotes_sent_cte  qs  ON qs.user_id  = u.id
LEFT JOIN quotes_won_cte   qw  ON qw.user_id  = u.id
LEFT JOIN deals_closed_cte dc  ON dc.user_id  = u.id
LEFT JOIN daily_reports    dr  ON dr.user_id  = u.id
LEFT JOIN leave_days       ld  ON ld.user_id  = u.id
LEFT JOIN activity         act ON act.user_id = u.id
WHERE u.deleted_at IS NULL
  AND u.is_active  = true;

COMMENT ON VIEW employee_current_month_kpi IS
    'M40 — KPI tháng đang chạy (Asia/Ho_Chi_Minh). Dùng cho tháng hiện tại; '
    'tháng đã đóng phải đọc từ employee_monthly_kpi.';

COMMIT;
