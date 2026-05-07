"""
M40 KPI Aggregator — monthly per-user KPI materialisation.

Plan: plans/employee-productivity/PLAN.md §5.1, §5.2.

Schedule
--------
@app.periodic(cron="0 19 1 * *")  # day-1 of month, 02:00 ICT == 19:00 UTC prev day
                                  # Procrastinate cron is server-time UTC.

Behaviour
---------
- If `year`/`month` arg omitted → previous calendar month in Asia/Ho_Chi_Minh.
- UPSERT into employee_monthly_kpi (idempotent).
- Mark `is_final = true` only if computed period is strictly before the current
  ICT month.
- Emit one summary row to audit_log with action='kpi_recompute'.

Dependencies
------------
- app.core.procrastinate_app: app, SYNC_DSN
- Sync psycopg2 (consistent with app/tasks/reports.py).
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from typing import Any

import psycopg2
import psycopg2.extras

from app.core.procrastinate_app import app, SYNC_DSN

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Aggregator SQL — same CTE shape as the live view in m40_employee_kpi.sql.
# Parameterised on $1 = year, $2 = month, $3 = is_final.
# ---------------------------------------------------------------------------

AGGREGATOR_SQL = """
INSERT INTO employee_monthly_kpi (
    user_id, department, period_year, period_month,
    revenue_vnd, orders_count, avg_order_value,
    new_customers, new_products, new_supplier_codes,
    quotes_sent, quotes_won, deals_closed,
    daily_reports_submitted, leave_days_taken,
    active_days, total_actions, workdays_present,
    late_count, total_late_minutes,
    is_final, computed_at
)
WITH bounds AS (
    SELECT make_date(%(y)s, %(m)s, 1)                             AS d_start,
           (make_date(%(y)s, %(m)s, 1) + INTERVAL '1 month')::date AS d_end_excl,
           %(y)s::SMALLINT AS y,
           %(m)s::SMALLINT AS m
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
           SUM(
               so.total_amount *
               CASE WHEN so.currency = 'VND' THEN 1
                    ELSE COALESCE(fx.rate, 0) END
           )                 AS revenue_vnd,
           COUNT(*)          AS orders_count,
           COUNT(*) FILTER (WHERE so.currency <> 'VND' AND fx.rate IS NULL) AS missing_fx
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
    SELECT r.result_updated_by AS user_id,
           COUNT(DISTINCT DATE(r.updated_at AT TIME ZONE 'Asia/Ho_Chi_Minh'))::INT AS n
    FROM bqms_rfq r, bounds b
    WHERE r.report IS NOT NULL
      AND r.report ILIKE 'Báo cáo %%'
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
    -- M41: late arrivals per month. early_leave/no_show counted in their own
    -- columns later if needed; for now KPI surfaces only "late" totals.
    SELECT ai.user_id,
           COUNT(*) FILTER (WHERE ai.incident_type = 'late')::INT AS late_count,
           COALESCE(SUM(ai.minutes_off) FILTER (WHERE ai.incident_type = 'late'), 0)::INT
                                                                  AS total_late_minutes
    FROM attendance_incidents ai, bounds b
    WHERE ai.incident_date >= b.d_start AND ai.incident_date < b.d_end_excl
    GROUP BY ai.user_id
)
SELECT
    u.id, u.department, b.y, b.m,
    COALESCE(r.revenue_vnd, 0),
    COALESCE(r.orders_count, 0),
    CASE WHEN COALESCE(r.orders_count, 0) > 0
         THEN r.revenue_vnd / r.orders_count
         ELSE 0 END,
    COALESCE(nc.n,  0),
    COALESCE(np.n,  0),
    COALESCE(nsc.n, 0),
    COALESCE(qs.n,  0),
    COALESCE(qw.n,  0),
    COALESCE(dc.n,  0),
    COALESCE(dr.n,  0),
    COALESCE(ld.days, 0),
    COALESCE(act.active_days,   0),
    COALESCE(act.total_actions, 0),
    GREATEST(0, wd.wd - COALESCE(ld.days, 0)::INT),
    COALESCE(lc.late_count,         0),
    COALESCE(lc.total_late_minutes, 0),
    %(is_final)s::BOOLEAN,
    NOW()
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
ON CONFLICT (user_id, period_year, period_month) DO UPDATE SET
    department              = EXCLUDED.department,
    revenue_vnd             = EXCLUDED.revenue_vnd,
    orders_count            = EXCLUDED.orders_count,
    avg_order_value         = EXCLUDED.avg_order_value,
    new_customers           = EXCLUDED.new_customers,
    new_products            = EXCLUDED.new_products,
    new_supplier_codes      = EXCLUDED.new_supplier_codes,
    quotes_sent             = EXCLUDED.quotes_sent,
    quotes_won              = EXCLUDED.quotes_won,
    deals_closed            = EXCLUDED.deals_closed,
    daily_reports_submitted = EXCLUDED.daily_reports_submitted,
    leave_days_taken        = EXCLUDED.leave_days_taken,
    active_days             = EXCLUDED.active_days,
    total_actions           = EXCLUDED.total_actions,
    workdays_present        = EXCLUDED.workdays_present,
    late_count              = EXCLUDED.late_count,
    total_late_minutes      = EXCLUDED.total_late_minutes,
    is_final                = EXCLUDED.is_final,
    computed_at             = EXCLUDED.computed_at
RETURNING (xmax = 0) AS inserted;
"""


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _resolve_period(cur) -> tuple[int, int]:
    """Return (year, month) of the previous calendar month in Asia/Ho_Chi_Minh."""
    cur.execute(
        """
        SELECT EXTRACT(YEAR  FROM (now() AT TIME ZONE 'Asia/Ho_Chi_Minh' - INTERVAL '1 month'))::int,
               EXTRACT(MONTH FROM (now() AT TIME ZONE 'Asia/Ho_Chi_Minh' - INTERVAL '1 month'))::int
        """
    )
    y, m = cur.fetchone()
    return int(y), int(m)


def _is_past_month(cur, year: int, month: int) -> bool:
    """True if (year, month) is strictly before the current ICT month."""
    cur.execute(
        """
        SELECT (make_date(%s, %s, 1)
                < date_trunc('month', now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date)
        """,
        (year, month),
    )
    return bool(cur.fetchone()[0])


def _missing_fx_orders(cur, year: int, month: int) -> list[int]:
    """Return order IDs in the period whose currency conversion failed."""
    cur.execute(
        """
        SELECT so.id
        FROM sales_orders so
        WHERE so.created_at >= make_date(%s, %s, 1)
          AND so.created_at <  (make_date(%s, %s, 1) + INTERVAL '1 month')
          AND so.status NOT IN ('draft', 'cancelled')
          AND so.currency <> 'VND'
          AND NOT EXISTS (
              SELECT 1 FROM exchange_rates er
              WHERE er.from_currency = so.currency
                AND er.to_currency   = 'VND'
                AND er.rate_date    <= so.created_at::date
          )
        LIMIT 100
        """,
        (year, month, year, month),
    )
    return [row[0] for row in cur.fetchall()]


# ---------------------------------------------------------------------------
# Periodic task — 02:00 ICT on day-1 of each month  (= 19:00 UTC prev day)
# ---------------------------------------------------------------------------

@app.periodic(cron="0 19 1 * *")
@app.task(name="aggregate_monthly_kpi", queue="reports")
def aggregate_monthly_kpi(
    timestamp: int = 0,
    *,
    year: int | None = None,
    month: int | None = None,
) -> dict[str, Any]:
    """
    Materialise employee_monthly_kpi for one period.

    Args:
        timestamp: injected by Procrastinate periodic dispatcher (unix epoch).
        year/month: explicit override (admin recompute). When omitted → previous
                    calendar month in Asia/Ho_Chi_Minh.

    Returns:
        Summary dict {year, month, rows_upserted, duration_ms, is_final, missing_fx}.
    """
    started = time.monotonic()
    started_at = datetime.now(timezone.utc)

    conn = psycopg2.connect(SYNC_DSN)
    try:
        with conn:
            with conn.cursor() as cur:
                # Resolve period if not supplied
                if year is None or month is None:
                    year, month = _resolve_period(cur)

                if not (1 <= month <= 12):
                    raise ValueError(f"month must be 1..12, got {month}")
                if not (2024 <= year <= 2099):
                    raise ValueError(f"year out of range, got {year}")

                is_final = _is_past_month(cur, year, month)

                logger.info(
                    "aggregate_monthly_kpi: year=%s month=%s is_final=%s started_at=%s",
                    year, month, is_final, started_at.isoformat(),
                )

                # Run the UPSERT
                cur.execute(
                    AGGREGATOR_SQL,
                    {"y": year, "m": month, "is_final": is_final},
                )
                affected = cur.rowcount  # users touched (insert + update both counted)

                # Detect missing FX rates for non-VND orders (warn, do not fail)
                missing_fx = _missing_fx_orders(cur, year, month)

                duration_ms = int((time.monotonic() - started) * 1000)

                # Single audit row
                cur.execute(
                    """
                    INSERT INTO audit_log
                        (user_id, action, table_name, record_id, new_data, created_at)
                    VALUES (
                        NULL,
                        %s,
                        'employee_monthly_kpi',
                        %s,
                        %s::jsonb,
                        NOW()
                    )
                    """,
                    (
                        "kpi_recompute_warning" if missing_fx else "kpi_recompute",
                        f"{year}-{month:02d}",
                        psycopg2.extras.Json({
                            "year": year,
                            "month": month,
                            "is_final": is_final,
                            "rows_upserted": affected,
                            "duration_ms": duration_ms,
                            "missing_fx_order_ids": missing_fx[:50],  # cap
                            "missing_fx_total": len(missing_fx),
                        }),
                    ),
                )
    finally:
        conn.close()

    summary = {
        "year": year,
        "month": month,
        "is_final": is_final,
        "rows_upserted": affected,
        "duration_ms": duration_ms,
        "missing_fx_count": len(missing_fx),
    }
    logger.info("aggregate_monthly_kpi: done %s", summary)
    return summary
