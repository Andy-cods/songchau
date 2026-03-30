"""Suppliers CRUD + fuzzy search + price history."""

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
import asyncpg

from app.core.database import get_db
from app.core.rbac import require_role
from app.core.security import TokenData

router = APIRouter()


class SupplierCreate(BaseModel):
    name: str
    contact_name: str | None = None
    contact_email: str | None = None
    contact_phone: str | None = None
    contact_wechat: str | None = None
    country: str = "CN"
    address: str | None = None
    payment_terms: str | None = None
    lead_time_days: int | None = None
    default_currency: str = "USD"
    tax_code: str | None = None
    notes: str | None = None


class SupplierUpdate(BaseModel):
    name: str | None = None
    contact_name: str | None = None
    contact_email: str | None = None
    contact_phone: str | None = None
    contact_wechat: str | None = None
    country: str | None = None
    address: str | None = None
    payment_terms: str | None = None
    lead_time_days: int | None = None
    tax_code: str | None = None
    notes: str | None = None
    is_active: bool | None = None


@router.get("")
async def list_suppliers(
    q: str | None = Query(None),
    is_active: bool | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    token_data: TokenData = Depends(require_role("admin", "manager", "procurement", "staff")),
    conn: asyncpg.Connection = Depends(get_db),
):
    conditions = ["deleted_at IS NULL"]
    params: list = []
    idx = 1

    if q:
        conditions.append(f"(name_unaccent ILIKE '%' || ${idx} || '%' OR name ILIKE '%' || ${idx} || '%')")
        params.append(q)
        idx += 1

    if is_active is not None:
        conditions.append(f"is_active = ${idx}")
        params.append(is_active)
        idx += 1

    where = " AND ".join(conditions)
    total = await conn.fetchval(f"SELECT COUNT(*) FROM suppliers WHERE {where}", *params)

    params.extend([limit, offset])
    rows = await conn.fetch(
        f"""SELECT id, name, contact_name, contact_email, contact_phone, contact_wechat,
                   country, address, payment_terms, lead_time_days, rating,
                   default_currency, tax_code, notes, is_active, created_at
            FROM suppliers WHERE {where}
            ORDER BY name ASC
            LIMIT ${idx} OFFSET ${idx + 1}""",
        *params,
    )
    return {"data": [dict(r) for r in rows], "total": total}


@router.post("", status_code=201)
async def create_supplier(
    body: SupplierCreate,
    token_data: TokenData = Depends(require_role("admin", "manager", "procurement")),
    conn: asyncpg.Connection = Depends(get_db),
):
    row = await conn.fetchrow(
        """INSERT INTO suppliers (name, contact_name, contact_email, contact_phone,
                contact_wechat, country, address, payment_terms, lead_time_days,
                default_currency, tax_code, notes, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::currency_code,$11,$12,$13::uuid)
           RETURNING *""",
        body.name, body.contact_name, body.contact_email, body.contact_phone,
        body.contact_wechat, body.country, body.address, body.payment_terms,
        body.lead_time_days, body.default_currency, body.tax_code, body.notes,
        token_data.user_id,
    )
    return {"data": dict(row)}


@router.get("/{supplier_id}")
async def get_supplier(
    supplier_id: int,
    token_data: TokenData = Depends(require_role("admin", "manager", "procurement", "staff")),
    conn: asyncpg.Connection = Depends(get_db),
):
    row = await conn.fetchrow("SELECT * FROM suppliers WHERE id = $1 AND deleted_at IS NULL", supplier_id)
    if not row:
        raise HTTPException(status_code=404, detail="Nhà cung cấp không tồn tại")
    return {"data": dict(row)}


@router.put("/{supplier_id}")
async def update_supplier(
    supplier_id: int,
    body: SupplierUpdate,
    token_data: TokenData = Depends(require_role("admin", "manager", "procurement")),
    conn: asyncpg.Connection = Depends(get_db),
):
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="Không có gì để cập nhật")

    set_parts = []
    values: list = []
    for i, (col, val) in enumerate(updates.items(), start=1):
        set_parts.append(f"{col} = ${i}")
        values.append(val)

    values.append(supplier_id)
    row = await conn.fetchrow(
        f"UPDATE suppliers SET {', '.join(set_parts)} WHERE id = ${len(values)} AND deleted_at IS NULL RETURNING *",
        *values,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Nhà cung cấp không tồn tại")
    return {"data": dict(row)}


@router.delete("/{supplier_id}")
async def deactivate_supplier(
    supplier_id: int,
    token_data: TokenData = Depends(require_role("admin", "manager")),
    conn: asyncpg.Connection = Depends(get_db),
):
    await conn.execute("UPDATE suppliers SET is_active = false WHERE id = $1", supplier_id)
    return {"message": "Đã vô hiệu hóa nhà cung cấp"}


@router.get("/{supplier_id}/price-history")
async def supplier_price_history(
    supplier_id: int,
    limit: int = Query(100, ge=1, le=500),
    token_data: TokenData = Depends(require_role("admin", "manager", "procurement")),
    conn: asyncpg.Connection = Depends(get_db),
):
    rows = await conn.fetch(
        """SELECT ph.*, p.product_name, p.bqms_code
           FROM price_history ph
           LEFT JOIN products p ON p.id = ph.product_id
           WHERE ph.supplier_id = $1
           ORDER BY ph.recorded_at DESC
           LIMIT $2""",
        supplier_id, limit,
    )
    return {"data": [dict(r) for r in rows], "total": len(rows)}
