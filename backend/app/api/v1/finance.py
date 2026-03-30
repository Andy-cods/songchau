"""Finance API — Accounts Payable, Accounts Receivable, Payments, Cash Book."""

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

class APCreateRequest(BaseModel):
    supplier_id: int
    po_id: int | None = None
    invoice_number: str | None = None
    invoice_date: date
    due_date: date
    amount: float
    currency: str = "USD"
    exchange_rate: float | None = None
    amount_vnd: float | None = None
    payment_terms: str | None = None
    notes: str | None = None


class ARCreateRequest(BaseModel):
    customer_id: int
    invoice_id: int | None = None
    sales_order_id: int | None = None
    invoice_number: str | None = None
    invoice_date: date
    due_date: date
    amount: float
    currency: str = "VND"
    notes: str | None = None


class PaymentCreateRequest(BaseModel):
    direction: str  # 'inbound' or 'outbound'
    ap_id: int | None = None
    ar_id: int | None = None
    payment_date: date
    amount: float
    currency: str = "VND"
    exchange_rate: float | None = None
    payment_method: str | None = None
    bank_name: str | None = None
    bank_ref: str | None = None
    notes: str | None = None


class CashBookEntryRequest(BaseModel):
    company_id: int | None = None
    entry_date: date
    document_number: str | None = None
    category_id: int | None = None
    counterparty: str | None = None
    description: str
    amount: float
    direction: str  # 'thu' or 'chi'
    notes: str | None = None


# ---------------------------------------------------------------------------
# Accounts Payable
# ---------------------------------------------------------------------------

@router.get("/payables")
async def list_payables(
    supplier_id: int | None = Query(None),
    status: str | None = Query(None),
    overdue: bool | None = Query(None, description="Chỉ lọc công nợ quá hạn"),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    token_data: TokenData = Depends(require_role("accountant", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    conditions = ["1=1"]
    params: list = []
    idx = 1

    if supplier_id:
        conditions.append(f"ap.supplier_id = ${idx}")
        params.append(supplier_id)
        idx += 1
    if status:
        conditions.append(f"ap.status = ${idx}::payment_status")
        params.append(status)
        idx += 1
    if overdue is True:
        conditions.append("ap.due_date < CURRENT_DATE AND ap.status NOT IN ('paid')")
    if date_from:
        conditions.append(f"ap.invoice_date >= ${idx}")
        params.append(date_from)
        idx += 1
    if date_to:
        conditions.append(f"ap.invoice_date <= ${idx}")
        params.append(date_to)
        idx += 1

    where = " AND ".join(conditions)

    total = await conn.fetchval(
        f"SELECT COUNT(*) FROM accounts_payable ap WHERE {where}", *params
    )

    params.extend([limit, offset])
    rows = await conn.fetch(
        f"""
        SELECT ap.*, s.name AS supplier_name
        FROM accounts_payable ap
        LEFT JOIN suppliers s ON s.id = ap.supplier_id
        WHERE {where}
        ORDER BY ap.due_date ASC
        LIMIT ${idx} OFFSET ${idx + 1}
        """,
        *params,
    )
    return {"data": [dict(r) for r in rows], "total": total}


@router.post("/payables", status_code=201)
async def create_payable(
    body: APCreateRequest,
    token_data: TokenData = Depends(require_role("accountant", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    if body.amount <= 0:
        raise HTTPException(status_code=400, detail="Số tiền phải lớn hơn 0")
    if body.due_date < body.invoice_date:
        raise HTTPException(status_code=400, detail="Ngày đến hạn phải sau ngày hóa đơn")

    row = await conn.fetchrow(
        """
        INSERT INTO accounts_payable
            (supplier_id, po_id, invoice_number, invoice_date, due_date,
             amount, currency, exchange_rate, amount_vnd, payment_terms,
             notes, created_by)
        VALUES ($1, $2, $3, $4, $5,
                $6, $7::currency_code, $8, $9, $10,
                $11, $12::uuid)
        RETURNING *
        """,
        body.supplier_id,
        body.po_id,
        body.invoice_number,
        body.invoice_date,
        body.due_date,
        body.amount,
        body.currency,
        body.exchange_rate,
        body.amount_vnd,
        body.payment_terms,
        body.notes,
        token_data.user_id,
    )
    return {"data": dict(row), "message": "Đã tạo công nợ phải trả"}


# ---------------------------------------------------------------------------
# Accounts Receivable
# ---------------------------------------------------------------------------

@router.get("/receivables")
async def list_receivables(
    customer_id: int | None = Query(None),
    status: str | None = Query(None),
    overdue: bool | None = Query(None),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    token_data: TokenData = Depends(require_role("accountant", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    conditions = ["1=1"]
    params: list = []
    idx = 1

    if customer_id:
        conditions.append(f"ar.customer_id = ${idx}")
        params.append(customer_id)
        idx += 1
    if status:
        conditions.append(f"ar.status = ${idx}::payment_status")
        params.append(status)
        idx += 1
    if overdue is True:
        conditions.append("ar.due_date < CURRENT_DATE AND ar.status NOT IN ('paid')")
    if date_from:
        conditions.append(f"ar.invoice_date >= ${idx}")
        params.append(date_from)
        idx += 1
    if date_to:
        conditions.append(f"ar.invoice_date <= ${idx}")
        params.append(date_to)
        idx += 1

    where = " AND ".join(conditions)

    total = await conn.fetchval(
        f"SELECT COUNT(*) FROM accounts_receivable ar WHERE {where}", *params
    )

    params.extend([limit, offset])
    rows = await conn.fetch(
        f"""
        SELECT ar.*, c.company_name AS customer_name
        FROM accounts_receivable ar
        LEFT JOIN customers c ON c.id = ar.customer_id
        WHERE {where}
        ORDER BY ar.due_date ASC
        LIMIT ${idx} OFFSET ${idx + 1}
        """,
        *params,
    )
    return {"data": [dict(r) for r in rows], "total": total}


@router.post("/receivables", status_code=201)
async def create_receivable(
    body: ARCreateRequest,
    token_data: TokenData = Depends(require_role("accountant", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    if body.amount <= 0:
        raise HTTPException(status_code=400, detail="Số tiền phải lớn hơn 0")
    if body.due_date < body.invoice_date:
        raise HTTPException(status_code=400, detail="Ngày đến hạn phải sau ngày hóa đơn")

    row = await conn.fetchrow(
        """
        INSERT INTO accounts_receivable
            (customer_id, invoice_id, sales_order_id, invoice_number,
             invoice_date, due_date, amount, currency, notes, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::currency_code, $9, $10::uuid)
        RETURNING *
        """,
        body.customer_id,
        body.invoice_id,
        body.sales_order_id,
        body.invoice_number,
        body.invoice_date,
        body.due_date,
        body.amount,
        body.currency,
        body.notes,
        token_data.user_id,
    )
    return {"data": dict(row), "message": "Đã tạo công nợ phải thu"}


# ---------------------------------------------------------------------------
# Payments
# ---------------------------------------------------------------------------

@router.get("/payments")
async def list_payments(
    direction: str | None = Query(None, description="inbound hoặc outbound"),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    token_data: TokenData = Depends(require_role("accountant", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    conditions = ["1=1"]
    params: list = []
    idx = 1

    if direction:
        conditions.append(f"pt.direction = ${idx}::payment_direction")
        params.append(direction)
        idx += 1
    if date_from:
        conditions.append(f"pt.payment_date >= ${idx}")
        params.append(date_from)
        idx += 1
    if date_to:
        conditions.append(f"pt.payment_date <= ${idx}")
        params.append(date_to)
        idx += 1

    where = " AND ".join(conditions)

    total = await conn.fetchval(
        f"SELECT COUNT(*) FROM payment_transactions pt WHERE {where}", *params
    )

    params.extend([limit, offset])
    rows = await conn.fetch(
        f"""
        SELECT pt.*,
               s.name AS supplier_name,
               c.company_name AS customer_name
        FROM payment_transactions pt
        LEFT JOIN accounts_payable ap ON ap.id = pt.ap_id
        LEFT JOIN suppliers s ON s.id = ap.supplier_id
        LEFT JOIN accounts_receivable ar ON ar.id = pt.ar_id
        LEFT JOIN customers c ON c.id = ar.customer_id
        WHERE {where}
        ORDER BY pt.payment_date DESC, pt.created_at DESC
        LIMIT ${idx} OFFSET ${idx + 1}
        """,
        *params,
    )
    return {"data": [dict(r) for r in rows], "total": total}


@router.post("/payments", status_code=201)
async def create_payment(
    body: PaymentCreateRequest,
    token_data: TokenData = Depends(require_role("accountant", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    if body.amount <= 0:
        raise HTTPException(status_code=400, detail="Số tiền thanh toán phải lớn hơn 0")
    if body.direction not in ("inbound", "outbound"):
        raise HTTPException(status_code=400, detail="Hướng thanh toán phải là 'inbound' hoặc 'outbound'")
    if body.direction == "outbound" and not body.ap_id:
        raise HTTPException(status_code=400, detail="Thanh toán chi (outbound) cần có mã công nợ phải trả (ap_id)")
    if body.direction == "inbound" and not body.ar_id:
        raise HTTPException(status_code=400, detail="Thanh toán thu (inbound) cần có mã công nợ phải thu (ar_id)")

    async with conn.transaction():
        # Record payment
        pt = await conn.fetchrow(
            """
            INSERT INTO payment_transactions
                (direction, ap_id, ar_id, payment_date, amount,
                 currency, exchange_rate, payment_method,
                 bank_name, bank_ref, notes, created_by)
            VALUES ($1::payment_direction, $2, $3, $4, $5,
                    $6::currency_code, $7, $8,
                    $9, $10, $11, $12::uuid)
            RETURNING *
            """,
            body.direction,
            body.ap_id,
            body.ar_id,
            body.payment_date,
            body.amount,
            body.currency,
            body.exchange_rate,
            body.payment_method,
            body.bank_name,
            body.bank_ref,
            body.notes,
            token_data.user_id,
        )

        # Update AP or AR paid_amount and status
        if body.direction == "outbound" and body.ap_id:
            ap = await conn.fetchrow(
                """
                UPDATE accounts_payable
                SET paid_amount = paid_amount + $1,
                    status = CASE
                        WHEN paid_amount + $1 >= amount THEN 'paid'::payment_status
                        WHEN paid_amount + $1 > 0 THEN 'partial_paid'::payment_status
                        ELSE status
                    END,
                    updated_at = NOW()
                WHERE id = $2
                RETURNING *
                """,
                body.amount,
                body.ap_id,
            )
            if not ap:
                raise HTTPException(status_code=404, detail="Công nợ phải trả không tồn tại")

        if body.direction == "inbound" and body.ar_id:
            ar = await conn.fetchrow(
                """
                UPDATE accounts_receivable
                SET paid_amount = paid_amount + $1,
                    status = CASE
                        WHEN paid_amount + $1 >= amount THEN 'paid'::payment_status
                        WHEN paid_amount + $1 > 0 THEN 'partial_paid'::payment_status
                        ELSE status
                    END,
                    updated_at = NOW()
                WHERE id = $2
                RETURNING *
                """,
                body.amount,
                body.ar_id,
            )
            if not ar:
                raise HTTPException(status_code=404, detail="Công nợ phải thu không tồn tại")

    return {"data": dict(pt), "message": "Đã ghi nhận thanh toán"}


# ---------------------------------------------------------------------------
# Cash Book
# ---------------------------------------------------------------------------

@router.get("/cash-book")
async def list_cash_book(
    direction: str | None = Query(None, description="thu hoặc chi"),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    category_id: int | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    token_data: TokenData = Depends(require_role("accountant", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    conditions = ["1=1"]
    params: list = []
    idx = 1

    if direction:
        conditions.append(f"cb.direction = ${idx}")
        params.append(direction)
        idx += 1
    if date_from:
        conditions.append(f"cb.entry_date >= ${idx}")
        params.append(date_from)
        idx += 1
    if date_to:
        conditions.append(f"cb.entry_date <= ${idx}")
        params.append(date_to)
        idx += 1
    if category_id:
        conditions.append(f"cb.category_id = ${idx}")
        params.append(category_id)
        idx += 1

    where = " AND ".join(conditions)

    total = await conn.fetchval(
        f"SELECT COUNT(*) FROM cash_book cb WHERE {where}", *params
    )

    params.extend([limit, offset])
    rows = await conn.fetch(
        f"""
        SELECT cb.*, cat.category_name, cat.category_code
        FROM cash_book cb
        LEFT JOIN cash_book_categories cat ON cat.id = cb.category_id
        WHERE {where}
        ORDER BY cb.entry_date DESC, cb.created_at DESC
        LIMIT ${idx} OFFSET ${idx + 1}
        """,
        *params,
    )
    return {"data": [dict(r) for r in rows], "total": total}


@router.post("/cash-book", status_code=201)
async def create_cash_book_entry(
    body: CashBookEntryRequest,
    token_data: TokenData = Depends(require_role("accountant", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    if body.amount <= 0:
        raise HTTPException(status_code=400, detail="Số tiền phải lớn hơn 0")
    if body.direction not in ("thu", "chi"):
        raise HTTPException(status_code=400, detail="Hướng phải là 'thu' hoặc 'chi'")
    if not body.description or len(body.description.strip()) < 3:
        raise HTTPException(status_code=400, detail="Mô tả phải có ít nhất 3 ký tự")

    # Calculate running balance
    last_balance = await conn.fetchval(
        """
        SELECT balance_after FROM cash_book
        WHERE company_id IS NOT DISTINCT FROM $1
        ORDER BY entry_date DESC, created_at DESC
        LIMIT 1
        """,
        body.company_id,
    )
    last_balance = float(last_balance) if last_balance else 0
    if body.direction == "thu":
        new_balance = last_balance + body.amount
    else:
        new_balance = last_balance - body.amount

    row = await conn.fetchrow(
        """
        INSERT INTO cash_book
            (company_id, entry_date, document_number, category_id,
             counterparty, description, amount, direction,
             balance_after, notes, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::uuid)
        RETURNING *
        """,
        body.company_id,
        body.entry_date,
        body.document_number,
        body.category_id,
        body.counterparty,
        body.description,
        body.amount,
        body.direction,
        new_balance,
        body.notes,
        token_data.user_id,
    )
    return {"data": dict(row), "message": "Đã ghi sổ quỹ"}


# ---------------------------------------------------------------------------
# Financial Summary
# ---------------------------------------------------------------------------

@router.get("/summary")
async def financial_summary(
    token_data: TokenData = Depends(require_role("accountant", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Overall financial summary: total AP, AR, cash balance."""

    # Total AP (outstanding)
    ap_stats = await conn.fetchrow(
        """
        SELECT
            COUNT(*) AS total_count,
            COALESCE(SUM(amount), 0) AS total_amount,
            COALESCE(SUM(paid_amount), 0) AS total_paid,
            COALESCE(SUM(amount - paid_amount), 0) AS total_outstanding,
            COUNT(*) FILTER (WHERE due_date < CURRENT_DATE AND status NOT IN ('paid')) AS overdue_count,
            COALESCE(SUM(amount - paid_amount) FILTER (WHERE due_date < CURRENT_DATE AND status NOT IN ('paid')), 0) AS overdue_amount
        FROM accounts_payable
        WHERE status != 'paid'
        """
    )

    # Total AR (outstanding)
    ar_stats = await conn.fetchrow(
        """
        SELECT
            COUNT(*) AS total_count,
            COALESCE(SUM(amount), 0) AS total_amount,
            COALESCE(SUM(paid_amount), 0) AS total_paid,
            COALESCE(SUM(amount - paid_amount), 0) AS total_outstanding,
            COUNT(*) FILTER (WHERE due_date < CURRENT_DATE AND status NOT IN ('paid')) AS overdue_count,
            COALESCE(SUM(amount - paid_amount) FILTER (WHERE due_date < CURRENT_DATE AND status NOT IN ('paid')), 0) AS overdue_amount
        FROM accounts_receivable
        WHERE status != 'paid'
        """
    )

    # Cash balance (latest entry per company)
    cash_balance = await conn.fetchval(
        """
        SELECT COALESCE(balance_after, 0)
        FROM cash_book
        ORDER BY entry_date DESC, created_at DESC
        LIMIT 1
        """
    )

    # Monthly payment totals (current month)
    monthly = await conn.fetchrow(
        """
        SELECT
            COALESCE(SUM(amount) FILTER (WHERE direction = 'inbound'), 0) AS inbound_total,
            COALESCE(SUM(amount) FILTER (WHERE direction = 'outbound'), 0) AS outbound_total
        FROM payment_transactions
        WHERE DATE_TRUNC('month', payment_date) = DATE_TRUNC('month', CURRENT_DATE)
        """
    )

    return {
        "data": {
            "accounts_payable": dict(ap_stats) if ap_stats else {},
            "accounts_receivable": dict(ar_stats) if ar_stats else {},
            "cash_balance": float(cash_balance) if cash_balance else 0,
            "monthly_payments": dict(monthly) if monthly else {},
        }
    }
