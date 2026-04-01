"""
Profit Analysis API (M13) — Revenue, cost, and margin analytics across deals,
makers, suppliers, periods, and products. Reads from deal_margins + related tables.
"""

from __future__ import annotations

from datetime import date, timedelta
from fastapi import APIRouter, Depends, Query
import asyncpg

from app.core.database import get_db
from app.core.rbac import require_role
from app.core.security import TokenData

router = APIRouter()


# ---------------------------------------------------------------------------
# Helper: date range from months parameter
# ---------------------------------------------------------------------------

def _date_range(months: int) -> tuple[date, date]:
    end = date.today()
    # Approximate: 30 days per month
    start = end - timedelta(days=months * 30)
    return start, end


# ---------------------------------------------------------------------------
# GET /overview — Overall profit KPIs
# ---------------------------------------------------------------------------

@router.get("/overview")
async def profit_overview(
    months: int = Query(6, ge=1, le=36, description="Số tháng nhìn lại"),
    token_data: TokenData = Depends(require_role("manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """
    Top-level KPIs:
    - Total revenue (sum revenue_vnd)
    - Total cost (sum total_cost_vnd)
    - Gross profit (sum gross_profit_vnd)
    - Average margin %
    - Best and worst performing deals
    - Deal count
    """
    start, end = _date_range(months)

    summary = await conn.fetchrow(
        """
        SELECT
            COUNT(*)                                   AS deal_count,
            COALESCE(SUM(dm.revenue_vnd), 0)           AS total_revenue_vnd,
            COALESCE(SUM(dm.total_cost_vnd), 0)        AS total_cost_vnd,
            COALESCE(SUM(dm.gross_profit_vnd), 0)      AS total_gross_profit_vnd,
            COALESCE(AVG(dm.margin_pct), 0)            AS avg_margin_pct,
            COALESCE(MAX(dm.margin_pct), 0)            AS best_margin_pct,
            COALESCE(MIN(dm.margin_pct), 0)            AS worst_margin_pct
        FROM deal_margins dm
        WHERE dm.created_at >= $1
          AND dm.created_at <= $2
        """,
        start,
        end,
    )

    # Best deal detail
    best_deal = await conn.fetchrow(
        """
        SELECT dm.chain_code, dm.margin_pct, dm.gross_profit_vnd, dm.revenue_vnd,
               so.order_number
        FROM deal_margins dm
        LEFT JOIN sales_orders so ON so.id = dm.sales_order_id
        WHERE dm.created_at >= $1 AND dm.created_at <= $2
        ORDER BY dm.margin_pct DESC
        LIMIT 1
        """,
        start,
        end,
    )

    # Worst deal detail
    worst_deal = await conn.fetchrow(
        """
        SELECT dm.chain_code, dm.margin_pct, dm.gross_profit_vnd, dm.revenue_vnd,
               so.order_number
        FROM deal_margins dm
        LEFT JOIN sales_orders so ON so.id = dm.sales_order_id
        WHERE dm.created_at >= $1 AND dm.created_at <= $2
        ORDER BY dm.margin_pct ASC
        LIMIT 1
        """,
        start,
        end,
    )

    # Profitable vs unprofitable count
    profitable_count = await conn.fetchval(
        """
        SELECT COUNT(*) FROM deal_margins
        WHERE gross_profit_vnd > 0
          AND created_at >= $1 AND created_at <= $2
        """,
        start,
        end,
    )

    return {
        "data": {
            "period": {"months": months, "from": str(start), "to": str(end)},
            "kpis": {
                "deal_count": int(summary["deal_count"] or 0),
                "total_revenue_vnd": float(summary["total_revenue_vnd"] or 0),
                "total_cost_vnd": float(summary["total_cost_vnd"] or 0),
                "total_gross_profit_vnd": float(summary["total_gross_profit_vnd"] or 0),
                "avg_margin_pct": round(float(summary["avg_margin_pct"] or 0), 2),
                "best_margin_pct": round(float(summary["best_margin_pct"] or 0), 2),
                "worst_margin_pct": round(float(summary["worst_margin_pct"] or 0), 2),
                "profitable_deals": int(profitable_count or 0),
            },
            "best_deal": dict(best_deal) if best_deal else None,
            "worst_deal": dict(worst_deal) if worst_deal else None,
        }
    }


# ---------------------------------------------------------------------------
# GET /by-deal — Profit per deal chain
# ---------------------------------------------------------------------------

@router.get("/by-deal")
async def profit_by_deal(
    months: int = Query(6, ge=1, le=36),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    sort_by: str = Query("margin_pct", description="margin_pct | gross_profit_vnd | revenue_vnd"),
    order: str = Query("desc", description="asc | desc"),
    token_data: TokenData = Depends(require_role("manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    start, end = _date_range(months)
    offset = (page - 1) * limit

    # Whitelist sort columns
    allowed_sorts = {"margin_pct", "gross_profit_vnd", "revenue_vnd", "total_cost_vnd", "created_at"}
    sort_col = sort_by if sort_by in allowed_sorts else "margin_pct"
    sort_dir = "DESC" if order.lower() == "desc" else "ASC"

    total = await conn.fetchval(
        """
        SELECT COUNT(*) FROM deal_margins dm
        WHERE dm.created_at >= $1 AND dm.created_at <= $2
        """,
        start,
        end,
    )

    rows = await conn.fetch(
        f"""
        SELECT
            dm.*,
            so.order_number,
            rfq.rfq_number,
            rfq.maker,
            rfq.specification,
            c.company_name AS customer_name
        FROM deal_margins dm
        LEFT JOIN sales_orders so ON so.id = dm.sales_order_id
        LEFT JOIN revenue_chain rc ON rc.chain_code = dm.chain_code
        LEFT JOIN bqms_rfq rfq ON rfq.id = rc.rfq_id
        LEFT JOIN customers c ON c.id = so.customer_id
        WHERE dm.created_at >= $1 AND dm.created_at <= $2
        ORDER BY dm.{sort_col} {sort_dir}
        LIMIT $3 OFFSET $4
        """,
        start,
        end,
        limit,
        offset,
    )

    return {
        "data": {
            "items": [dict(r) for r in rows],
            "total": int(total or 0),
            "page": page,
        }
    }


# ---------------------------------------------------------------------------
# GET /by-maker — Aggregate profit by maker
# ---------------------------------------------------------------------------

@router.get("/by-maker")
async def profit_by_maker(
    months: int = Query(6, ge=1, le=36),
    token_data: TokenData = Depends(require_role("manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    start, end = _date_range(months)

    rows = await conn.fetch(
        """
        SELECT
            COALESCE(rfq.maker, 'Không xác định')      AS maker,
            COUNT(DISTINCT dm.chain_code)               AS deal_count,
            COALESCE(SUM(dm.revenue_vnd), 0)            AS total_revenue_vnd,
            COALESCE(SUM(dm.total_cost_vnd), 0)         AS total_cost_vnd,
            COALESCE(SUM(dm.gross_profit_vnd), 0)       AS total_gross_profit_vnd,
            COALESCE(AVG(dm.margin_pct), 0)             AS avg_margin_pct,
            COALESCE(MAX(dm.margin_pct), 0)             AS best_margin_pct,
            COALESCE(MIN(dm.margin_pct), 0)             AS worst_margin_pct
        FROM deal_margins dm
        LEFT JOIN revenue_chain rc ON rc.chain_code = dm.chain_code
        LEFT JOIN bqms_rfq rfq ON rfq.id = rc.rfq_id
        WHERE dm.created_at >= $1 AND dm.created_at <= $2
        GROUP BY rfq.maker
        ORDER BY total_gross_profit_vnd DESC
        """,
        start,
        end,
    )

    data = []
    for r in rows:
        d = dict(r)
        d["avg_margin_pct"] = round(float(d["avg_margin_pct"] or 0), 2)
        d["best_margin_pct"] = round(float(d["best_margin_pct"] or 0), 2)
        d["worst_margin_pct"] = round(float(d["worst_margin_pct"] or 0), 2)
        data.append(d)

    return {
        "data": {
            "items": data,
            "period": {"months": months, "from": str(start), "to": str(end)},
        }
    }


# ---------------------------------------------------------------------------
# GET /by-supplier — Aggregate profit by supplier
# ---------------------------------------------------------------------------

@router.get("/by-supplier")
async def profit_by_supplier(
    months: int = Query(6, ge=1, le=36),
    token_data: TokenData = Depends(require_role("manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    start, end = _date_range(months)

    rows = await conn.fetch(
        """
        SELECT
            COALESCE(s.name, 'Không xác định')          AS supplier_name,
            s.id                                         AS supplier_id,
            s.rating                                     AS supplier_rating,
            COUNT(DISTINCT dm.chain_code)                AS deal_count,
            COALESCE(SUM(dm.revenue_vnd), 0)             AS total_revenue_vnd,
            COALESCE(SUM(dm.cogs_vnd), 0)                AS total_cogs_vnd,
            COALESCE(SUM(dm.freight_vnd), 0)             AS total_freight_vnd,
            COALESCE(SUM(dm.customs_duty_vnd), 0)        AS total_customs_vnd,
            COALESCE(SUM(dm.total_cost_vnd), 0)          AS total_cost_vnd,
            COALESCE(SUM(dm.gross_profit_vnd), 0)        AS total_gross_profit_vnd,
            COALESCE(AVG(dm.margin_pct), 0)              AS avg_margin_pct
        FROM deal_margins dm
        LEFT JOIN revenue_chain rc ON rc.chain_code = dm.chain_code
        LEFT JOIN purchase_orders po ON po.id = rc.po_id
        LEFT JOIN suppliers s ON s.id = po.supplier_id
        WHERE dm.created_at >= $1 AND dm.created_at <= $2
        GROUP BY s.id, s.name, s.rating
        ORDER BY total_gross_profit_vnd DESC
        """,
        start,
        end,
    )

    data = []
    for r in rows:
        d = dict(r)
        d["avg_margin_pct"] = round(float(d["avg_margin_pct"] or 0), 2)
        data.append(d)

    return {
        "data": {
            "items": data,
            "period": {"months": months, "from": str(start), "to": str(end)},
        }
    }


# ---------------------------------------------------------------------------
# GET /by-period — Monthly profit trend
# ---------------------------------------------------------------------------

@router.get("/by-period")
async def profit_by_period(
    months: int = Query(6, ge=1, le=36),
    token_data: TokenData = Depends(require_role("manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    start, end = _date_range(months)

    rows = await conn.fetch(
        """
        SELECT
            TO_CHAR(DATE_TRUNC('month', dm.created_at), 'YYYY-MM')  AS month,
            DATE_TRUNC('month', dm.created_at)                       AS month_start,
            COUNT(DISTINCT dm.chain_code)                            AS deal_count,
            COALESCE(SUM(dm.revenue_vnd), 0)                         AS total_revenue_vnd,
            COALESCE(SUM(dm.total_cost_vnd), 0)                      AS total_cost_vnd,
            COALESCE(SUM(dm.gross_profit_vnd), 0)                    AS total_gross_profit_vnd,
            COALESCE(AVG(dm.margin_pct), 0)                          AS avg_margin_pct
        FROM deal_margins dm
        WHERE dm.created_at >= $1 AND dm.created_at <= $2
        GROUP BY DATE_TRUNC('month', dm.created_at)
        ORDER BY month_start ASC
        """,
        start,
        end,
    )

    data = []
    for r in rows:
        d = dict(r)
        # Remove the raw datetime, keep only the string month label
        d.pop("month_start", None)
        d["avg_margin_pct"] = round(float(d["avg_margin_pct"] or 0), 2)
        data.append(d)

    return {
        "data": {
            "items": data,
            "period": {"months": months, "from": str(start), "to": str(end)},
        }
    }


# ---------------------------------------------------------------------------
# GET /by-product — Top profitable products
# ---------------------------------------------------------------------------

@router.get("/by-product")
async def profit_by_product(
    months: int = Query(6, ge=1, le=36),
    limit: int = Query(20, ge=1, le=100),
    token_data: TokenData = Depends(require_role("manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    start, end = _date_range(months)

    rows = await conn.fetch(
        """
        SELECT
            p.id                                         AS product_id,
            p.product_name,
            p.bqms_code,
            p.maker,
            p.category,
            p.unit,
            COUNT(DISTINCT dm.chain_code)                AS deal_count,
            COALESCE(SUM(dm.revenue_vnd), 0)             AS total_revenue_vnd,
            COALESCE(SUM(dm.cogs_vnd), 0)                AS total_cogs_vnd,
            COALESCE(SUM(dm.gross_profit_vnd), 0)        AS total_gross_profit_vnd,
            COALESCE(AVG(dm.margin_pct), 0)              AS avg_margin_pct
        FROM deal_margins dm
        LEFT JOIN revenue_chain rc ON rc.chain_code = dm.chain_code
        LEFT JOIN bqms_rfq rfq ON rfq.id = rc.rfq_id
        LEFT JOIN products p ON p.bqms_code = rfq.bqms_code
        WHERE dm.created_at >= $1 AND dm.created_at <= $2
          AND p.id IS NOT NULL
        GROUP BY p.id, p.product_name, p.bqms_code, p.maker, p.category, p.unit
        ORDER BY total_gross_profit_vnd DESC
        LIMIT $3
        """,
        start,
        end,
        limit,
    )

    data = []
    for r in rows:
        d = dict(r)
        d["avg_margin_pct"] = round(float(d["avg_margin_pct"] or 0), 2)
        data.append(d)

    return {
        "data": {
            "items": data,
            "period": {"months": months, "from": str(start), "to": str(end)},
        }
    }
