"""
Shipment Tracking API — Track goods from Chinese supplier to Song Chau warehouse.
Covers full lifecycle: pending → in_transit → arrived_port → received.
"""

from __future__ import annotations

from datetime import date
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

class ShipmentItemIn(BaseModel):
    po_line_id: int | None = None
    product_id: int | None = None
    bqms_code: str | None = None
    description: str | None = None
    quantity_shipped: float
    unit: str = "EA"
    unit_price_cny: float | None = None
    weight_kg: float | None = None
    cbm: float | None = None
    notes: str | None = None


class ShipmentCreateRequest(BaseModel):
    po_id: int
    chain_code: str | None = None
    origin_country: str = "CN"
    incoterm: str = "FOB"
    origin_port: str | None = None
    dest_port: str = "Cảng Hải Phòng"
    etd: date | None = None
    eta: date | None = None
    total_weight_kg: float | None = None
    total_cbm: float | None = None
    notes: str | None = None
    items: list[ShipmentItemIn]


class ShipmentUpdateRequest(BaseModel):
    carrier: str | None = None
    tracking_number: str | None = None
    bill_of_lading: str | None = None
    container_number: str | None = None
    origin_port: str | None = None
    dest_port: str | None = None
    etd: date | None = None
    eta: date | None = None
    freight_cost_usd: float | None = None
    customs_duty_vnd: float | None = None
    other_costs_vnd: float | None = None
    total_weight_kg: float | None = None
    total_cbm: float | None = None
    notes: str | None = None


class DepartRequest(BaseModel):
    atd: date
    tracking_number: str | None = None
    carrier: str | None = None
    bill_of_lading: str | None = None
    container_number: str | None = None
    eta: date | None = None
    notes: str | None = None


class ArriveRequest(BaseModel):
    ata: date
    customs_duty_vnd: float | None = None
    notes: str | None = None


class ReceiveItemIn(BaseModel):
    shipment_item_id: int
    quantity_received: float
    notes: str | None = None


class ReceiveRequest(BaseModel):
    received_items: list[ReceiveItemIn]
    notes: str | None = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _get_shipment(conn: asyncpg.Connection, shipment_id: int) -> dict:
    row = await conn.fetchrow(
        """
        SELECT sh.*, s.name AS supplier_name, po.po_number
        FROM shipments sh
        LEFT JOIN suppliers s ON s.id = sh.supplier_id
        LEFT JOIN purchase_orders po ON po.id = sh.po_id
        WHERE sh.id = $1
        """,
        shipment_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Lô hàng không tồn tại")
    return dict(row)


async def _get_shipment_items(conn: asyncpg.Connection, shipment_id: int) -> list[dict]:
    rows = await conn.fetch(
        """
        SELECT shi.*, p.product_name, p.bqms_code AS product_code
        FROM shipment_items shi
        LEFT JOIN products p ON p.id = shi.product_id
        WHERE shi.shipment_id = $1
        ORDER BY shi.id ASC
        """,
        shipment_id,
    )
    return [dict(r) for r in rows]


async def _get_shipment_timeline(conn: asyncpg.Connection, shipment_id: int) -> list[dict]:
    rows = await conn.fetch(
        """
        SELECT event_type, payload, created_by, created_at
        FROM domain_events
        WHERE aggregate_type = 'shipment' AND aggregate_id = $1
        ORDER BY created_at ASC
        """,
        str(shipment_id),
    )
    return [dict(r) for r in rows]


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("")
async def list_shipments(
    status: str | None = Query(None),
    po_id: int | None = Query(None),
    supplier_id: int | None = Query(None),
    chain_code: str | None = Query(None),
    sort_by_eta: bool = Query(True, description="Sắp xếp theo ETA tăng dần"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """List shipments with optional status filter, sorted by ETA."""
    conditions = ["1=1"]
    params: list = []
    idx = 1

    if status:
        conditions.append(f"sh.status = ${idx}")
        params.append(status)
        idx += 1
    if po_id:
        conditions.append(f"sh.po_id = ${idx}")
        params.append(po_id)
        idx += 1
    if supplier_id:
        conditions.append(f"sh.supplier_id = ${idx}")
        params.append(supplier_id)
        idx += 1
    if chain_code:
        conditions.append(f"sh.chain_code = ${idx}")
        params.append(chain_code)
        idx += 1

    where = " AND ".join(conditions)
    total = await conn.fetchval(
        f"SELECT COUNT(*) FROM shipments sh WHERE {where}", *params
    )

    order = "sh.eta ASC NULLS LAST" if sort_by_eta else "sh.created_at DESC"
    params.extend([limit, offset])
    rows = await conn.fetch(
        f"""
        SELECT sh.*, s.name AS supplier_name, po.po_number,
               (SELECT COUNT(*) FROM shipment_items WHERE shipment_id = sh.id) AS item_count
        FROM shipments sh
        LEFT JOIN suppliers s ON s.id = sh.supplier_id
        LEFT JOIN purchase_orders po ON po.id = sh.po_id
        WHERE {where}
        ORDER BY {order}
        LIMIT ${idx} OFFSET ${idx + 1}
        """,
        *params,
    )
    return {"data": [dict(r) for r in rows], "total": total}


@router.post("", status_code=201)
async def create_shipment(
    body: ShipmentCreateRequest,
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Create a shipment from a PO."""
    if not body.items:
        raise HTTPException(status_code=400, detail="Lô hàng phải có ít nhất 1 sản phẩm")

    # Verify PO exists and get supplier
    po = await conn.fetchrow(
        "SELECT id, supplier_id, po_number, chain_code FROM purchase_orders WHERE id = $1",
        body.po_id,
    )
    if not po:
        raise HTTPException(status_code=404, detail="Đơn mua hàng không tồn tại")

    chain_code = body.chain_code or po.get("chain_code")

    async with conn.transaction():
        shipment = await conn.fetchrow(
            """
            INSERT INTO shipments
                (po_id, supplier_id, chain_code, origin_country, incoterm,
                 origin_port, dest_port, etd, eta,
                 total_weight_kg, total_cbm, notes, created_by)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::uuid)
            RETURNING *
            """,
            body.po_id,
            po["supplier_id"],
            chain_code,
            body.origin_country,
            body.incoterm,
            body.origin_port,
            body.dest_port,
            body.etd,
            body.eta,
            body.total_weight_kg,
            body.total_cbm,
            body.notes,
            token_data.user_id,
        )
        shipment_id = shipment["id"]

        for item in body.items:
            line_total_cny = None
            if item.unit_price_cny is not None:
                line_total_cny = round(item.unit_price_cny * item.quantity_shipped, 2)

            await conn.execute(
                """
                INSERT INTO shipment_items
                    (shipment_id, po_line_id, product_id, bqms_code, description,
                     quantity_shipped, unit, unit_price_cny, line_total_cny,
                     weight_kg, cbm, notes)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                """,
                shipment_id,
                item.po_line_id,
                item.product_id,
                item.bqms_code,
                item.description,
                item.quantity_shipped,
                item.unit,
                item.unit_price_cny,
                line_total_cny,
                item.weight_kg,
                item.cbm,
                item.notes,
            )

        # Link to revenue_chain
        if chain_code:
            await conn.execute(
                """
                INSERT INTO revenue_chain (chain_code, po_id, shipment_id, current_stage, created_by)
                VALUES ($1, $2, $3, 'shipment', $4::uuid)
                ON CONFLICT (chain_code) DO UPDATE
                    SET shipment_id   = EXCLUDED.shipment_id,
                        current_stage = 'shipment',
                        updated_at    = NOW()
                """,
                chain_code, body.po_id, shipment_id, token_data.user_id,
            )

        await conn.execute(
            """
            INSERT INTO domain_events (event_type, aggregate_type, aggregate_id, payload, chain_code, created_by)
            VALUES ('shipment.created', 'shipment', $1, $2, $3, $4::uuid)
            """,
            str(shipment_id),
            f'{{"po_id": {body.po_id}, "item_count": {len(body.items)}}}',
            chain_code,
            token_data.user_id,
        )

    return {
        "data": dict(shipment),
        "message": f"Đã tạo lô hàng {shipment['shipment_number']}",
    }


@router.get("/{shipment_id}")
async def get_shipment(
    shipment_id: int,
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Get shipment detail with items and event timeline."""
    shipment = await _get_shipment(conn, shipment_id)
    items = await _get_shipment_items(conn, shipment_id)
    timeline = await _get_shipment_timeline(conn, shipment_id)
    shipment["items"] = items
    shipment["timeline"] = timeline
    return {"data": shipment}


@router.put("/{shipment_id}")
async def update_shipment(
    shipment_id: int,
    body: ShipmentUpdateRequest,
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Update tracking info (carrier, tracking number, ETA, costs, etc.)."""
    shipment = await _get_shipment(conn, shipment_id)
    if shipment["status"] in ("received", "cancelled"):
        raise HTTPException(
            status_code=400,
            detail="Không thể cập nhật lô hàng đã nhận hoặc đã hủy",
        )

    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="Không có thông tin nào để cập nhật")

    set_parts = []
    values: list = []
    for i, (col, val) in enumerate(updates.items(), start=1):
        set_parts.append(f"{col} = ${i}")
        values.append(val)

    values.append(shipment_id)
    row = await conn.fetchrow(
        f"UPDATE shipments SET {', '.join(set_parts)}, updated_at = NOW() "
        f"WHERE id = ${len(values)} RETURNING *",
        *values,
    )
    return {"data": dict(row), "message": "Đã cập nhật thông tin lô hàng"}


@router.post("/{shipment_id}/depart")
async def mark_departed(
    shipment_id: int,
    body: DepartRequest,
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Mark shipment as departed from origin (ATD recorded)."""
    shipment = await _get_shipment(conn, shipment_id)
    if shipment["status"] != "pending":
        raise HTTPException(
            status_code=400,
            detail="Chỉ có thể đánh dấu khởi hành cho lô hàng ở trạng thái 'pending'",
        )

    async with conn.transaction():
        updated = await conn.fetchrow(
            """
            UPDATE shipments SET
                status           = 'in_transit',
                atd              = $1,
                tracking_number  = COALESCE($2, tracking_number),
                carrier          = COALESCE($3, carrier),
                bill_of_lading   = COALESCE($4, bill_of_lading),
                container_number = COALESCE($5, container_number),
                eta              = COALESCE($6, eta),
                notes            = COALESCE($7, notes),
                updated_at       = NOW()
            WHERE id = $8
            RETURNING *
            """,
            body.atd,
            body.tracking_number,
            body.carrier,
            body.bill_of_lading,
            body.container_number,
            body.eta,
            body.notes,
            shipment_id,
        )

        await conn.execute(
            """
            INSERT INTO domain_events (event_type, aggregate_type, aggregate_id, payload, chain_code, created_by)
            VALUES ('shipment.departed', 'shipment', $1, $2, $3, $4::uuid)
            """,
            str(shipment_id),
            f'{{"atd": "{body.atd}", "carrier": "{body.carrier or ""}"}}',
            shipment.get("chain_code"),
            token_data.user_id,
        )

    return {
        "data": dict(updated),
        "message": f"Lô hàng {updated['shipment_number']} đã khởi hành ngày {body.atd}",
    }


@router.post("/{shipment_id}/arrive")
async def mark_arrived(
    shipment_id: int,
    body: ArriveRequest,
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Mark shipment as arrived at destination port."""
    shipment = await _get_shipment(conn, shipment_id)
    if shipment["status"] != "in_transit":
        raise HTTPException(
            status_code=400,
            detail="Chỉ có thể đánh dấu đến nơi cho lô hàng đang vận chuyển (in_transit)",
        )

    async with conn.transaction():
        updated = await conn.fetchrow(
            """
            UPDATE shipments SET
                status           = 'arrived_port',
                ata              = $1,
                customs_duty_vnd = COALESCE($2, customs_duty_vnd),
                notes            = COALESCE($3, notes),
                updated_at       = NOW()
            WHERE id = $4
            RETURNING *
            """,
            body.ata,
            body.customs_duty_vnd,
            body.notes,
            shipment_id,
        )

        await conn.execute(
            """
            INSERT INTO domain_events (event_type, aggregate_type, aggregate_id, payload, chain_code, created_by)
            VALUES ('shipment.arrived_port', 'shipment', $1, $2, $3, $4::uuid)
            """,
            str(shipment_id),
            f'{{"ata": "{body.ata}"}}',
            shipment.get("chain_code"),
            token_data.user_id,
        )

    return {
        "data": dict(updated),
        "message": f"Lô hàng {updated['shipment_number']} đã về đến cảng ngày {body.ata}",
    }


@router.post("/{shipment_id}/receive")
async def receive_shipment(
    shipment_id: int,
    body: ReceiveRequest,
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """
    Warehouse confirms receipt of goods.
    - Inserts inventory_movements for each item.
    - Updates inventory quantity.
    - Updates PO status to 'received'.
    """
    shipment = await _get_shipment(conn, shipment_id)
    if shipment["status"] not in ("arrived_port", "customs_clearance", "in_transit"):
        raise HTTPException(
            status_code=400,
            detail="Lô hàng phải đang trong trạng thái vận chuyển hoặc đã đến cảng để xác nhận nhận hàng",
        )

    if not body.received_items:
        raise HTTPException(status_code=400, detail="Phải có ít nhất 1 sản phẩm được xác nhận nhận")

    receipt_summary: list[dict] = []

    async with conn.transaction():
        for recv in body.received_items:
            # Get shipment item details
            shi = await conn.fetchrow(
                "SELECT * FROM shipment_items WHERE id = $1 AND shipment_id = $2",
                recv.shipment_item_id, shipment_id,
            )
            if not shi:
                raise HTTPException(
                    status_code=404,
                    detail=f"Sản phẩm lô hàng {recv.shipment_item_id} không tồn tại trong lô này",
                )

            # Update received quantity on shipment_item
            await conn.execute(
                """
                UPDATE shipment_items SET
                    quantity_received = COALESCE(quantity_received, 0) + $1
                WHERE id = $2
                """,
                recv.quantity_received, recv.shipment_item_id,
            )

            # Only update inventory if product_id is known
            if shi["product_id"]:
                # Insert inventory movement
                await conn.execute(
                    """
                    INSERT INTO inventory_movements
                        (product_id, movement_type, quantity, reference_type,
                         reference_id, note, created_by)
                    VALUES ($1, 'in', $2, 'shipment', $3, $4, $5::uuid)
                    """,
                    shi["product_id"],
                    recv.quantity_received,
                    str(shipment_id),
                    recv.notes or f"Nhập kho từ lô {shipment['shipment_number']}",
                    token_data.user_id,
                )

                # Update inventory stock — upsert
                await conn.execute(
                    """
                    INSERT INTO inventory (product_id, quantity, available_qty)
                    VALUES ($1, $2, $2)
                    ON CONFLICT (product_id)
                    DO UPDATE SET
                        quantity      = inventory.quantity + $2,
                        available_qty = inventory.available_qty + $2,
                        updated_at    = NOW()
                    """,
                    shi["product_id"],
                    recv.quantity_received,
                )

                receipt_summary.append({
                    "shipment_item_id": recv.shipment_item_id,
                    "product_id": shi["product_id"],
                    "bqms_code": shi.get("bqms_code"),
                    "quantity_received": recv.quantity_received,
                    "unit": shi.get("unit", "EA"),
                })

        # Mark shipment as received
        updated = await conn.fetchrow(
            """
            UPDATE shipments SET
                status      = 'received',
                received_at = NOW(),
                updated_at  = NOW()
            WHERE id = $1
            RETURNING *
            """,
            shipment_id,
        )

        # Update linked PO status
        await conn.execute(
            """
            UPDATE purchase_orders SET status = 'received', received_at = NOW(), updated_at = NOW()
            WHERE id = $1 AND status NOT IN ('received', 'cancelled')
            """,
            shipment["po_id"],
        )

        # Update revenue_chain stage
        if shipment.get("chain_code"):
            await conn.execute(
                """
                UPDATE revenue_chain SET
                    current_stage   = 'invoice',
                    shipment_status = 'received',
                    updated_at      = NOW()
                WHERE chain_code = $1
                """,
                shipment["chain_code"],
            )

        await conn.execute(
            """
            INSERT INTO domain_events (event_type, aggregate_type, aggregate_id, payload, chain_code, created_by)
            VALUES ('shipment.received', 'shipment', $1, $2, $3, $4::uuid)
            """,
            str(shipment_id),
            f'{{"items_received": {len(receipt_summary)}}}',
            shipment.get("chain_code"),
            token_data.user_id,
        )

    return {
        "data": {
            "shipment_id": shipment_id,
            "shipment_number": updated["shipment_number"],
            "status": updated["status"],
            "received_at": str(updated["received_at"]),
            "items": receipt_summary,
            "po_id": shipment["po_id"],
        },
        "message": f"Đã xác nhận nhận hàng lô {updated['shipment_number']} — {len(receipt_summary)} sản phẩm nhập kho",
    }
