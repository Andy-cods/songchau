"""Dashboard KPI API — reads from tables that ACTUALLY have imported data."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
import asyncpg

from app.core.database import get_db
from app.core.rbac import require_role
from app.core.security import TokenData

router = APIRouter()


@router.get("/kpis")
async def dashboard_kpis(
    token_data: TokenData = Depends(require_role("staff", "manager", "admin", "accountant", "procurement", "warehouse")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """KPIs from real imported data."""

    # Revenue from revenue_invoices (all time, not just this month — data is historical)
    total_revenue = await conn.fetchval(
        "SELECT COALESCE(SUM(total_amount), 0) FROM revenue_invoices"
    )

    # BQMS RFQ count (real data)
    total_rfq = await conn.fetchval("SELECT COUNT(*) FROM bqms_rfq")

    # BQMS deliveries count
    total_deliveries = await conn.fetchval("SELECT COUNT(*) FROM bqms_deliveries")

    # BQMS won quotations
    total_won = await conn.fetchval("SELECT COUNT(*) FROM bqms_won_quotations")

    # BQMS win rate
    total_with_result = await conn.fetchval(
        "SELECT COUNT(*) FROM bqms_rfq WHERE result IN ('won', 'lost')"
    )
    won_count = await conn.fetchval(
        "SELECT COUNT(*) FROM bqms_rfq WHERE result = 'won'"
    )
    win_rate = round(won_count * 100.0 / total_with_result, 1) if total_with_result > 0 else 0

    # Samsung PO
    total_samsung_po = await conn.fetchval("SELECT COUNT(*) FROM bqms_samsung_po")

    # IMV inquiries
    total_imv = await conn.fetchval("SELECT COUNT(*) FROM imv_inquiries")

    # Import/export tracking
    total_xnk = await conn.fetchval("SELECT COUNT(*) FROM import_export_tracking")

    # Exchange rates
    latest_rate = await conn.fetchrow(
        "SELECT rate, rate_date FROM exchange_rates WHERE from_currency = 'USD' AND to_currency = 'VND' ORDER BY rate_date DESC LIMIT 1"
    )

    # PO from internal purchase_orders (may be 0)
    po_count = await conn.fetchval("SELECT COUNT(*) FROM purchase_orders")

    # Pending approvals
    pending = await conn.fetchval(
        "SELECT COUNT(*) FROM workflow_instances WHERE current_status IN ('pending_l1', 'pending_l2')"
    )

    # Low stock
    low_stock = await conn.fetchval(
        "SELECT COUNT(*) FROM inventory WHERE min_stock IS NOT NULL AND quantity <= min_stock"
    )

    return {
        "data": {
            "total_revenue": float(total_revenue),
            "total_revenue_mtd": float(total_revenue),
            "total_rfq": total_rfq,
            "total_deliveries": total_deliveries,
            "total_won": total_won,
            "bqms_win_rate": win_rate,
            "total_samsung_po": total_samsung_po,
            "total_imv": total_imv,
            "total_xnk": total_xnk,
            "usd_vnd_rate": float(latest_rate["rate"]) if latest_rate else None,
            "usd_vnd_date": str(latest_rate["rate_date"]) if latest_rate else None,
            "po_count_month": po_count,
            "so_count_month": 0,
            "pending_approvals": pending,
            "low_stock_count": low_stock,
            "ap_outstanding": 0,
            "ar_outstanding": 0,
        }
    }


@router.get("/recent-activity")
async def recent_activity(
    limit: int = Query(20, ge=1, le=100),
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Recent imported data as activity feed."""
    # Show recent bqms_rfq entries as activity
    rows = await conn.fetch(
        """
        SELECT id, rfq_number AS reference, bqms_code, specification AS detail,
               maker, result, inquiry_date AS created_at,
               'bqms_rfq' AS source
        FROM bqms_rfq
        ORDER BY created_at DESC NULLS LAST
        LIMIT $1
        """,
        limit,
    )
    return {"data": [dict(r) for r in rows]}


@router.get("/stock-alerts")
async def stock_alerts(
    token_data: TokenData = Depends(require_role("staff", "manager", "admin", "warehouse")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Stock alerts — items below min stock OR recent BQMS deliveries pending."""
    # Show pending BQMS deliveries as alerts (since inventory table is empty)
    rows = await conn.fetch(
        """
        SELECT id, po_number, bqms_code, specification AS product_name,
               quantity, delivery_status, delivery_date
        FROM bqms_deliveries
        WHERE delivery_status != 'da_giao'
        ORDER BY po_date DESC NULLS LAST
        LIMIT 20
        """
    )
    return {"data": [dict(r) for r in rows]}
