"""Import/Export Tracking API — Theo doi xuat nhap khau."""

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

class XNKCreateRequest(BaseModel):
    company_id: int | None = None
    tracking_date: date | None = None
    rfq_number: str | None = None
    product_id: int | None = None
    bqms_code: str | None = None
    product_name: str | None = None
    detail_explain: str | None = None
    goods_type: str | None = None  # 'gia_cong' or 'thuong_mai'
    maker: str | None = None
    unit_calc: str | None = None
    quantity_calc: float | None = None
    quote_deadline: date | None = None
    transaction_date: date | None = None
    customs_description: str | None = None
    hs_code: str | None = None
    hs_code_id: int | None = None
    unit: str | None = None
    quantity: float | None = None
    total_usd: float | None = None
    unit_price_usd: float | None = None
    unit_price_vnd: float | None = None
    buyer_name: str | None = None
    seller_name: str | None = None
    purchased_qty: float | None = None
    alt_supplier: str | None = None
    notes: str | None = None
    year: int | None = None


class XNKUpdateRequest(BaseModel):
    tracking_date: date | None = None
    rfq_number: str | None = None
    product_id: int | None = None
    bqms_code: str | None = None
    product_name: str | None = None
    detail_explain: str | None = None
    goods_type: str | None = None
    maker: str | None = None
    unit_calc: str | None = None
    quantity_calc: float | None = None
    quote_deadline: date | None = None
    transaction_date: date | None = None
    customs_description: str | None = None
    hs_code: str | None = None
    hs_code_id: int | None = None
    unit: str | None = None
    quantity: float | None = None
    total_usd: float | None = None
    unit_price_usd: float | None = None
    unit_price_vnd: float | None = None
    buyer_name: str | None = None
    seller_name: str | None = None
    purchased_qty: float | None = None
    alt_supplier: str | None = None
    notes: str | None = None
    year: int | None = None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/summary")
async def xnk_summary(
    year: int | None = Query(None),
    token_data: TokenData = Depends(require_role("staff", "manager", "admin", "accountant")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Summary by year — total USD, total VND equivalent, by goods_type."""
    conditions = ["1=1"]
    params: list = []
    idx = 1

    if year:
        conditions.append(f"year = ${idx}")
        params.append(year)
        idx += 1

    where = " AND ".join(conditions)

    # Overall totals
    totals = await conn.fetchrow(
        f"""
        SELECT
            COUNT(*) AS total_records,
            COALESCE(SUM(total_usd), 0) AS total_usd,
            COALESCE(SUM(quantity), 0) AS total_quantity
        FROM import_export_tracking
        WHERE {where}
        """,
        *params,
    )

    # By goods_type
    by_type = await conn.fetch(
        f"""
        SELECT
            goods_type,
            COUNT(*) AS record_count,
            COALESCE(SUM(total_usd), 0) AS total_usd,
            COALESCE(SUM(quantity), 0) AS total_quantity
        FROM import_export_tracking
        WHERE {where}
        GROUP BY goods_type
        ORDER BY goods_type
        """,
        *params,
    )

    # By year
    by_year = await conn.fetch(
        """
        SELECT
            year,
            COUNT(*) AS record_count,
            COALESCE(SUM(total_usd), 0) AS total_usd,
            COALESCE(SUM(quantity), 0) AS total_quantity
        FROM import_export_tracking
        WHERE year IS NOT NULL
        GROUP BY year
        ORDER BY year DESC
        """
    )

    return {
        "data": {
            "totals": dict(totals) if totals else {},
            "by_goods_type": [dict(r) for r in by_type],
            "by_year": [dict(r) for r in by_year],
        }
    }


@router.get("")
async def list_xnk(
    year: int | None = Query(None),
    goods_type: str | None = Query(None),
    maker: str | None = Query(None),
    q: str | None = Query(None, description="Tìm theo tên sản phẩm, mã BQMS, RFQ"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    token_data: TokenData = Depends(require_role("staff", "manager", "admin", "accountant")),
    conn: asyncpg.Connection = Depends(get_db),
):
    conditions = ["1=1"]
    params: list = []
    idx = 1

    if year:
        conditions.append(f"xnk.year = ${idx}")
        params.append(year)
        idx += 1
    if goods_type:
        conditions.append(f"xnk.goods_type = ${idx}::goods_type")
        params.append(goods_type)
        idx += 1
    if maker:
        conditions.append(f"xnk.maker ILIKE '%' || ${idx} || '%'")
        params.append(maker)
        idx += 1
    if q:
        conditions.append(
            f"(xnk.product_name ILIKE '%' || ${idx} || '%' "
            f"OR xnk.bqms_code ILIKE '%' || ${idx} || '%' "
            f"OR xnk.rfq_number ILIKE '%' || ${idx} || '%')"
        )
        params.append(q)
        idx += 1

    where = " AND ".join(conditions)

    total = await conn.fetchval(
        f"SELECT COUNT(*) FROM import_export_tracking xnk WHERE {where}", *params
    )

    params.extend([limit, offset])
    rows = await conn.fetch(
        f"""
        SELECT xnk.*
        FROM import_export_tracking xnk
        WHERE {where}
        ORDER BY xnk.tracking_date DESC NULLS LAST, xnk.created_at DESC
        LIMIT ${idx} OFFSET ${idx + 1}
        """,
        *params,
    )
    return {"data": [dict(r) for r in rows], "total": total}


@router.post("", status_code=201)
async def create_xnk(
    body: XNKCreateRequest,
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    goods_type_val = body.goods_type

    row = await conn.fetchrow(
        """
        INSERT INTO import_export_tracking
            (company_id, tracking_date, rfq_number, product_id,
             bqms_code, product_name, detail_explain,
             goods_type, maker, unit_calc, quantity_calc,
             quote_deadline, transaction_date,
             customs_description, hs_code, hs_code_id,
             unit, quantity, total_usd,
             unit_price_usd, unit_price_vnd,
             buyer_name, seller_name,
             purchased_qty, alt_supplier,
             notes, year)
        VALUES ($1, $2, $3, $4,
                $5, $6, $7,
                $8::goods_type, $9, $10, $11,
                $12, $13,
                $14, $15, $16,
                $17, $18, $19,
                $20, $21,
                $22, $23,
                $24, $25,
                $26, $27)
        RETURNING *
        """,
        body.company_id,
        body.tracking_date,
        body.rfq_number,
        body.product_id,
        body.bqms_code,
        body.product_name,
        body.detail_explain,
        goods_type_val,
        body.maker,
        body.unit_calc,
        body.quantity_calc,
        body.quote_deadline,
        body.transaction_date,
        body.customs_description,
        body.hs_code,
        body.hs_code_id,
        body.unit,
        body.quantity,
        body.total_usd,
        body.unit_price_usd,
        body.unit_price_vnd,
        body.buyer_name,
        body.seller_name,
        body.purchased_qty,
        body.alt_supplier,
        body.notes,
        body.year,
    )
    return {"data": dict(row), "message": "Đã tạo bản ghi xuất nhập khẩu"}


@router.get("/{xnk_id}")
async def get_xnk(
    xnk_id: int,
    token_data: TokenData = Depends(require_role("staff", "manager", "admin", "accountant")),
    conn: asyncpg.Connection = Depends(get_db),
):
    row = await conn.fetchrow(
        "SELECT * FROM import_export_tracking WHERE id = $1", xnk_id
    )
    if not row:
        raise HTTPException(status_code=404, detail="Bản ghi xuất nhập khẩu không tồn tại")
    return {"data": dict(row)}


@router.put("/{xnk_id}")
async def update_xnk(
    xnk_id: int,
    body: XNKUpdateRequest,
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    existing = await conn.fetchrow(
        "SELECT id FROM import_export_tracking WHERE id = $1", xnk_id
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Bản ghi xuất nhập khẩu không tồn tại")

    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=400, detail="Không có gì để cập nhật")

    set_parts = []
    values: list = []
    for i, (col, val) in enumerate(updates.items(), start=1):
        if col == "goods_type":
            set_parts.append(f"{col} = ${i}::goods_type")
        else:
            set_parts.append(f"{col} = ${i}")
        values.append(val)

    values.append(xnk_id)
    row = await conn.fetchrow(
        f"UPDATE import_export_tracking SET {', '.join(set_parts)}, updated_at = NOW() "
        f"WHERE id = ${len(values)} RETURNING *",
        *values,
    )
    return {"data": dict(row), "message": "Đã cập nhật bản ghi xuất nhập khẩu"}
