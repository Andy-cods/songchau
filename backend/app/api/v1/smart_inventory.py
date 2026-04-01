"""
Smart Inventory API (M10) — KPI dashboard, stock alerts, movement history,
demand forecast, and automated reorder-check.
"""

from __future__ import annotations

from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
import asyncpg

from app.core.database import get_db
from app.core.rbac import require_role
from app.core.security import TokenData

router = APIRouter()


# ---------------------------------------------------------------------------
# GET /dashboard — KPI cards
# ---------------------------------------------------------------------------

@router.get("/dashboard")
async def inventory_dashboard(
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """
    Returns KPI cards for the smart inventory dashboard:
    - Total distinct products in inventory
    - Count of low-stock items (quantity <= min_stock)
    - Count of out-of-stock items (quantity = 0)
    - Total inventory value (quantity * unit_cost where available)
    - Active stock alerts count
    """
    total_products = await conn.fetchval(
        "SELECT COUNT(DISTINCT product_id) FROM inventory"
    )

    low_stock_count = await conn.fetchval(
        """
        SELECT COUNT(*)
        FROM inventory
        WHERE min_stock IS NOT NULL
          AND quantity > 0
          AND quantity <= min_stock
        """
    )

    out_of_stock_count = await conn.fetchval(
        "SELECT COUNT(*) FROM inventory WHERE quantity = 0"
    )

    # Total value: sum of quantity * last known unit_cost from inventory_movements
    total_value = await conn.fetchval(
        """
        SELECT COALESCE(SUM(inv.quantity * COALESCE(last_cost.unit_cost, 0)), 0)
        FROM inventory inv
        LEFT JOIN LATERAL (
            SELECT unit_cost
            FROM inventory_movements
            WHERE product_id = inv.product_id
              AND unit_cost IS NOT NULL
            ORDER BY created_at DESC
            LIMIT 1
        ) last_cost ON true
        """
    )

    active_alerts = await conn.fetchval(
        "SELECT COUNT(*) FROM stock_alerts WHERE status = 'active'"
    )

    # Top 5 low-stock items for quick preview
    low_stock_items = await conn.fetch(
        """
        SELECT inv.product_id, inv.product_name, inv.product_code,
               inv.quantity, inv.min_stock, inv.unit,
               (inv.min_stock - inv.quantity) AS shortage
        FROM inventory inv
        WHERE inv.min_stock IS NOT NULL
          AND inv.quantity <= inv.min_stock
        ORDER BY shortage DESC
        LIMIT 5
        """
    )

    return {
        "data": {
            "kpis": {
                "total_products": int(total_products or 0),
                "low_stock_count": int(low_stock_count or 0),
                "out_of_stock_count": int(out_of_stock_count or 0),
                "total_value_vnd": float(total_value or 0),
                "active_alerts": int(active_alerts or 0),
            },
            "low_stock_preview": [dict(r) for r in low_stock_items],
        }
    }


# ---------------------------------------------------------------------------
# GET /alerts — List stock alerts
# ---------------------------------------------------------------------------

@router.get("/alerts")
async def list_stock_alerts(
    status: str | None = Query(None, description="active | acknowledged | resolved"),
    alert_type: str | None = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    conditions = ["1=1"]
    params: list = []
    idx = 1

    if status:
        conditions.append(f"sa.status = ${idx}")
        params.append(status)
        idx += 1
    if alert_type:
        conditions.append(f"sa.alert_type = ${idx}")
        params.append(alert_type)
        idx += 1

    where = " AND ".join(conditions)
    offset = (page - 1) * limit

    total = await conn.fetchval(
        f"SELECT COUNT(*) FROM stock_alerts sa WHERE {where}", *params
    )

    params.extend([limit, offset])
    rows = await conn.fetch(
        f"""
        SELECT sa.*,
               p.product_name, p.bqms_code, p.unit,
               u.full_name AS acknowledged_by_name
        FROM stock_alerts sa
        JOIN products p ON p.id = sa.product_id
        LEFT JOIN users u ON u.id = sa.acknowledged_by
        WHERE {where}
        ORDER BY sa.created_at DESC
        LIMIT ${idx} OFFSET ${idx + 1}
        """,
        *params,
    )

    return {
        "data": {
            "items": [dict(r) for r in rows],
            "total": int(total or 0),
            "page": page,
        }
    }


# ---------------------------------------------------------------------------
# POST /alerts/{id}/acknowledge
# ---------------------------------------------------------------------------

@router.post("/alerts/{alert_id}/acknowledge")
async def acknowledge_alert(
    alert_id: int,
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    row = await conn.fetchrow(
        """
        UPDATE stock_alerts
        SET status = 'acknowledged',
            acknowledged_by = $1::uuid
        WHERE id = $2
          AND status = 'active'
        RETURNING id, status, alert_type
        """,
        token_data.user_id,
        alert_id,
    )
    if not row:
        raise HTTPException(
            status_code=404,
            detail="Cảnh báo không tồn tại hoặc đã được xác nhận trước đó",
        )
    return {"data": dict(row), "message": "Đã xác nhận cảnh báo tồn kho"}


# ---------------------------------------------------------------------------
# GET /movements — Movement history with filters
# ---------------------------------------------------------------------------

@router.get("/movements")
async def list_movements(
    product_id: int | None = Query(None),
    movement_type: str | None = Query(None, description="in | out | adjust"),
    date_from: str | None = Query(None, description="YYYY-MM-DD"),
    date_to: str | None = Query(None, description="YYYY-MM-DD"),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    conditions = ["1=1"]
    params: list = []
    idx = 1

    if product_id:
        conditions.append(f"im.product_id = ${idx}")
        params.append(product_id)
        idx += 1

    if movement_type:
        # Support prefix match: 'adjust' matches 'adjust_in', 'adjust_out'
        conditions.append(f"im.movement_type LIKE ${idx} || '%'")
        params.append(movement_type)
        idx += 1

    if date_from:
        conditions.append(f"im.created_at >= ${idx}::timestamptz")
        params.append(date_from)
        idx += 1

    if date_to:
        conditions.append(f"im.created_at < (${idx}::date + INTERVAL '1 day')")
        params.append(date_to)
        idx += 1

    where = " AND ".join(conditions)
    offset = (page - 1) * limit

    total = await conn.fetchval(
        f"SELECT COUNT(*) FROM inventory_movements im WHERE {where}", *params
    )

    params.extend([limit, offset])
    rows = await conn.fetch(
        f"""
        SELECT im.*,
               p.product_name, p.bqms_code,
               u.full_name AS created_by_name
        FROM inventory_movements im
        LEFT JOIN products p ON p.id = im.product_id
        LEFT JOIN users u ON u.id::text = im.created_by::text
        WHERE {where}
        ORDER BY im.created_at DESC
        LIMIT ${idx} OFFSET ${idx + 1}
        """,
        *params,
    )

    return {
        "data": {
            "items": [dict(r) for r in rows],
            "total": int(total or 0),
            "page": page,
        }
    }


# ---------------------------------------------------------------------------
# GET /forecast/{product_id} — Simple demand forecast
# ---------------------------------------------------------------------------

@router.get("/forecast/{product_id}")
async def demand_forecast(
    product_id: int,
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """
    Simple demand forecast:
    1. Avg daily consumption from last 90 days of 'out' movements
    2. Look up supplier lead time from supplier_product_map if available
    3. Reorder point = avg_daily * (lead_time_days + 7)  [7 = safety margin]
    4. Suggested order qty = (max_stock - current_qty) if below reorder point
    """
    # Verify product exists
    product = await conn.fetchrow(
        "SELECT id, product_name, bqms_code, unit FROM products WHERE id = $1",
        product_id,
    )
    if not product:
        raise HTTPException(status_code=404, detail="Sản phẩm không tồn tại")

    # Current inventory
    inv = await conn.fetchrow(
        "SELECT quantity, min_stock, max_stock FROM inventory WHERE product_id = $1",
        product_id,
    )
    current_qty = float(inv["quantity"]) if inv else 0.0
    min_stock = float(inv["min_stock"]) if inv and inv["min_stock"] else 0.0
    max_stock = float(inv["max_stock"]) if inv and inv["max_stock"] else 0.0

    # Total outbound in last 90 days
    out_qty_90d = await conn.fetchval(
        """
        SELECT COALESCE(SUM(quantity), 0)
        FROM inventory_movements
        WHERE product_id = $1
          AND movement_type IN ('out', 'adjust_out')
          AND created_at >= NOW() - INTERVAL '90 days'
        """,
        product_id,
    )
    out_qty_90d = float(out_qty_90d or 0)
    avg_daily = round(out_qty_90d / 90.0, 4)

    # Supplier lead time
    lead_time_days = await conn.fetchval(
        """
        SELECT COALESCE(MIN(typical_lead_time_days), 14)
        FROM supplier_product_map spm
        JOIN products p ON p.bqms_code = spm.bqms_code
        WHERE p.id = $1
          AND typical_lead_time_days IS NOT NULL
        """,
        product_id,
    )
    lead_time_days = int(lead_time_days or 14)
    safety_days = 7
    total_days_cover = lead_time_days + safety_days

    reorder_point = round(avg_daily * total_days_cover, 3)
    days_of_stock = round(current_qty / avg_daily, 1) if avg_daily > 0 else None
    needs_reorder = current_qty <= reorder_point if reorder_point > 0 else (current_qty <= min_stock)
    suggested_order_qty = max(0.0, round(max_stock - current_qty, 3)) if needs_reorder and max_stock > current_qty else 0.0

    return {
        "data": {
            "product_id": product_id,
            "product_name": product["product_name"],
            "bqms_code": product["bqms_code"],
            "unit": product["unit"],
            "current_qty": current_qty,
            "min_stock": min_stock,
            "max_stock": max_stock,
            "forecast": {
                "avg_daily_consumption": avg_daily,
                "out_qty_last_90d": out_qty_90d,
                "lead_time_days": lead_time_days,
                "safety_days": safety_days,
                "reorder_point": reorder_point,
                "days_of_stock_remaining": days_of_stock,
                "needs_reorder": needs_reorder,
                "suggested_order_qty": suggested_order_qty,
            },
        }
    }


# ---------------------------------------------------------------------------
# POST /reorder-check — Scan all products and create stock alerts
# ---------------------------------------------------------------------------

@router.post("/reorder-check")
async def reorder_check(
    token_data: TokenData = Depends(require_role("manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """
    Scans all inventory rows where quantity <= min_stock.
    Creates stock_alerts (skipping if active alert already exists for that product+type).
    Returns list of suggested reorders.
    """
    # Find products at or below minimum stock level
    low_stock_rows = await conn.fetch(
        """
        SELECT inv.product_id, inv.product_name, inv.product_code,
               inv.quantity, inv.min_stock, inv.max_stock, inv.unit
        FROM inventory inv
        WHERE inv.min_stock IS NOT NULL
          AND inv.quantity <= inv.min_stock
        ORDER BY (inv.min_stock - inv.quantity) DESC
        """
    )

    created_alerts = []
    skipped_existing = 0

    async with conn.transaction():
        for row in low_stock_rows:
            product_id = row["product_id"]
            current_qty = float(row["quantity"])
            min_stock = float(row["min_stock"]) if row["min_stock"] else 0.0
            max_stock = float(row["max_stock"]) if row["max_stock"] else min_stock * 3
            suggested_qty = max(0.0, round(max_stock - current_qty, 3))
            alert_type = "out_of_stock" if current_qty == 0 else "low_stock"

            # Insert only if no active alert exists for this product+type (ON CONFLICT DO NOTHING via unique index)
            inserted = await conn.fetchrow(
                """
                INSERT INTO stock_alerts
                    (product_id, alert_type, current_qty, threshold_qty, suggested_order_qty, status)
                VALUES ($1, $2, $3, $4, $5, 'active')
                ON CONFLICT (product_id, alert_type)
                    WHERE status = 'active'
                DO NOTHING
                RETURNING id
                """,
                product_id,
                alert_type,
                current_qty,
                min_stock,
                suggested_qty,
            )

            if inserted:
                created_alerts.append({
                    "product_id": product_id,
                    "product_name": row["product_name"],
                    "product_code": row["product_code"],
                    "unit": row["unit"],
                    "alert_type": alert_type,
                    "current_qty": current_qty,
                    "min_stock": min_stock,
                    "suggested_order_qty": suggested_qty,
                    "alert_id": inserted["id"],
                })
            else:
                skipped_existing += 1

    return {
        "data": {
            "checked": len(low_stock_rows),
            "new_alerts_created": len(created_alerts),
            "skipped_existing": skipped_existing,
            "reorder_suggestions": created_alerts,
        },
        "message": f"Đã kiểm tra tồn kho: tạo {len(created_alerts)} cảnh báo mới, bỏ qua {skipped_existing} đã có",
    }
