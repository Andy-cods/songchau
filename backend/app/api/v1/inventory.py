"""Inventory API — stock levels, receive goods, adjust, movements."""

import logging
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
import asyncpg

from app.core.database import get_db
from app.core.rbac import require_role
from app.core.security import TokenData

logger = logging.getLogger(__name__)

router = APIRouter()


# ─────────── Prometheus custom metrics (Thang 2026-06-14) ───────────
# Surface inventory-action health via three counters scraped by /metrics:
#   1. inventory_receive_total      — Counter (by result: ok|error)
#   2. inventory_adjust_total       — Counter (by direction: in|out, by result)
#   3. inventory_low_stock_queries  — Counter — how often the low-stock list is hit
#
# Wrapped in try/except — missing prometheus_client must NOT break inventory
# writes. Observability degrades, business logic continues.
try:
    from prometheus_client import Counter

    INVENTORY_RECEIVE = Counter(
        "inventory_receive_total",
        "Goods-receive API calls, labelled by result (ok|error).",
        labelnames=("result",),
    )
    INVENTORY_ADJUST = Counter(
        "inventory_adjust_total",
        "Inventory adjust calls, labelled by direction (in|out) and result.",
        labelnames=("direction", "result"),
    )
    INVENTORY_LOW_STOCK_QUERIES = Counter(
        "inventory_low_stock_queries_total",
        "Reads against /inventory/low-stock — proxy for warehouse alert checks.",
    )
    _PROM_ENABLED = True
except Exception:  # noqa: BLE001
    INVENTORY_RECEIVE = None  # type: ignore[assignment]
    INVENTORY_ADJUST = None  # type: ignore[assignment]
    INVENTORY_LOW_STOCK_QUERIES = None  # type: ignore[assignment]
    _PROM_ENABLED = False
    logger.warning("prometheus_client unavailable; inventory metrics disabled")


def _inv_metric_inc(metric, labels: dict[str, str] | None = None) -> None:
    if not _PROM_ENABLED or metric is None:
        return
    try:
        if labels:
            metric.labels(**labels).inc()
        else:
            metric.inc()
    except Exception:  # noqa: BLE001
        pass


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class InventoryReceiveRequest(BaseModel):
    product_id: str
    quantity: float
    reference_type: str | None = "manual"
    reference_id: str | None = None
    note: str | None = None


class InventoryAdjustRequest(BaseModel):
    quantity_delta: float
    reason: str


# inventory_movements.reference_type CHECK whitelist (schema snapshot).
# Manual goods-receive maps to 'adjustment' when no valid business ref is given.
_MOVEMENT_REFERENCE_TYPES = frozenset(
    {"po", "sale", "bqms_delivery", "imv_delivery", "adjustment", "return"}
)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("")
async def list_inventory(
    q: str | None = Query(None, description="Tìm kiếm theo tên/SKU"),
    category_id: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    conditions = ["1=1"]
    params: list = []
    idx = 1

    if q:
        conditions.append(
            f"(p.product_name ILIKE '%' || ${idx} || '%' OR p.bqms_code ILIKE '%' || ${idx} || '%')"
        )
        params.append(q)
        idx += 1

    if category_id:
        conditions.append(f"inv.category = ${idx}")
        params.append(category_id)
        idx += 1

    where = " AND ".join(conditions)

    total = await conn.fetchval(
        f"""
        SELECT COUNT(*)
        FROM inventory inv
        JOIN products p ON p.id = inv.product_id
        WHERE {where}
        """,
        *params,
    )

    params.extend([limit, offset])
    rows = await conn.fetch(
        f"""
        SELECT inv.*, p.product_name, p.bqms_code, p.unit,
               inv.min_stock, inv.category
        FROM inventory inv
        JOIN products p ON p.id = inv.product_id
        WHERE {where}
        ORDER BY p.product_name ASC
        LIMIT ${idx} OFFSET ${idx + 1}
        """,
        *params,
    )
    return {"data": [dict(r) for r in rows], "total": total}


@router.get("/low-stock")
async def low_stock(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    _inv_metric_inc(INVENTORY_LOW_STOCK_QUERIES)
    total = await conn.fetchval(
        """
        SELECT COUNT(*)
        FROM inventory inv
        JOIN products p ON p.id = inv.product_id
        WHERE inv.min_stock IS NOT NULL
          AND inv.quantity <= inv.min_stock
        """
    )

    rows = await conn.fetch(
        """
        SELECT inv.*, p.product_name, p.bqms_code, p.unit,
               inv.min_stock,
               (inv.min_stock - inv.quantity) AS shortage
        FROM inventory inv
        JOIN products p ON p.id = inv.product_id
        WHERE inv.min_stock IS NOT NULL
          AND inv.quantity <= inv.min_stock
        ORDER BY shortage DESC
        LIMIT $1 OFFSET $2
        """,
        limit,
        offset,
    )
    return {"data": [dict(r) for r in rows], "total": total}


@router.post("/receive", status_code=201)
async def receive_goods(
    body: InventoryReceiveRequest,
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    if body.quantity <= 0:
        _inv_metric_inc(INVENTORY_RECEIVE, {"result": "error"})
        raise HTTPException(status_code=400, detail="Số lượng phải lớn hơn 0")

    # product_id arrives as str (API contract) but the column is bigint.
    try:
        product_id = int(body.product_id)
    except (TypeError, ValueError):
        _inv_metric_inc(INVENTORY_RECEIVE, {"result": "error"})
        raise HTTPException(status_code=400, detail="product_id không hợp lệ")

    # reference_id str → bigint (or NULL). reference_type must satisfy the CHECK;
    # a manual receive with no valid business ref is recorded as 'adjustment'.
    ref_id: int | None = None
    if body.reference_id:
        try:
            ref_id = int(body.reference_id)
        except (TypeError, ValueError):
            ref_id = None
    ref_type = (
        body.reference_type
        if body.reference_type in _MOVEMENT_REFERENCE_TYPES
        else "adjustment"
    )

    qty = Decimal(str(body.quantity))

    try:
        async with conn.transaction():
            # Resolve product → 404 if missing; derive NOT NULL columns.
            product = await conn.fetchrow(
                """
                SELECT id, bqms_code, imv_code, customer_code, product_name, unit
                FROM products
                WHERE id = $1
                """,
                product_id,
            )
            if not product:
                raise HTTPException(status_code=404, detail="Sản phẩm không tồn tại")

            product_code = (
                product["bqms_code"]
                or product["imv_code"]
                or product["customer_code"]
                or f"P{product_id}"
            )

            # Upsert inventory. available_qty is GENERATED — never write it.
            inv = await conn.fetchrow(
                """
                INSERT INTO inventory
                    (product_id, product_code, product_name, unit, quantity)
                VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT (product_id) DO UPDATE
                    SET quantity     = inventory.quantity + EXCLUDED.quantity,
                        last_updated = NOW()
                RETURNING *
                """,
                product_id,
                product_code,
                product["product_name"],
                product["unit"],
                qty,
            )

            after_qty = inv["quantity"]
            before_qty = after_qty - qty
            # Use the PERSISTED product_code (on conflict the pre-existing row keeps
            # its code) so the FK inventory_movements.product_code → inventory holds.
            inv_product_code = inv["product_code"]

            # Record movement. product_code / before_qty / after_qty are NOT NULL;
            # the column is `notes`; movement_type 'in' and reference_type both
            # satisfy the CHECK constraints.
            mov = await conn.fetchrow(
                """
                INSERT INTO inventory_movements
                    (product_id, product_code, movement_type, quantity,
                     reference_type, reference_id, before_qty, after_qty,
                     notes, created_by)
                VALUES ($1, $2, 'in', $3, $4, $5, $6, $7, $8, $9::uuid)
                RETURNING *
                """,
                product_id,
                inv_product_code,
                qty,
                ref_type,
                ref_id,
                before_qty,
                after_qty,
                body.note,
                token_data.user_id,
            )
    except HTTPException:
        _inv_metric_inc(INVENTORY_RECEIVE, {"result": "error"})
        raise
    except Exception:
        _inv_metric_inc(INVENTORY_RECEIVE, {"result": "error"})
        raise

    _inv_metric_inc(INVENTORY_RECEIVE, {"result": "ok"})
    return {
        "data": {
            "inventory": dict(inv),
            "movement": dict(mov),
        },
        "message": "Đã nhập kho thành công",
    }


# Accept both PUT (legacy) and POST (frontend service) — same behaviour.
@router.api_route("/{inventory_id}/adjust", methods=["PUT", "POST"])
async def adjust_inventory(
    inventory_id: int,
    body: InventoryAdjustRequest,
    token_data: TokenData = Depends(require_role("manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    direction = "in" if body.quantity_delta > 0 else "out"

    if body.quantity_delta == 0:
        _inv_metric_inc(INVENTORY_ADJUST, {"direction": "noop", "result": "error"})
        raise HTTPException(status_code=400, detail="Số lượng điều chỉnh phải khác 0")

    if not body.reason or len(body.reason.strip()) < 3:
        _inv_metric_inc(INVENTORY_ADJUST, {"direction": direction, "result": "error"})
        raise HTTPException(
            status_code=400,
            detail="Phải nhập lý do điều chỉnh (ít nhất 3 ký tự)",
        )

    delta = Decimal(str(body.quantity_delta))

    try:
        async with conn.transaction():
            inv = await conn.fetchrow(
                "SELECT * FROM inventory WHERE id = $1", inventory_id
            )
            if not inv:
                raise HTTPException(status_code=404, detail="Mã tồn kho không tồn tại")

            before_qty = inv["quantity"]
            after_qty = before_qty + delta
            if after_qty < 0:
                raise HTTPException(
                    status_code=400,
                    detail=f"Không thể điều chỉnh: tồn kho hiện tại {before_qty}, "
                           f"điều chỉnh {body.quantity_delta} sẽ thành {after_qty} (âm)",
                )

            updated = await conn.fetchrow(
                """
                UPDATE inventory
                SET quantity = quantity + $1, last_updated = NOW()
                WHERE id = $2
                RETURNING *
                """,
                delta,
                inventory_id,
            )

            # movement_type 'adjust' satisfies the CHECK; before/after NOT NULL;
            # column is `notes`; reference_type 'adjustment' has no reference_id.
            await conn.execute(
                """
                INSERT INTO inventory_movements
                    (product_id, product_code, movement_type, quantity,
                     reference_type, reference_id, before_qty, after_qty,
                     notes, created_by)
                VALUES ($1, $2, 'adjust', $3, 'adjustment', NULL, $4, $5, $6, $7::uuid)
                """,
                inv["product_id"],
                inv["product_code"],
                abs(delta),
                before_qty,
                after_qty,
                body.reason,
                token_data.user_id,
            )
    except HTTPException:
        _inv_metric_inc(INVENTORY_ADJUST, {"direction": direction, "result": "error"})
        raise
    except Exception:
        _inv_metric_inc(INVENTORY_ADJUST, {"direction": direction, "result": "error"})
        raise

    _inv_metric_inc(INVENTORY_ADJUST, {"direction": direction, "result": "ok"})
    return {"data": dict(updated), "message": "Đã điều chỉnh tồn kho"}


@router.get("/{inventory_id}")
async def get_inventory_item(
    inventory_id: int,
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Chi tiết 1 dòng tồn kho (FE app/inventory/[id]). Shape khớp list_inventory."""
    row = await conn.fetchrow(
        """
        SELECT inv.*, p.product_name, p.bqms_code, p.unit,
               inv.min_stock, inv.category
        FROM inventory inv
        JOIN products p ON p.id = inv.product_id
        WHERE inv.id = $1
        """,
        inventory_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Mã tồn kho không tồn tại")
    return {"data": dict(row)}


@router.get("/{inventory_id}/movements")
async def inventory_movements(
    inventory_id: int,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    # Get product_id from inventory record
    product_id = await conn.fetchval(
        "SELECT product_id FROM inventory WHERE id = $1", inventory_id
    )
    if not product_id:
        raise HTTPException(status_code=404, detail="Mã tồn kho không tồn tại")

    total = await conn.fetchval(
        "SELECT COUNT(*) FROM inventory_movements WHERE product_id = $1",
        product_id,
    )

    rows = await conn.fetch(
        """
        SELECT im.*, u.full_name AS creator_name
        FROM inventory_movements im
        LEFT JOIN users u ON u.id = im.created_by
        WHERE im.product_id = $1
        ORDER BY im.created_at DESC
        LIMIT $2 OFFSET $3
        """,
        product_id,
        limit,
        offset,
    )
    return {"data": [dict(r) for r in rows], "total": total}
