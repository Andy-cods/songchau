"""Sales Orders API — CRUD for selling to customers (Samsung, EAE, LG, khach le)."""

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

class SOLineItem(BaseModel):
    product_id: int | None = None
    product_code: str | None = None
    product_name: str
    specification: str | None = None
    unit: str = "EA"
    quantity: float
    unit_price: float
    vat_rate: float = 10
    notes: str | None = None


class SOCreateRequest(BaseModel):
    customer_id: int
    customer_name: str | None = None
    company_id: int | None = None
    order_date: date
    requested_delivery_date: date | None = None
    currency: str = "VND"
    advance_payment: float = 0
    source_system: str | None = None
    source_ref: str | None = None
    notes: str | None = None
    line_items: list[SOLineItem]


class SOUpdateRequest(BaseModel):
    customer_id: int | None = None
    customer_name: str | None = None
    requested_delivery_date: date | None = None
    currency: str | None = None
    advance_payment: float | None = None
    notes: str | None = None
    line_items: list[SOLineItem] | None = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _get_so(conn: asyncpg.Connection, so_id: int) -> dict:
    row = await conn.fetchrow(
        "SELECT * FROM sales_orders WHERE id = $1", so_id
    )
    if not row:
        raise HTTPException(status_code=404, detail="Đơn bán hàng không tồn tại")
    return dict(row)


async def _get_so_lines(conn: asyncpg.Connection, so_id: int) -> list[dict]:
    rows = await conn.fetch(
        """
        SELECT soi.*, p.bqms_code
        FROM sales_order_items soi
        LEFT JOIN products p ON p.id = soi.product_id
        WHERE soi.sales_order_id = $1
        ORDER BY soi.line_number ASC
        """,
        so_id,
    )
    return [dict(r) for r in rows]


def _generate_order_number_sql() -> str:
    return (
        "'SO-' || TO_CHAR(NOW(), 'YYYYMM') || '-' || "
        "LPAD(NEXTVAL('sales_order_number_seq')::TEXT, 6, '0')"
    )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("")
async def list_sales_orders(
    customer_id: int | None = Query(None),
    status: str | None = Query(None),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    token_data: TokenData = Depends(require_role("staff", "manager", "admin", "accountant")),
    conn: asyncpg.Connection = Depends(get_db),
):
    conditions = ["1=1"]
    params: list = []
    idx = 1

    if customer_id:
        conditions.append(f"so.customer_id = ${idx}")
        params.append(customer_id)
        idx += 1
    if status:
        conditions.append(f"so.status = ${idx}")
        params.append(status)
        idx += 1
    if date_from:
        conditions.append(f"so.order_date >= ${idx}")
        params.append(date_from)
        idx += 1
    if date_to:
        conditions.append(f"so.order_date <= ${idx}")
        params.append(date_to)
        idx += 1

    where = " AND ".join(conditions)

    total = await conn.fetchval(
        f"SELECT COUNT(*) FROM sales_orders so WHERE {where}", *params
    )

    params.extend([limit, offset])
    rows = await conn.fetch(
        f"""
        SELECT so.*, c.company_name AS customer_display_name,
               u.full_name AS creator_name
        FROM sales_orders so
        LEFT JOIN customers c ON c.id = so.customer_id
        LEFT JOIN users u ON u.id = so.created_by
        WHERE {where}
        ORDER BY so.created_at DESC
        LIMIT ${idx} OFFSET ${idx + 1}
        """,
        *params,
    )
    return {"data": [dict(r) for r in rows], "total": total}


@router.post("", status_code=201)
async def create_sales_order(
    body: SOCreateRequest,
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    if not body.line_items:
        raise HTTPException(status_code=400, detail="Đơn bán hàng phải có ít nhất 1 dòng sản phẩm")

    subtotal = sum(li.quantity * li.unit_price for li in body.line_items)
    vat_total = sum(
        li.quantity * li.unit_price * (li.vat_rate / 100) for li in body.line_items
    )
    total_amount = subtotal + vat_total
    remaining = total_amount - (body.advance_payment or 0)

    async with conn.transaction():
        so = await conn.fetchrow(
            f"""
            INSERT INTO sales_orders
                (order_number, company_id, customer_id, customer_name,
                 order_date, requested_delivery_date, status,
                 subtotal, vat_amount, total_amount, currency,
                 advance_payment, remaining_payment,
                 source_system, source_ref, notes, created_by)
            VALUES (
                {_generate_order_number_sql()},
                $1, $2, $3, $4, $5, 'draft',
                $6, $7, $8, $9::currency_code,
                $10, $11,
                $12, $13, $14, $15::uuid
            )
            RETURNING *
            """,
            body.company_id,
            body.customer_id,
            body.customer_name,
            body.order_date,
            body.requested_delivery_date,
            subtotal,
            vat_total,
            total_amount,
            body.currency,
            body.advance_payment,
            remaining,
            body.source_system,
            body.source_ref,
            body.notes,
            token_data.user_id,
        )
        so_id = so["id"]

        for i, li in enumerate(body.line_items, start=1):
            line_amount = li.quantity * li.unit_price
            await conn.execute(
                """
                INSERT INTO sales_order_items
                    (sales_order_id, line_number, product_id, product_code,
                     product_name, specification, unit, quantity,
                     unit_price, amount, vat_rate, notes)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                """,
                so_id,
                i,
                li.product_id,
                li.product_code,
                li.product_name,
                li.specification,
                li.unit,
                li.quantity,
                li.unit_price,
                line_amount,
                li.vat_rate,
                li.notes,
            )

    return {"data": dict(so), "message": "Đã tạo đơn bán hàng"}


@router.get("/{so_id}")
async def get_sales_order(
    so_id: int,
    token_data: TokenData = Depends(require_role("staff", "manager", "admin", "accountant")),
    conn: asyncpg.Connection = Depends(get_db),
):
    so = await _get_so(conn, so_id)
    lines = await _get_so_lines(conn, so_id)

    customer = await conn.fetchrow(
        "SELECT id, customer_name, customer_code, tax_code, phone, email "
        "FROM customers WHERE id = $1",
        so.get("customer_id"),
    )

    so["line_items"] = lines
    so["customer"] = dict(customer) if customer else None
    return {"data": so}


@router.put("/{so_id}")
async def update_sales_order(
    so_id: int,
    body: SOUpdateRequest,
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    so = await _get_so(conn, so_id)
    if so["status"] not in ("draft", "confirmed"):
        raise HTTPException(
            status_code=400,
            detail="Chỉ có thể sửa đơn hàng ở trạng thái nháp hoặc đã xác nhận",
        )

    async with conn.transaction():
        updates: dict = {}
        if body.customer_id is not None:
            updates["customer_id"] = body.customer_id
        if body.customer_name is not None:
            updates["customer_name"] = body.customer_name
        if body.requested_delivery_date is not None:
            updates["requested_delivery_date"] = body.requested_delivery_date
        if body.currency is not None:
            updates["currency"] = body.currency
        if body.advance_payment is not None:
            updates["advance_payment"] = body.advance_payment
        if body.notes is not None:
            updates["notes"] = body.notes

        if body.line_items is not None:
            subtotal = sum(li.quantity * li.unit_price for li in body.line_items)
            vat_total = sum(
                li.quantity * li.unit_price * (li.vat_rate / 100)
                for li in body.line_items
            )
            total_amount = subtotal + vat_total
            advance = body.advance_payment if body.advance_payment is not None else float(so.get("advance_payment") or 0)
            updates["subtotal"] = subtotal
            updates["vat_amount"] = vat_total
            updates["total_amount"] = total_amount
            updates["remaining_payment"] = total_amount - advance

            await conn.execute(
                "DELETE FROM sales_order_items WHERE sales_order_id = $1", so_id
            )
            for i, li in enumerate(body.line_items, start=1):
                line_amount = li.quantity * li.unit_price
                await conn.execute(
                    """
                    INSERT INTO sales_order_items
                        (sales_order_id, line_number, product_id, product_code,
                         product_name, specification, unit, quantity,
                         unit_price, amount, vat_rate, notes)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                    """,
                    so_id,
                    i,
                    li.product_id,
                    li.product_code,
                    li.product_name,
                    li.specification,
                    li.unit,
                    li.quantity,
                    li.unit_price,
                    line_amount,
                    li.vat_rate,
                    li.notes,
                )

        if updates:
            set_parts = []
            values: list = []
            for i, (col, val) in enumerate(updates.items(), start=1):
                set_parts.append(f"{col} = ${i}")
                values.append(val)
            values.append(so_id)
            row = await conn.fetchrow(
                f"UPDATE sales_orders SET {', '.join(set_parts)}, updated_at = NOW() "
                f"WHERE id = ${len(values)} RETURNING *",
                *values,
            )
        else:
            row = await conn.fetchrow(
                "SELECT * FROM sales_orders WHERE id = $1", so_id
            )

    return {"data": dict(row)}


@router.post("/{so_id}/deliver")
async def deliver_sales_order(
    so_id: int,
    token_data: TokenData = Depends(require_role("staff", "manager", "admin", "warehouse")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Mark a sales order as delivered and deduct inventory."""
    so = await _get_so(conn, so_id)
    if so["status"] not in ("confirmed", "in_progress", "shipped"):
        raise HTTPException(
            status_code=400,
            detail="Chỉ có thể giao hàng cho đơn đã xác nhận, đang xử lý hoặc đã gửi",
        )

    async with conn.transaction():
        # Get line items and deduct inventory
        lines = await conn.fetch(
            "SELECT * FROM sales_order_items WHERE sales_order_id = $1",
            so_id,
        )

        for line in lines:
            if line["product_id"]:
                # Deduct from inventory
                await conn.execute(
                    """
                    UPDATE inventory
                    SET quantity = quantity - $1, updated_at = NOW()
                    WHERE product_id = $2 AND quantity >= $1
                    """,
                    float(line["quantity"]),
                    line["product_id"],
                )

                # Record outbound movement
                await conn.execute(
                    """
                    INSERT INTO inventory_movements
                        (product_id, movement_type, quantity, reference_type,
                         reference_id, note, created_by)
                    VALUES ($1, 'out', $2, 'sales_order', $3, $4, $5)
                    """,
                    line["product_id"],
                    float(line["quantity"]),
                    str(so_id),
                    f"Giao hàng SO #{so.get('order_number', so_id)}",
                    token_data.user_id,
                )

            # Update delivered qty on line
            await conn.execute(
                """
                UPDATE sales_order_items
                SET delivered_qty = quantity
                WHERE id = $1
                """,
                line["id"],
            )

        # Update SO status
        row = await conn.fetchrow(
            """
            UPDATE sales_orders
            SET status = 'delivered', delivered_date = CURRENT_DATE, updated_at = NOW()
            WHERE id = $1
            RETURNING *
            """,
            so_id,
        )

    return {
        "data": dict(row),
        "message": "Đã xác nhận giao hàng thành công",
    }
