-- ============================================================
-- Migration: M41 — Attendance & Leave Management
-- Date: 2026-05-06
-- Plan: plans/employee-productivity/PLAN.md §4.3, §4.4, §4.5, §14
--
-- This file does TWO things that cannot both run in the same transaction:
--   PART A — non-transactional ENUM additions (Postgres requires ALTER TYPE
--             ... ADD VALUE outside any open transaction).
--   PART B — transactional schema (tables, ALTERs, indexes, view).
--
-- Run with:
--   psql "$DATABASE_URL" -f m41_attendance_leave.sql
--
-- Idempotent: every CREATE / ALTER uses IF NOT EXISTS guards. Re-running is
-- safe and produces no rows in pg_event_log.
-- ============================================================

-- ─── PART A — ENUM extensions (no BEGIN/COMMIT) ────────────────────
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'leave_request';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'leave_approved';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'leave_rejected';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'leave_cancelled';

-- ─── PART B — schema in a single transaction ─────────────────────
BEGIN;

-- ─── 1. system_config seeds (work hours) ────────────────────────────
INSERT INTO system_config (key, value, notes)
VALUES ('work_start_time', '08:00', 'Giờ vào làm chuẩn (HH:MM, 24h, Asia/Ho_Chi_Minh)'),
       ('work_end_time',   '17:00', 'Giờ tan ca chuẩn (HH:MM, 24h, Asia/Ho_Chi_Minh)')
ON CONFLICT (key) DO NOTHING;


-- ─── 2. leave_policy ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leave_policy (
    id                       BIGSERIAL PRIMARY KEY,
    role                     role_enum,                  -- NULL = match any role
    department               TEXT,                       -- NULL = match any dept
    annual_days              NUMERIC(4,1) NOT NULL DEFAULT 12,
    sick_days                NUMERIC(4,1) NOT NULL DEFAULT 30,
    personal_days            NUMERIC(4,1) NOT NULL DEFAULT 3,
    maternity_days           NUMERIC(4,1) NOT NULL DEFAULT 180,
    carry_over_max_days      NUMERIC(4,1) NOT NULL DEFAULT 0,
    notes                    TEXT,
    is_active                BOOLEAN NOT NULL DEFAULT true,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- PG16 NULLS NOT DISTINCT: unique coi NULL=NULL (global default role/dept NULL là 1).
-- Tránh COALESCE(role::text,'') vì enum::text trong index expr bị "must be marked IMMUTABLE".
CREATE UNIQUE INDEX IF NOT EXISTS uq_leave_policy_role_dept
    ON leave_policy (role, department) NULLS NOT DISTINCT;

DROP TRIGGER IF EXISTS trg_lp_updated_at ON leave_policy;
CREATE TRIGGER trg_lp_updated_at
    BEFORE UPDATE ON leave_policy
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Seed global default
INSERT INTO leave_policy (role, department, annual_days, sick_days, personal_days, maternity_days, notes)
SELECT NULL, NULL, 12, 30, 3, 180, 'Chính sách phép mặc định toàn công ty'
WHERE NOT EXISTS (SELECT 1 FROM leave_policy WHERE role IS NULL AND department IS NULL);

-- Lookup function: best-match precedence (role+dept > role > dept > global)
CREATE OR REPLACE FUNCTION get_leave_policy(p_user UUID)
RETURNS leave_policy AS $$
    SELECT lp.*
    FROM users u
    JOIN leave_policy lp
      ON ((lp.role       = u.role)       OR lp.role       IS NULL)
     AND ((lp.department = u.department) OR lp.department IS NULL)
    WHERE u.id = p_user
      AND lp.is_active = true
    ORDER BY (lp.role IS NOT NULL)::int DESC,
             (lp.department IS NOT NULL)::int DESC
    LIMIT 1;
$$ LANGUAGE sql STABLE;


-- ─── 3. leave_requests — extend existing table ──────────────────────
ALTER TABLE leave_requests
    ADD COLUMN IF NOT EXISTS department         TEXT,
    ADD COLUMN IF NOT EXISTS rejected_by        UUID REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS rejected_at        TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS cancelled_by       UUID REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS cancelled_at       TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS decision_note      TEXT,
    ADD COLUMN IF NOT EXISTS half_day_start     BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS half_day_end       BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Half-day-aware days_count check: > 0 and a multiple of 0.5
ALTER TABLE leave_requests DROP CONSTRAINT IF EXISTS chk_lr_days_count;
ALTER TABLE leave_requests
    ADD CONSTRAINT chk_lr_days_count
    CHECK (days_count > 0 AND days_count = ROUND(days_count * 2) / 2);

ALTER TABLE leave_requests DROP CONSTRAINT IF EXISTS chk_lr_dates;
ALTER TABLE leave_requests
    ADD CONSTRAINT chk_lr_dates
    CHECK (start_date <= end_date);

CREATE INDEX IF NOT EXISTS idx_lr_dept_status
    ON leave_requests (department, status);
CREATE INDEX IF NOT EXISTS idx_lr_user_year
    ON leave_requests (user_id, start_date);
CREATE INDEX IF NOT EXISTS idx_lr_status_open
    ON leave_requests (status) WHERE status = 'pending';

DROP TRIGGER IF EXISTS trg_lr_updated_at ON leave_requests;
CREATE TRIGGER trg_lr_updated_at
    BEFORE UPDATE ON leave_requests
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ─── 4. leave_balance ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leave_balance (
    id              BIGSERIAL PRIMARY KEY,
    user_id         UUID NOT NULL REFERENCES users(id),
    period_year     SMALLINT NOT NULL CHECK (period_year BETWEEN 2024 AND 2099),
    -- "used" counters: incremented on approve, decremented on cancel-after-approve.
    annual_used     NUMERIC(4,1) NOT NULL DEFAULT 0,
    sick_used       NUMERIC(4,1) NOT NULL DEFAULT 0,
    personal_used   NUMERIC(4,1) NOT NULL DEFAULT 0,
    maternity_used  NUMERIC(4,1) NOT NULL DEFAULT 0,
    other_used      NUMERIC(4,1) NOT NULL DEFAULT 0,
    -- Snapshot of the policy at first allocation (so a mid-year role change
    -- doesn't silently change the user's total).
    annual_total    NUMERIC(4,1) NOT NULL DEFAULT 12,
    sick_total      NUMERIC(4,1) NOT NULL DEFAULT 30,
    personal_total  NUMERIC(4,1) NOT NULL DEFAULT 3,
    maternity_total NUMERIC(4,1) NOT NULL DEFAULT 180,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, period_year)
);
CREATE INDEX IF NOT EXISTS idx_lb_user ON leave_balance (user_id);

DROP TRIGGER IF EXISTS trg_lb_updated_at ON leave_balance;
CREATE TRIGGER trg_lb_updated_at
    BEFORE UPDATE ON leave_balance
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ─── 5. attendance_incidents (new) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS attendance_incidents (
    id              BIGSERIAL PRIMARY KEY,
    user_id         UUID NOT NULL REFERENCES users(id),
    department      TEXT,                                 -- snapshot
    incident_date   DATE NOT NULL,
    incident_type   TEXT NOT NULL
                       CHECK (incident_type IN ('late', 'early_leave', 'no_show')),
    expected_time   TIME,                                 -- NULL for no_show
    actual_time     TIME,                                 -- NULL for no_show
    minutes_off     INT  NOT NULL CHECK (minutes_off >= 0),
    reason          TEXT,
    created_by      UUID NOT NULL REFERENCES users(id),
    acknowledged_by UUID REFERENCES users(id),
    acknowledged_at TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, incident_date, incident_type)
);

CREATE INDEX IF NOT EXISTS idx_ai_user_date ON attendance_incidents (user_id, incident_date DESC);
CREATE INDEX IF NOT EXISTS idx_ai_dept_date ON attendance_incidents (department, incident_date DESC);
CREATE INDEX IF NOT EXISTS idx_ai_type_date ON attendance_incidents (incident_type, incident_date DESC);
CREATE INDEX IF NOT EXISTS idx_ai_unacked   ON attendance_incidents (department) WHERE acknowledged_at IS NULL;

DROP TRIGGER IF EXISTS trg_ai_updated_at ON attendance_incidents;
CREATE TRIGGER trg_ai_updated_at
    BEFORE UPDATE ON attendance_incidents
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ─── 6. employee_monthly_kpi — gain late_count + total_late_minutes ─
ALTER TABLE employee_monthly_kpi
    ADD COLUMN IF NOT EXISTS late_count          INT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS total_late_minutes  INT NOT NULL DEFAULT 0;


-- ─── 7. Replace the live view to include attendance metrics ─────────
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
    SELECT so.created_by AS user_id,
           SUM(so.total_amount * CASE WHEN so.currency = 'VND' THEN 1
                                      ELSE COALESCE(fx.rate, 0) END) AS revenue_vnd,
           COUNT(*)                                                  AS orders_count
    FROM sales_orders so
    CROSS JOIN bounds b
    LEFT JOIN LATERAL (
        SELECT er.rate FROM exchange_rates er
        WHERE er.from_currency = so.currency
          AND er.to_currency   = 'VND'
          AND er.rate_date    <= so.created_at::date
        ORDER BY er.rate_date DESC, (er.rate_type = 'transfer') DESC
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
    WHERE al.table_name = 'customers' AND al.action = 'INSERT'
      AND al.created_at >= b.d_start AND al.created_at < b.d_end_excl
      AND al.user_id IS NOT NULL
    GROUP BY al.user_id
),
new_prod AS (
    SELECT al.user_id, COUNT(*)::INT AS n
    FROM audit_log al, bounds b
    WHERE al.table_name = 'products' AND al.action = 'INSERT'
      AND al.created_at >= b.d_start AND al.created_at < b.d_end_excl
      AND al.user_id IS NOT NULL
    GROUP BY al.user_id
),
new_supp_codes AS (
    SELECT al.user_id, COUNT(*)::INT AS n
    FROM audit_log al, bounds b
    WHERE al.table_name = 'supplier_product_map' AND al.action = 'INSERT'
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
      AND rc.completed_at >= b.d_start AND rc.completed_at < b.d_end_excl
      AND rc.created_by IS NOT NULL
    GROUP BY rc.created_by
),
daily_reports AS (
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
),
late_cte AS (
    SELECT ai.user_id,
           COUNT(*) FILTER (WHERE ai.incident_type = 'late')::INT AS late_count,
           COALESCE(SUM(ai.minutes_off) FILTER (WHERE ai.incident_type = 'late'), 0)::INT
                                                                  AS total_late_minutes
    FROM attendance_incidents ai, bounds b
    WHERE ai.incident_date >= b.d_start AND ai.incident_date < b.d_end_excl
    GROUP BY ai.user_id
)
SELECT
    u.id                                     AS user_id,
    u.department                             AS department,
    b.y                                      AS period_year,
    b.m                                      AS period_month,
    (b.y * 100 + b.m)::INT                   AS period_key,
    COALESCE(r.revenue_vnd, 0)::NUMERIC(18,2) AS revenue_vnd,
    COALESCE(r.orders_count, 0)::INT          AS orders_count,
    CASE WHEN COALESCE(r.orders_count, 0) > 0
         THEN (r.revenue_vnd / r.orders_count)::NUMERIC(18,2)
         ELSE 0::NUMERIC(18,2) END           AS avg_order_value,
    COALESCE(nc.n,  0)                       AS new_customers,
    COALESCE(np.n,  0)                       AS new_products,
    COALESCE(nsc.n, 0)                       AS new_supplier_codes,
    COALESCE(qs.n,  0)                       AS quotes_sent,
    COALESCE(qw.n,  0)                       AS quotes_won,
    COALESCE(dc.n,  0)                       AS deals_closed,
    COALESCE(dr.n,  0)                       AS daily_reports_submitted,
    COALESCE(ld.days, 0)::NUMERIC(4,1)       AS leave_days_taken,
    COALESCE(act.active_days, 0)             AS active_days,
    COALESCE(act.total_actions, 0)           AS total_actions,
    GREATEST(0, wd.wd - COALESCE(ld.days, 0)::INT) AS workdays_present,
    COALESCE(lc.late_count, 0)               AS late_count,
    COALESCE(lc.total_late_minutes, 0)       AS total_late_minutes,
    NOW()                                    AS computed_at,
    false                                    AS is_final
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
LEFT JOIN late_cte         lc  ON lc.user_id  = u.id
WHERE u.deleted_at IS NULL
  AND u.is_active  = true;

COMMIT;
