"""Dashboard KPI API — Aggregated dashboard data and alerts."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
import asyncpg

from app.core.database import get_db
from app.core.rbac import require_role
from app.core.security import TokenData

router = APIRouter()


# ---------------------------------------------------------------------------
# KPIs
# ---------------------------------------------------------------------------

@router.get("/kpis")
async def dashboard_kpis(
    token_data: TokenData = Depends(require_role("staff", "manager", "admin", "accountant")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """All KPI numbers for dashboard cards."""

    # Revenue month-to-date from revenue_invoices
    revenue_mtd = await conn.fetchval(
        """
        SELECT COALESCE(SUM(total_amount), 0)
        FROM revenue_invoices
        WHERE invoice_year = EXTRACT(YEAR FROM CURRENT_DATE)
          AND invoice_month = EXTRACT(MONTH FROM CURRENT_DATE)
        """
    )

    # PO count this month
    po_count_month = await conn.fetchval(
        """
        SELECT COUNT(*)
        FROM purchase_orders
        WHERE DATE_TRUNC('month', created_at) = DATE_TRUNC('month', CURRENT_DATE)
        """
    )

    # Pending approvals (workflow instances not yet approved)
    pending_approvals = await conn.fetchval(
        """
        SELECT COUNT(*)
        FROM workflow_instances
        WHERE current_status IN ('pending_l1', 'pending_l2')
        """
    )

    # Low stock count
    low_stock_count = await conn.fetchval(
        """
        SELECT COUNT(*)
        FROM inventory
        WHERE min_stock IS NOT NULL AND quantity <= min_stock
        """
    )

    # BQMS win rate (latest month from materialized view)
    bqms_win_rate = None
    try:
        bqms_row = await conn.fetchrow(
            """
            SELECT win_rate_pct
            FROM mv_bqms_win_rate
            ORDER BY month DESC
            LIMIT 1
            """
        )
        if bqms_row:
            bqms_win_rate = float(bqms_row["win_rate_pct"]) if bqms_row["win_rate_pct"] else None
    except asyncpg.UndefinedTableError:
        pass

    # Sales orders this month
    so_count_month = await conn.fetchval(
        """
        SELECT COUNT(*)
        FROM sales_orders
        WHERE DATE_TRUNC('month', created_at) = DATE_TRUNC('month', CURRENT_DATE)
        """
    )

    # Outstanding AP
    ap_outstanding = await conn.fetchval(
        """
        SELECT COALESCE(SUM(amount - paid_amount), 0)
        FROM accounts_payable
        WHERE status NOT IN ('paid')
        """
    )

    # Outstanding AR
    ar_outstanding = await conn.fetchval(
        """
        SELECT COALESCE(SUM(amount - paid_amount), 0)
        FROM accounts_receivable
        WHERE status NOT IN ('paid')
        """
    )

    return {
        "data": {
            "total_revenue_mtd": float(revenue_mtd),
            "po_count_month": po_count_month,
            "so_count_month": so_count_month,
            "pending_approvals": pending_approvals,
            "low_stock_count": low_stock_count,
            "bqms_win_rate": bqms_win_rate,
            "ap_outstanding": float(ap_outstanding),
            "ar_outstanding": float(ar_outstanding),
        }
    }


# ---------------------------------------------------------------------------
# Recent Activity
# ---------------------------------------------------------------------------

@router.get("/recent-activity")
async def recent_activity(
    limit: int = Query(20, ge=1, le=100),
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Last N audit log entries for the activity feed."""
    rows = await conn.fetch(
        """
        SELECT al.id, al.user_id, al.user_email,
               al.action, al.table_name, al.record_id,
               al.ip_address, al.created_at,
               u.full_name AS user_name
        FROM audit_log al
        LEFT JOIN users u ON u.id = al.user_id
        ORDER BY al.created_at DESC
        LIMIT $1
        """,
        limit,
    )
    return {"data": [dict(r) for r in rows], "total": len(rows)}


# ---------------------------------------------------------------------------
# Stock Alerts
# ---------------------------------------------------------------------------

@router.get("/stock-alerts")
async def stock_alerts(
    limit: int = Query(50, ge=1, le=200),
    token_data: TokenData = Depends(require_role("staff", "manager", "admin", "warehouse")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Items below minimum stock level."""
    rows = await conn.fetch(
        """
        SELECT inv.id, inv.product_id, inv.quantity, inv.min_stock,
               inv.category,
               p.product_name, p.bqms_code, p.unit,
               (inv.min_stock - inv.quantity) AS shortage
        FROM inventory inv
        JOIN products p ON p.id = inv.product_id
        WHERE inv.min_stock IS NOT NULL
          AND inv.quantity <= inv.min_stock
        ORDER BY (inv.min_stock - inv.quantity) DESC
        LIMIT $1
        """,
        limit,
    )
    return {"data": [dict(r) for r in rows], "total": len(rows)}
