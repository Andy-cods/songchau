"""Reports API — Generate reports from materialized views."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
import asyncpg

from app.core.database import get_db
from app.core.rbac import require_role
from app.core.security import TokenData

router = APIRouter()


# ---------------------------------------------------------------------------
# Revenue Monthly
# ---------------------------------------------------------------------------

@router.get("/revenue-monthly")
async def revenue_monthly(
    year: int | None = Query(None),
    company_id: int | None = Query(None),
    token_data: TokenData = Depends(require_role("accountant", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Monthly revenue report from mv_revenue_monthly."""
    conditions = ["1=1"]
    params: list = []
    idx = 1

    if year:
        conditions.append(f"invoice_year = ${idx}")
        params.append(year)
        idx += 1
    if company_id:
        conditions.append(f"company_id = ${idx}")
        params.append(company_id)
        idx += 1

    where = " AND ".join(conditions)

    rows = await conn.fetch(
        f"""
        SELECT invoice_year, invoice_month, company_id,
               invoice_count, total_revenue, total_vat,
               total_with_vat, total_cost, total_profit,
               profit_margin_pct, refreshed_at
        FROM mv_revenue_monthly
        WHERE {where}
        ORDER BY invoice_year DESC, invoice_month DESC
        """,
        *params,
    )
    return {"data": [dict(r) for r in rows], "total": len(rows)}


# ---------------------------------------------------------------------------
# BQMS Win Rate
# ---------------------------------------------------------------------------

@router.get("/bqms-win-rate")
async def bqms_win_rate(
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """BQMS win rate by month from mv_bqms_win_rate."""
    rows = await conn.fetch(
        """
        SELECT month, total_rfqs, won, lost, win_rate_pct, refreshed_at
        FROM mv_bqms_win_rate
        ORDER BY month DESC
        """
    )
    return {"data": [dict(r) for r in rows], "total": len(rows)}


# ---------------------------------------------------------------------------
# Supplier Performance
# ---------------------------------------------------------------------------

@router.get("/supplier-performance")
async def supplier_performance(
    token_data: TokenData = Depends(require_role("staff", "manager", "admin", "procurement")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Supplier performance from mv_supplier_performance."""
    rows = await conn.fetch(
        """
        SELECT supplier_id, supplier_name, total_pos, completed_pos,
               cancelled_pos, avg_lead_time_days, on_time_rate_pct,
               rating, refreshed_at
        FROM mv_supplier_performance
        ORDER BY total_pos DESC
        """
    )
    return {"data": [dict(r) for r in rows], "total": len(rows)}


# ---------------------------------------------------------------------------
# PO Pipeline
# ---------------------------------------------------------------------------

@router.get("/po-pipeline")
async def po_pipeline(
    token_data: TokenData = Depends(require_role("staff", "manager", "admin", "procurement")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """PO pipeline overview from mv_po_pipeline."""
    rows = await conn.fetch(
        """
        SELECT status, business_system, po_count, total_value,
               currency, refreshed_at
        FROM mv_po_pipeline
        ORDER BY po_count DESC
        """
    )
    return {"data": [dict(r) for r in rows], "total": len(rows)}


# ---------------------------------------------------------------------------
# Inventory Value
# ---------------------------------------------------------------------------

@router.get("/inventory-value")
async def inventory_value(
    token_data: TokenData = Depends(require_role("staff", "manager", "admin", "warehouse")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Inventory value by category from mv_inventory_value."""
    rows = await conn.fetch(
        """
        SELECT category, item_count, total_qty, total_value,
               total_reserved, total_available, refreshed_at
        FROM mv_inventory_value
        ORDER BY total_value DESC NULLS LAST
        """
    )
    return {"data": [dict(r) for r in rows], "total": len(rows)}


# ---------------------------------------------------------------------------
# Refresh Materialized Views
# ---------------------------------------------------------------------------

@router.post("/refresh")
async def refresh_views(
    token_data: TokenData = Depends(require_role("admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Refresh all materialized views — admin only."""
    views = [
        "bqms_kpi",
        "mv_revenue_monthly",
        "mv_bqms_win_rate",
        "mv_supplier_performance",
        "mv_po_pipeline",
        "mv_inventory_value",
        "mv_vat_declaration_monthly",
    ]

    results = {}
    for view in views:
        try:
            await conn.execute(f"REFRESH MATERIALIZED VIEW CONCURRENTLY {view}")
            results[view] = "ok"
        except asyncpg.UndefinedTableError:
            results[view] = "view_not_found"
        except asyncpg.PostgresError as e:
            # CONCURRENTLY requires a unique index; fall back to normal refresh
            try:
                await conn.execute(f"REFRESH MATERIALIZED VIEW {view}")
                results[view] = "ok_non_concurrent"
            except asyncpg.PostgresError as e2:
                results[view] = f"error: {str(e2)[:100]}"

    return {
        "data": results,
        "message": "Đã làm mới các materialized view",
    }
