"""Bảng kê hóa đơn theo quý — Bán ra + Mua vào."""

from __future__ import annotations

import io
import json
import logging
from datetime import datetime
from typing import Any

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form, Request

from app.core.database import get_db
from app.core.rbac import require_role
from app.core.security import TokenData
from app.core.config import settings

logger = logging.getLogger(__name__)
router = APIRouter()


async def _write_audit_log(
    conn: asyncpg.Connection,
    token_data: TokenData,
    action: str,
    table_name: str,
    record_id: int | str,
    old_data: dict[str, Any] | None,
    new_data: dict[str, Any] | None,
    request: Request | None = None,
) -> None:
    """Write immutable audit log entry for finance edits."""
    await conn.execute(
        """
        INSERT INTO audit_log (
            user_id,
            user_email,
            action,
            table_name,
            record_id,
            old_data,
            new_data,
            ip_address,
            user_agent
        )
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::inet, $9)
        """,
        token_data.user_id,
        token_data.email,
        action,
        table_name,
        str(record_id),
        json.dumps(old_data or {}, ensure_ascii=False, default=str),
        json.dumps(new_data or {}, ensure_ascii=False, default=str),
        request.client.host if request and request.client else None,
        request.headers.get("user-agent") if request else None,
    )


# ---------------------------------------------------------------------------
# List sales (Bán ra) + summary
# ---------------------------------------------------------------------------

@router.get("/sales")
async def list_sales(
    quarter: str = Query("Q1-2026"),
    search: str = Query(""),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    token_data: TokenData = Depends(require_role("staff", "accountant", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Danh sách hóa đơn bán ra theo quý."""
    where = "quarter = $1"
    params: list = [quarter]
    idx = 2

    if search:
        where += f" AND (invoice_number ILIKE ${idx} OR buyer_name ILIKE ${idx} OR item_name ILIKE ${idx})"
        params.append(f"%{search}%")
        idx += 1

    total = await conn.fetchval(
        f"SELECT COUNT(*) FROM sales_invoices_q WHERE {where}", *params
    )

    summary = await conn.fetchrow(f"""
        SELECT
            COALESCE(SUM(amount_before_tax), 0)::bigint AS total_before_tax,
            COALESCE(SUM(tax_amount), 0)::bigint AS total_tax,
            COALESCE(SUM(total_amount), 0)::bigint AS total_with_tax,
            COALESCE(SUM(cost_price), 0)::bigint AS total_cost,
            COALESCE(SUM(cost_vat), 0)::bigint AS total_cost_vat,
            COALESCE(SUM(shipping_cost), 0)::bigint AS total_shipping_cost,
            COALESCE(SUM(customs_fee), 0)::bigint AS total_customs_fee,
            COALESCE(SUM(commission), 0)::bigint AS total_commission,
            COALESCE(SUM(other_costs), 0)::bigint AS total_other_costs,
            COALESCE(SUM(manual_adjustment), 0)::bigint AS total_manual_adjustment,
            COALESCE(
                SUM(COALESCE(cost_price, 0) + COALESCE(cost_vat, 0) + COALESCE(shipping_cost, 0)
                    + COALESCE(customs_fee, 0) + COALESCE(commission, 0)
                    + COALESCE(other_costs, 0) + COALESCE(manual_adjustment, 0)),
                0
            )::bigint AS total_configured_cost,
            COALESCE(SUM(amount_before_tax) - SUM(cost_price), 0)::bigint AS gross_profit,
            COALESCE(
                SUM(amount_before_tax)
                - SUM(
                    COALESCE(cost_price, 0) + COALESCE(cost_vat, 0) + COALESCE(shipping_cost, 0)
                    + COALESCE(customs_fee, 0) + COALESCE(commission, 0)
                    + COALESCE(other_costs, 0) + COALESCE(manual_adjustment, 0)
                ),
                0
            )::bigint AS net_profit_after_costs,
            COUNT(*)::int AS count
        FROM sales_invoices_q WHERE {where}
    """, *params)

    params.extend([limit, (page - 1) * limit])
    rows = await conn.fetch(f"""
        SELECT * FROM sales_invoices_q
        WHERE {where}
        ORDER BY invoice_date ASC, invoice_number ASC
        LIMIT ${idx} OFFSET ${idx + 1}
    """, *params)

    return {
        "data": [dict(r) for r in rows],
        "total": total,
        "summary": dict(summary) if summary else {},
    }


@router.get("/purchases")
async def list_purchases(
    quarter: str = Query("Q1-2026"),
    search: str = Query(""),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    token_data: TokenData = Depends(require_role("staff", "accountant", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Danh sách hóa đơn mua vào theo quý."""
    where = "quarter = $1"
    params: list = [quarter]
    idx = 2

    if search:
        where += f" AND (invoice_number ILIKE ${idx} OR seller_name ILIKE ${idx} OR item_name ILIKE ${idx})"
        params.append(f"%{search}%")
        idx += 1

    total = await conn.fetchval(
        f"SELECT COUNT(*) FROM purchase_invoices_q WHERE {where}", *params
    )

    summary = await conn.fetchrow(f"""
        SELECT
            COALESCE(SUM(amount_before_tax), 0)::bigint AS total_before_tax,
            COALESCE(SUM(tax_amount), 0)::bigint AS total_tax,
            COALESCE(SUM(total_amount), 0)::bigint AS total_with_tax,
            COALESCE(SUM(shipping_cost), 0)::bigint AS total_shipping_cost,
            COALESCE(SUM(customs_fee), 0)::bigint AS total_customs_fee,
            COALESCE(SUM(other_costs), 0)::bigint AS total_other_costs,
            COALESCE(SUM(manual_adjustment), 0)::bigint AS total_manual_adjustment,
            COALESCE(
                SUM(COALESCE(shipping_cost, 0) + COALESCE(customs_fee, 0)
                    + COALESCE(other_costs, 0) + COALESCE(manual_adjustment, 0)),
                0
            )::bigint AS total_extra_costs,
            COUNT(*)::int AS count
        FROM purchase_invoices_q WHERE {where}
    """, *params)

    params.extend([limit, (page - 1) * limit])
    rows = await conn.fetch(f"""
        SELECT * FROM purchase_invoices_q
        WHERE {where}
        ORDER BY invoice_date ASC, invoice_number ASC
        LIMIT ${idx} OFFSET ${idx + 1}
    """, *params)

    return {
        "data": [dict(r) for r in rows],
        "total": total,
        "summary": dict(summary) if summary else {},
    }


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------

@router.post("/sales")
async def create_sale(
    body: dict[str, Any],
    token_data: TokenData = Depends(require_role("accountant", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Tạo hóa đơn bán ra."""
    row = await conn.fetchrow("""
        INSERT INTO sales_invoices_q
            (quarter, invoice_number, invoice_date, buyer_name, buyer_tax_code,
             item_name, unit, quantity, unit_price, amount_before_tax,
             tax_rate, tax_amount, total_amount, supplier_name, cost_price, cost_vat,
             shipping_cost, customs_fee, commission, other_costs, manual_adjustment, notes, source)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, 'manual')
        RETURNING *
    """,
        body.get("quarter", "Q1-2026"),
        body.get("invoice_number"),
        body.get("invoice_date"),
        body.get("buyer_name"),
        body.get("buyer_tax_code"),
        body.get("item_name"),
        body.get("unit"),
        body.get("quantity"),
        body.get("unit_price"),
        body.get("amount_before_tax"),
        body.get("tax_rate"),
        body.get("tax_amount"),
        body.get("total_amount"),
        body.get("supplier_name"),
        body.get("cost_price"),
        body.get("cost_vat"),
        body.get("shipping_cost", 0),
        body.get("customs_fee", 0),
        body.get("commission", 0),
        body.get("other_costs", 0),
        body.get("manual_adjustment", 0),
        body.get("notes"),
    )
    return {"data": dict(row), "message": "Đã tạo hóa đơn bán ra"}


@router.post("/purchases")
async def create_purchase(
    body: dict[str, Any],
    token_data: TokenData = Depends(require_role("accountant", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Tạo hóa đơn mua vào."""
    row = await conn.fetchrow("""
        INSERT INTO purchase_invoices_q
            (quarter, invoice_number, invoice_date, seller_name, seller_tax_code,
             item_name, unit, quantity, unit_price, amount_before_tax,
             tax_rate, tax_amount, total_amount, customer_code, item_code,
             shipping_cost, customs_fee, other_costs, manual_adjustment, notes, source)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, 'manual')
        RETURNING *
    """,
        body.get("quarter", "Q1-2026"),
        body.get("invoice_number"),
        body.get("invoice_date"),
        body.get("seller_name"),
        body.get("seller_tax_code"),
        body.get("item_name"),
        body.get("unit"),
        body.get("quantity"),
        body.get("unit_price"),
        body.get("amount_before_tax"),
        body.get("tax_rate"),
        body.get("tax_amount"),
        body.get("total_amount"),
        body.get("customer_code"),
        body.get("item_code"),
        body.get("shipping_cost", 0),
        body.get("customs_fee", 0),
        body.get("other_costs", 0),
        body.get("manual_adjustment", 0),
        body.get("notes"),
    )
    return {"data": dict(row), "message": "Đã tạo hóa đơn mua vào"}


@router.put("/sales/{inv_id}")
async def update_sale(
    inv_id: int,
    body: dict[str, Any],
    request: Request,
    token_data: TokenData = Depends(require_role("accountant", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Cập nhật hóa đơn bán ra."""
    allowed = {"invoice_number", "invoice_date", "buyer_name", "buyer_tax_code",
               "item_name", "unit", "quantity", "unit_price", "amount_before_tax",
               "tax_rate", "tax_amount", "total_amount", "supplier_name", "cost_price", "cost_vat",
               "shipping_cost", "customs_fee", "commission", "other_costs", "manual_adjustment", "notes"}
    sets = []
    params: list = []
    idx = 1
    for k, v in body.items():
        if k in allowed:
            sets.append(f"{k} = ${idx}")
            params.append(v)
            idx += 1
    if not sets:
        raise HTTPException(400, "Không có trường nào để cập nhật")

    old_row = await conn.fetchrow("SELECT * FROM sales_invoices_q WHERE id = $1", inv_id)
    if not old_row:
        raise HTTPException(404)

    old_row = await conn.fetchrow("SELECT * FROM purchase_invoices_q WHERE id = $1", inv_id)
    if not old_row:
        raise HTTPException(404)

    sets.append("updated_at = NOW()")
    params.append(inv_id)
    row = await conn.fetchrow(
        f"UPDATE sales_invoices_q SET {', '.join(sets)} WHERE id = ${idx} RETURNING *",
        *params,
    )
    await _write_audit_log(
        conn=conn,
        token_data=token_data,
        action="UPDATE",
        table_name="sales_invoices_q",
        record_id=inv_id,
        old_data=dict(old_row),
        new_data=dict(row),
        request=request,
    )
    return {"data": dict(row)}


@router.put("/purchases/{inv_id}")
async def update_purchase(
    inv_id: int,
    body: dict[str, Any],
    request: Request,
    token_data: TokenData = Depends(require_role("accountant", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Cập nhật hóa đơn mua vào."""
    allowed = {"invoice_number", "invoice_date", "seller_name", "seller_tax_code",
               "item_name", "unit", "quantity", "unit_price", "amount_before_tax",
               "tax_rate", "tax_amount", "total_amount", "customer_code", "item_code",
               "shipping_cost", "customs_fee", "other_costs", "manual_adjustment", "notes"}
    sets = []
    params: list = []
    idx = 1
    for k, v in body.items():
        if k in allowed:
            sets.append(f"{k} = ${idx}")
            params.append(v)
            idx += 1
    if not sets:
        raise HTTPException(400)

    old_row = await conn.fetchrow("SELECT * FROM purchase_invoices_q WHERE id = $1", inv_id)
    if not old_row:
        raise HTTPException(404)

    sets.append("updated_at = NOW()")
    params.append(inv_id)
    row = await conn.fetchrow(
        f"UPDATE purchase_invoices_q SET {', '.join(sets)} WHERE id = ${idx} RETURNING *",
        *params,
    )
    await _write_audit_log(
        conn=conn,
        token_data=token_data,
        action="UPDATE",
        table_name="purchase_invoices_q",
        record_id=inv_id,
        old_data=dict(old_row),
        new_data=dict(row),
        request=request,
    )
    return {"data": dict(row)}


@router.delete("/sales/{inv_id}")
async def delete_sale(
    inv_id: int,
    token_data: TokenData = Depends(require_role("manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    await conn.execute("DELETE FROM sales_invoices_q WHERE id = $1", inv_id)
    return {"message": "Đã xóa"}


@router.delete("/purchases/{inv_id}")
async def delete_purchase(
    inv_id: int,
    token_data: TokenData = Depends(require_role("manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    await conn.execute("DELETE FROM purchase_invoices_q WHERE id = $1", inv_id)
    return {"message": "Đã xóa"}


# ---------------------------------------------------------------------------
# Upload PDF + parse (basic — pdfplumber, no real OCR yet)
# ---------------------------------------------------------------------------

@router.post("/upload-pdf")
async def upload_invoice_pdf(
    invoice_type: str = Form(...),  # 'sales' or 'purchases'
    quarter: str = Form("Q2-2026"),
    file: UploadFile = File(...),
    token_data: TokenData = Depends(require_role("accountant", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Upload PDF hóa đơn → parse → tạo bản ghi nháp."""
    if not file.filename or not file.filename.lower().endswith('.pdf'):
        raise HTTPException(400, "Chỉ chấp nhận file PDF")

    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(400, "File quá lớn (>10MB)")

    # Save PDF
    from pathlib import Path
    upload_dir = Path(settings.FILES_BASE_PATH) / "invoices_pdf" / quarter
    upload_dir.mkdir(parents=True, exist_ok=True)
    dest = upload_dir / file.filename
    dest.write_bytes(content)

    # Try to parse with pdfplumber
    parsed = {}
    try:
        import pdfplumber
        with pdfplumber.open(dest) as pdf:
            text = ""
            for page in pdf.pages[:2]:  # only first 2 pages
                text += (page.extract_text() or "") + "\n"

        # Basic regex extraction (tiếng Việt invoice format)
        import re
        # Số HĐ
        m = re.search(r"S[ốốoo]\s*[:\s]+(\d{6,12})", text)
        if m: parsed["invoice_number"] = m.group(1)
        # Ngày
        m = re.search(r"(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})", text)
        if m:
            parsed["invoice_date"] = f"{m.group(3)}-{m.group(2).zfill(2)}-{m.group(1).zfill(2)}"
        # Tổng tiền
        m = re.search(r"T[ổổoo]ng\s*c[ộộoo]ng[:\s]+([\d,\.]+)", text)
        if m:
            try:
                parsed["total_amount"] = float(m.group(1).replace(",", "").replace(".", ""))
            except: pass

        parsed["raw_text"] = text[:500]  # for debug
    except Exception as e:
        logger.warning(f"PDF parse failed: {e}")

    # Insert draft record
    table = "sales_invoices_q" if invoice_type == "sales" else "purchase_invoices_q"
    name_col = "buyer_name" if invoice_type == "sales" else "seller_name"

    # Parse invoice_date to date object
    inv_date_str = parsed.get("invoice_date")
    if inv_date_str:
        try:
            inv_date = datetime.strptime(inv_date_str, "%Y-%m-%d").date()
        except (ValueError, TypeError):
            inv_date = datetime.now().date()
    else:
        inv_date = datetime.now().date()

    row = await conn.fetchrow(f"""
        INSERT INTO {table} (quarter, invoice_number, invoice_date, {name_col}, total_amount, source, pdf_path)
        VALUES ($1, $2, $3, $4, $5, 'pdf_ocr', $6)
        RETURNING *
    """,
        quarter,
        parsed.get("invoice_number") or "AUTO-" + datetime.now().strftime("%H%M%S"),
        inv_date,
        "Cần xác nhận",
        parsed.get("total_amount") or 0,
        str(dest),
    )

    return {
        "data": dict(row),
        "parsed": parsed,
        "message": f"Đã tải lên + parse PDF. Vui lòng review và chỉnh sửa.",
    }


# ---------------------------------------------------------------------------
# Quarter overview
# ---------------------------------------------------------------------------

@router.get("/overview")
async def quarter_overview(
    quarter: str = Query("Q1-2026"),
    token_data: TokenData = Depends(require_role("staff", "accountant", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Tổng quan bảng kê quý: doanh thu, chi phí, lợi nhuận."""
    sales = await conn.fetchrow("""
        SELECT
            COUNT(*)::int AS count,
            COALESCE(SUM(amount_before_tax), 0)::bigint AS total_before_tax,
            COALESCE(SUM(tax_amount), 0)::bigint AS total_tax,
            COALESCE(SUM(total_amount), 0)::bigint AS total_with_tax,
            COALESCE(SUM(cost_price), 0)::bigint AS total_cost
        FROM sales_invoices_q WHERE quarter = $1
    """, quarter)

    purchases = await conn.fetchrow("""
        SELECT
            COUNT(*)::int AS count,
            COALESCE(SUM(amount_before_tax), 0)::bigint AS total_before_tax,
            COALESCE(SUM(tax_amount), 0)::bigint AS total_tax,
            COALESCE(SUM(total_amount), 0)::bigint AS total_with_tax
        FROM purchase_invoices_q WHERE quarter = $1
    """, quarter)

    return {"data": {
        "quarter": quarter,
        "sales": dict(sales) if sales else {},
        "purchases": dict(purchases) if purchases else {},
    }}
