"""
Employee Productivity API (M40) — Song Chau ERP.

Plan: plans/employee-productivity/PLAN.md §5.3.

Endpoints
---------
GET  /monthly                        — one user × one period (auto-routes
                                        live view vs materialised table)
GET  /department/{department}        — whole-department roll-up
GET  /leaderboard                    — top-N by metric
GET  /user/{user_id}/trend           — N-month trend
POST /recompute                      — admin-only, defers aggregator task

RBAC
----
staff   → own user only
manager → own user + own department
admin   → any
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Literal, Optional

import asyncpg
from fastapi import APIRouter, Body, Depends, HTTPException, Path, Query
from pydantic import BaseModel, Field

from app.core.database import get_db
from app.core.rbac import require_role
from app.core.security import TokenData

logger = logging.getLogger(__name__)
router = APIRouter()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

LEADERBOARD_METRICS: dict[str, str] = {
    "revenue":       "revenue_vnd",
    "orders":        "orders_count",
    "customers":     "new_customers",
    "products":      "new_products",
    "quotes_won":    "quotes_won",
    "deals_closed":  "deals_closed",
    "active_days":   "active_days",
}


async def _current_ict_period(conn: asyncpg.Connection) -> tuple[int, int]:
    row = await conn.fetchrow(
        """
        SELECT EXTRACT(YEAR  FROM (now() AT TIME ZONE 'Asia/Ho_Chi_Minh'))::int AS y,
               EXTRACT(MONTH FROM (now() AT TIME ZONE 'Asia/Ho_Chi_Minh'))::int AS m
        """
    )
    return int(row["y"]), int(row["m"])


async def _is_current_period(conn: asyncpg.Connection, year: int, month: int) -> bool:
    cy, cm = await _current_ict_period(conn)
    return (year, month) == (cy, cm)


async def _get_user_department(conn: asyncpg.Connection, user_id: str) -> Optional[str]:
    return await conn.fetchval(
        "SELECT department FROM users WHERE id = $1::uuid", user_id
    )


def _ensure_self_or_dept_or_admin(
    token_data: TokenData,
    target_user_id: str,
    target_dept: Optional[str],
    actor_dept: Optional[str],
) -> None:
    """Authorisation gate for /monthly and /trend."""
    if token_data.role == "admin":
        return
    if token_data.user_id == target_user_id:
        return
    if token_data.role == "manager" and target_dept and target_dept == actor_dept:
        return
    raise HTTPException(
        status_code=403,
        detail={
            "error": "FORBIDDEN_KPI_ACCESS",
            "message": "Bạn chỉ được xem KPI của bản thân hoặc của phòng mình.",
        },
    )


def _row_to_kpi(row: asyncpg.Record) -> dict[str, Any]:
    """Normalise a kpi row (table or view) into the API response shape."""
    if row is None:
        return {}
    d = dict(row)
    # Numeric types from asyncpg are Decimal — let JSON encoder coerce; we cast
    # to float for the easy ones.
    for k in ("revenue_vnd", "avg_order_value", "leave_days_taken"):
        if d.get(k) is not None:
            d[k] = float(d[k])
    return d


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class RecomputeBody(BaseModel):
    year: int = Field(..., ge=2024, le=2099)
    month: int = Field(..., ge=1, le=12)


# ---------------------------------------------------------------------------
# GET /monthly — one user × one period
# ---------------------------------------------------------------------------

@router.get("/monthly")
async def get_monthly_kpi(
    user_id: Optional[str] = Query(None, description="UUID. Default: caller."),
    year: Optional[int] = Query(None, ge=2024, le=2099),
    month: Optional[int] = Query(None, ge=1, le=12),
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
) -> dict[str, Any]:
    """Return KPI row for (user_id, year, month). Defaults: caller, current period."""
    target_user_id = user_id or token_data.user_id

    if year is None or month is None:
        cy, cm = await _current_ict_period(conn)
        year, month = year or cy, month or cm

    target_dept = await _get_user_department(conn, target_user_id)
    if target_dept is None and target_user_id != token_data.user_id:
        raise HTTPException(status_code=404, detail="Không tìm thấy người dùng.")

    actor_dept = await _get_user_department(conn, token_data.user_id)
    _ensure_self_or_dept_or_admin(token_data, target_user_id, target_dept, actor_dept)

    if await _is_current_period(conn, year, month):
        # Live view — only filter by user_id; the view computes for all users.
        row = await conn.fetchrow(
            """
            SELECT v.*, u.full_name AS user_name, u.email AS user_email
            FROM employee_current_month_kpi v
            JOIN users u ON u.id = v.user_id
            WHERE v.user_id = $1::uuid
            """,
            target_user_id,
        )
    else:
        row = await conn.fetchrow(
            """
            SELECT k.*, u.full_name AS user_name, u.email AS user_email
            FROM employee_monthly_kpi k
            JOIN users u ON u.id = k.user_id
            WHERE k.user_id = $1::uuid
              AND k.period_year  = $2
              AND k.period_month = $3
            """,
            target_user_id, year, month,
        )

    if not row:
        # No row yet → return zeros so the UI can render an empty card.
        full_name = await conn.fetchval(
            "SELECT full_name FROM users WHERE id = $1::uuid", target_user_id
        )
        return {
            "data": {
                "user_id": target_user_id,
                "user_name": full_name,
                "department": target_dept,
                "period": {"year": year, "month": month, "is_final": False},
                "revenue_vnd": 0.0,
                "orders_count": 0,
                "avg_order_value": 0.0,
                "new_customers": 0,
                "new_products": 0,
                "new_supplier_codes": 0,
                "quotes_sent": 0,
                "quotes_won": 0,
                "deals_closed": 0,
                "daily_reports_submitted": 0,
                "leave_days_taken": 0.0,
                "active_days": 0,
                "total_actions": 0,
                "workdays_present": 0,
            },
            "message": "Chưa có dữ liệu KPI cho kỳ này.",
        }

    kpi = _row_to_kpi(row)
    return {
        "data": {
            "user_id": str(kpi["user_id"]),
            "user_name": kpi.get("user_name"),
            "user_email": kpi.get("user_email"),
            "department": kpi.get("department"),
            "period": {
                "year": int(kpi["period_year"]),
                "month": int(kpi["period_month"]),
                "is_final": bool(kpi.get("is_final", False)),
            },
            "revenue_vnd": kpi["revenue_vnd"],
            "orders_count": kpi["orders_count"],
            "avg_order_value": kpi["avg_order_value"],
            "new_customers": kpi["new_customers"],
            "new_products": kpi["new_products"],
            "new_supplier_codes": kpi["new_supplier_codes"],
            "quotes_sent": kpi["quotes_sent"],
            "quotes_won": kpi["quotes_won"],
            "deals_closed": kpi["deals_closed"],
            "daily_reports_submitted": kpi["daily_reports_submitted"],
            "leave_days_taken": kpi["leave_days_taken"],
            "active_days": kpi["active_days"],
            "total_actions": kpi["total_actions"],
            "workdays_present": kpi["workdays_present"],
            "computed_at": (kpi["computed_at"].isoformat()
                            if isinstance(kpi.get("computed_at"), datetime)
                            else kpi.get("computed_at")),
        }
    }


# ---------------------------------------------------------------------------
# GET /department/{department}
# ---------------------------------------------------------------------------

@router.get("/department/{department}")
async def get_department_kpi(
    department: str = Path(..., min_length=1),
    year: Optional[int] = Query(None, ge=2024, le=2099),
    month: Optional[int] = Query(None, ge=1, le=12),
    token_data: TokenData = Depends(require_role("manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
) -> dict[str, Any]:
    """Whole-department KPI table for a period."""
    if year is None or month is None:
        cy, cm = await _current_ict_period(conn)
        year, month = year or cy, month or cm

    if token_data.role == "manager":
        actor_dept = await _get_user_department(conn, token_data.user_id)
        if department != actor_dept:
            raise HTTPException(
                status_code=403,
                detail={
                    "error": "FORBIDDEN_DEPT_ACCESS",
                    "message": "Manager chỉ được xem KPI của phòng mình.",
                },
            )

    if await _is_current_period(conn, year, month):
        rows = await conn.fetch(
            """
            SELECT v.*, u.full_name AS user_name, u.email AS user_email
            FROM employee_current_month_kpi v
            JOIN users u ON u.id = v.user_id
            WHERE v.department = $1
            ORDER BY v.revenue_vnd DESC, u.full_name
            """,
            department,
        )
    else:
        rows = await conn.fetch(
            """
            SELECT k.*, u.full_name AS user_name, u.email AS user_email
            FROM employee_monthly_kpi k
            JOIN users u ON u.id = k.user_id
            WHERE k.department    = $1
              AND k.period_year   = $2
              AND k.period_month  = $3
            ORDER BY k.revenue_vnd DESC, u.full_name
            """,
            department, year, month,
        )

    items = [_row_to_kpi(r) for r in rows]
    # Aggregates for the department card
    totals = {
        "revenue_vnd": sum(i.get("revenue_vnd", 0) or 0 for i in items),
        "orders_count": sum(i.get("orders_count", 0) or 0 for i in items),
        "new_customers": sum(i.get("new_customers", 0) or 0 for i in items),
        "quotes_won": sum(i.get("quotes_won", 0) or 0 for i in items),
        "head_count": len(items),
    }

    return {
        "data": {
            "department": department,
            "period": {"year": year, "month": month},
            "totals": totals,
            "items": [
                {
                    "user_id": str(i["user_id"]),
                    "user_name": i.get("user_name"),
                    "user_email": i.get("user_email"),
                    "revenue_vnd": i.get("revenue_vnd", 0),
                    "orders_count": i.get("orders_count", 0),
                    "avg_order_value": i.get("avg_order_value", 0),
                    "new_customers": i.get("new_customers", 0),
                    "quotes_won": i.get("quotes_won", 0),
                    "deals_closed": i.get("deals_closed", 0),
                    "daily_reports_submitted": i.get("daily_reports_submitted", 0),
                    "leave_days_taken": i.get("leave_days_taken", 0),
                    "active_days": i.get("active_days", 0),
                    "is_final": bool(i.get("is_final", False)),
                }
                for i in items
            ],
        }
    }


# ---------------------------------------------------------------------------
# GET /leaderboard
# ---------------------------------------------------------------------------

@router.get("/leaderboard")
async def get_leaderboard(
    year: Optional[int] = Query(None, ge=2024, le=2099),
    month: Optional[int] = Query(None, ge=1, le=12),
    metric: Literal[
        "revenue", "orders", "customers", "products",
        "quotes_won", "deals_closed", "active_days",
    ] = Query("revenue"),
    department: Optional[str] = Query(None, description="Optional dept filter."),
    limit: int = Query(10, ge=1, le=100),
    token_data: TokenData = Depends(require_role("manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
) -> dict[str, Any]:
    """Top-N users by `metric` for a period. Manager auto-restricted to own dept."""
    if year is None or month is None:
        cy, cm = await _current_ict_period(conn)
        year, month = year or cy, month or cm

    metric_col = LEADERBOARD_METRICS[metric]

    # Restrict manager to their own department.
    actor_dept = await _get_user_department(conn, token_data.user_id)
    if token_data.role == "manager":
        if department and department != actor_dept:
            raise HTTPException(status_code=403, detail="Manager chỉ được xem phòng mình.")
        department = actor_dept

    is_current = await _is_current_period(conn, year, month)
    source = "employee_current_month_kpi" if is_current else "employee_monthly_kpi"

    where_parts = []
    params: list[Any] = []
    if not is_current:
        where_parts.append(f"k.period_year = ${len(params)+1}")
        params.append(year)
        where_parts.append(f"k.period_month = ${len(params)+1}")
        params.append(month)
    if department:
        where_parts.append(f"k.department = ${len(params)+1}")
        params.append(department)
    where_sql = ("WHERE " + " AND ".join(where_parts)) if where_parts else ""

    params.append(limit)
    sql = f"""
        SELECT k.user_id, u.full_name AS user_name, u.email AS user_email,
               k.department,
               k.{metric_col} AS metric_value,
               k.revenue_vnd, k.orders_count, k.new_customers,
               k.quotes_won, k.deals_closed, k.active_days
        FROM {source} k
        JOIN users u ON u.id = k.user_id
        {where_sql}
        ORDER BY k.{metric_col} DESC NULLS LAST, u.full_name
        LIMIT ${len(params)}
    """
    rows = await conn.fetch(sql, *params)

    return {
        "data": {
            "period": {"year": year, "month": month, "is_current": is_current},
            "metric": metric,
            "department": department,
            "items": [
                {
                    "rank": idx + 1,
                    "user_id": str(r["user_id"]),
                    "user_name": r["user_name"],
                    "user_email": r["user_email"],
                    "department": r["department"],
                    "metric_value": float(r["metric_value"] or 0),
                    "revenue_vnd": float(r["revenue_vnd"] or 0),
                    "orders_count": int(r["orders_count"] or 0),
                    "new_customers": int(r["new_customers"] or 0),
                    "quotes_won": int(r["quotes_won"] or 0),
                    "deals_closed": int(r["deals_closed"] or 0),
                    "active_days": int(r["active_days"] or 0),
                }
                for idx, r in enumerate(rows)
            ],
        }
    }


# ---------------------------------------------------------------------------
# GET /user/{user_id}/trend — N-month trend
# ---------------------------------------------------------------------------

@router.get("/user/{user_id}/trend")
async def get_user_trend(
    user_id: str = Path(..., description="UUID."),
    months: int = Query(6, ge=1, le=24),
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
) -> dict[str, Any]:
    """Last N months of KPI for a user. Includes the current period from the
    live view so the chart is up to date."""
    target_dept = await _get_user_department(conn, user_id)
    if target_dept is None and user_id != token_data.user_id:
        raise HTTPException(status_code=404, detail="Không tìm thấy người dùng.")
    actor_dept = await _get_user_department(conn, token_data.user_id)
    _ensure_self_or_dept_or_admin(token_data, user_id, target_dept, actor_dept)

    cy, cm = await _current_ict_period(conn)

    # Past months from the materialised table
    past_rows = await conn.fetch(
        """
        SELECT period_year, period_month,
               revenue_vnd, orders_count, avg_order_value,
               new_customers, new_products, new_supplier_codes,
               quotes_sent, quotes_won, deals_closed,
               daily_reports_submitted, leave_days_taken,
               active_days, total_actions, workdays_present,
               is_final
        FROM employee_monthly_kpi
        WHERE user_id = $1::uuid
          AND period_key >= ($2 * 100 + $3)
          AND period_key <  ($4 * 100 + $5)
        ORDER BY period_year, period_month
        """,
        user_id,
        # months window: (cy, cm) - months ... (cy, cm) exclusive
        *(_window_bounds(cy, cm, months)),
    )

    # Current month from live view (if window covers it)
    current_row = await conn.fetchrow(
        """
        SELECT period_year, period_month,
               revenue_vnd, orders_count, avg_order_value,
               new_customers, new_products, new_supplier_codes,
               quotes_sent, quotes_won, deals_closed,
               daily_reports_submitted, leave_days_taken,
               active_days, total_actions, workdays_present,
               false AS is_final
        FROM employee_current_month_kpi
        WHERE user_id = $1::uuid
        """,
        user_id,
    )

    series = [_row_to_kpi(r) for r in past_rows]
    if current_row:
        series.append(_row_to_kpi(current_row))

    return {
        "data": {
            "user_id": user_id,
            "department": target_dept,
            "months": months,
            "series": [
                {
                    "year": int(s["period_year"]),
                    "month": int(s["period_month"]),
                    "is_final": bool(s.get("is_final", False)),
                    "revenue_vnd": s.get("revenue_vnd", 0),
                    "orders_count": s.get("orders_count", 0),
                    "avg_order_value": s.get("avg_order_value", 0),
                    "new_customers": s.get("new_customers", 0),
                    "new_products": s.get("new_products", 0),
                    "quotes_won": s.get("quotes_won", 0),
                    "deals_closed": s.get("deals_closed", 0),
                    "daily_reports_submitted": s.get("daily_reports_submitted", 0),
                    "leave_days_taken": s.get("leave_days_taken", 0),
                    "active_days": s.get("active_days", 0),
                    "workdays_present": s.get("workdays_present", 0),
                }
                for s in series
            ],
        }
    }


def _window_bounds(cy: int, cm: int, months: int) -> tuple[int, int, int, int]:
    """Compute (start_y, start_m, end_y, end_m) period_key window (end exclusive
    because current month comes from the live view)."""
    # start = cy/cm minus (months-1) months
    sm_total = cy * 12 + (cm - 1) - (months - 1)
    sy = sm_total // 12
    sm = sm_total % 12 + 1
    return (sy, sm, cy, cm)


# ---------------------------------------------------------------------------
# POST /recompute — admin-only ad-hoc recompute
# ---------------------------------------------------------------------------

@router.post("/recompute", status_code=202)
async def recompute_kpi(
    body: RecomputeBody,
    token_data: TokenData = Depends(require_role("admin")),
    conn: asyncpg.Connection = Depends(get_db),
) -> dict[str, Any]:
    """Defer aggregator task for one period. Returns 202 immediately."""
    # Lazy-import so this module doesn't hard-depend on procrastinate at FastAPI
    # startup; the worker may be in a separate process.
    from app.tasks.kpi_aggregator import aggregate_monthly_kpi

    try:
        # Procrastinate ≥ 2.x: tasks expose `.defer_async(**kwargs)`
        await aggregate_monthly_kpi.defer_async(year=body.year, month=body.month)
    except Exception as exc:
        logger.exception("recompute defer failed")
        raise HTTPException(
            status_code=500,
            detail=f"Không thể đẩy task recompute: {exc!s}",
        )

    # Audit
    await conn.execute(
        """
        INSERT INTO audit_log (user_id, action, table_name, record_id, new_data, created_at)
        VALUES ($1::uuid, 'kpi_recompute_requested', 'employee_monthly_kpi',
                $2, $3::jsonb, NOW())
        """,
        token_data.user_id,
        f"{body.year}-{body.month:02d}",
        f'{{"year": {body.year}, "month": {body.month}}}',
    )

    return {
        "data": {"deferred": True, "year": body.year, "month": body.month},
        "message": f"Đã đặt lịch tính lại KPI tháng {body.month}/{body.year}.",
    }
