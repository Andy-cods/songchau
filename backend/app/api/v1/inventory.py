"""Inventory API — stock levels, receive goods, adjust, movements."""

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
import asyncpg

from app.core.database import get_db
from app.core.rbac import require_role
from app.core.security import TokenData

router = APIRouter()


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
        raise HTTPException(status_code=400, detail="Số lượng phải lớn hơn 0")

    async with conn.transaction():
        # Upsert inventory
        inv = await conn.fetchrow(
            """
            INSERT INTO inventory (product_id, quantity)
            VALUES ($1, $2)
            ON CONFLICT (product_id)
            DO UPDATE SET quantity = inventory.quantity + $2,
                         updated_at = NOW()
            RETURNING *
            """,
            body.product_id,
            body.quantity,
        )

        # Record movement
        mov = await conn.fetchrow(
            """
            INSERT INTO inventory_movements
                (product_id, movement_type, quantity, reference_type,
                 reference_id, note, created_by)
            VALUES ($1, 'in', $2, $3, $4, $5, $6)
            RETURNING *
            """,
            body.product_id,
            body.quantity,
            body.reference_type,
            body.reference_id,
            body.note,
            token_data.user_id,
        )

    return {
        "data": {
            "inventory": dict(inv),
            "movement": dict(mov),
        },
        "message": "Đã nhập kho thành công",
    }


@router.put("/{inventory_id}/adjust")
async def adjust_inventory(
    inventory_id: str,
    body: InventoryAdjustRequest,
    token_data: TokenData = Depends(require_role("manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    if body.quantity_delta == 0:
        raise HTTPException(status_code=400, detail="Số lượng điều chỉnh phải khác 0")

    if not body.reason or len(body.reason.strip()) < 3:
        raise HTTPException(
            status_code=400,
            detail="Phải nhập lý do điều chỉnh (ít nhất 3 ký tự)",
        )

    async with conn.transaction():
        inv = await conn.fetchrow(
            "SELECT * FROM inventory WHERE id = $1", inventory_id
        )
        if not inv:
            raise HTTPException(status_code=404, detail="Mã tồn kho không tồn tại")

        new_qty = float(inv["quantity"]) + body.quantity_delta
        if new_qty < 0:
            raise HTTPException(
                status_code=400,
                detail=f"Không thể điều chỉnh: tồn kho hiện tại {inv['quantity']}, "
                       f"điều chỉnh {body.quantity_delta} sẽ thành {new_qty} (âm)",
            )

        updated = await conn.fetchrow(
            """
            UPDATE inventory
            SET quantity = quantity + $1, updated_at = NOW()
            WHERE id = $2
            RETURNING *
            """,
            body.quantity_delta,
            inventory_id,
        )

        movement_type = "adjust_in" if body.quantity_delta > 0 else "adjust_out"
        await conn.execute(
            """
            INSERT INTO inventory_movements
                (product_id, movement_type, quantity, reference_type,
                 note, created_by)
            VALUES ($1, $2, $3, 'adjustment', $4, $5)
            """,
            inv["product_id"],
            movement_type,
            abs(body.quantity_delta),
            body.reason,
            token_data.user_id,
        )

    return {"data": dict(updated), "message": "Đã điều chỉnh tồn kho"}


@router.get("/{inventory_id}/movements")
async def inventory_movements(
    inventory_id: str,
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
        LEFT JOIN users u ON u.id::text = im.created_by
        WHERE im.product_id = $1
        ORDER BY im.created_at DESC
        LIMIT $2 OFFSET $3
        """,
        product_id,
        limit,
        offset,
    )
    return {"data": [dict(r) for r in rows], "total": total}
