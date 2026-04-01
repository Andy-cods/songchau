"""
Finance Management API (M29) — Cash Book, AP/AR Dashboard, Budget.

Endpoints:
  GET  /cash-book         — List cash book entries (date range, pagination)
  POST /cash-book         — Create cash book entry
  GET  /cash-flow         — Cash flow summary by month (last 12 months)
  GET  /ap-summary        — Accounts payable summary
  GET  /ar-summary        — Accounts receivable summary
  GET  /budget            — Budget vs actual for a month/year
  POST /budget            — Set budget target
  GET  /dashboard         — Finance overview KPIs
"""

from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator
import asyncpg

from app.core.database import get_db
from app.core.rbac import require_role
from app.core.security import TokenData

logger = logging.getLogger(__name__)
router = APIRouter()


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class CashBookCreateRequest(BaseModel):
    entry_date: date
    direction: Literal["income", "expense", "transfer"]
    category: str = Field(..., description="supplier_payment|customer_receipt|salary|rent|tax|other")
    description: str = Field(..., min_length=1, max_length=500)
    amount: float = Field(..., gt=0)
    currency: str = Field("VND", max_length=10)
    exchange_rate: float = Field(1.0, gt=0)
    amount: float = Field(..., gt=0)
    notes: str | None = None
    bank_ref: str | None = None
    ref_type: str | None = None  # 'ap','ar','po','invoice'
    ref_id: int | None = None

    @field_validator("currency")
    @classmethod
    def upper_currency(cls, v: str) -> str:
        return v.upper()


class BudgetSetRequest(BaseModel):
    year: int = Field(..., ge=2020, le=2099)
    month: int = Field(..., ge=1, le=12)
    category: str = Field(..., min_length=1)
    budget_amount: float = Field(..., gt=0)
    notes: str | None = None


class RecordPaymentRequest(BaseModel):
    ap_id: int = Field(..., description="ID bản ghi accounts_payable")
    amount: float = Field(..., gt=0, description="Số tiền thanh toán")
    payment_date: date = Field(..., description="Ngày thanh toán")
    bank_ref: str | None = Field(None, description="Mã tham chiếu ngân hàng")
    notes: str | None = None


class RecordReceiptRequest(BaseModel):
    ar_id: int = Field(..., description="ID bản ghi accounts_receivable")
    amount: float = Field(..., gt=0, description="Số tiền thu")
    payment_date: date = Field(..., description="Ngày thu tiền")
    bank_ref: str | None = Field(None, description="Mã tham chiếu ngân hàng")
    notes: str | None = None


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def _row_to_dict(row: asyncpg.Record | None) -> dict | None:
    if row is None:
        return None
    return dict(row)


def _rows_to_list(rows: list[asyncpg.Record]) -> list[dict]:
    return [dict(r) for r in rows]


# ---------------------------------------------------------------------------
# GET /cash-book
# ---------------------------------------------------------------------------

@router.get("/cash-book")
async def list_cash_book(
    date_from: date | None = Query(None, description="Từ ngày (YYYY-MM-DD)"),
    date_to: date | None = Query(None, description="Đến ngày (YYYY-MM-DD)"),
    direction: str | None = Query(None, description="income|expense|transfer"),
    category: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    token_data: TokenData = Depends(require_role("accountant", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Danh sách sổ quỹ với lọc theo ngày, loại, danh mục."""
    if date_from is None:
        date_from = date.today().replace(day=1)
    if date_to is None:
        date_to = date.today()

    conditions = ["cb.entry_date BETWEEN $1 AND $2"]
    params: list = [date_from, date_to]
    idx = 3

    if direction:
        conditions.append(f"cb.direction = ${idx}")
        params.append(direction)
        idx += 1

    if category:
        conditions.append(f"cb.category = ${idx}")
        params.append(category)
        idx += 1

    where_clause = " AND ".join(conditions)
    offset = (page - 1) * page_size

    count_row = await conn.fetchrow(
        f"SELECT COUNT(*) AS total FROM cash_book cb WHERE {where_clause}",
        *params,
    )
    total = count_row["total"] if count_row else 0

    rows = await conn.fetch(
        f"""
        SELECT
            cb.id, cb.entry_date, cb.direction, cb.category,
            cb.description, cb.amount,  
            cb.amount, cb.balance_after, cb.notes,
            cb.bank_ref, cb.ref_type, cb.ref_id,
            cb.created_at, u.full_name AS created_by_name
        FROM cash_book cb
        LEFT JOIN users u ON u.id = cb.created_by
        WHERE {where_clause}
        ORDER BY cb.entry_date DESC, cb.id DESC
        LIMIT ${idx} OFFSET ${idx + 1}
        """,
        *params, page_size, offset,
    )

    # Running totals for display
    totals = await conn.fetchrow(
        f"""
        SELECT
            COALESCE(SUM(CASE WHEN direction = 'in'   THEN amount ELSE 0 END), 0) AS total_income,
            COALESCE(SUM(CASE WHEN direction = 'out'  THEN amount ELSE 0 END), 0) AS total_expense,
            COALESCE(SUM(CASE WHEN direction = 'transfer' THEN amount ELSE 0 END), 0) AS total_transfer
        FROM cash_book cb
        WHERE {where_clause}
        """,
        *params,
    )

    return {
        "data": {
            "entries": _rows_to_list(rows),
            "totals": _row_to_dict(totals),
            "pagination": {
                "page": page,
                "page_size": page_size,
                "total": total,
                "total_pages": max(1, (total + page_size - 1) // page_size),
            },
        },
        "message": "Danh sách sổ quỹ",
    }


# ---------------------------------------------------------------------------
# POST /cash-book
# ---------------------------------------------------------------------------

@router.post("/cash-book", status_code=201)
async def create_cash_book_entry(
    body: CashBookCreateRequest,
    token_data: TokenData = Depends(require_role("accountant", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Tạo bút toán sổ quỹ mới (thu/chi/chuyển khoản)."""
    # Validate ref_type values
    valid_ref_types = {"ap", "ar", "po", "invoice", None}
    if body.ref_type not in valid_ref_types:
        raise HTTPException(400, detail="ref_type phải là: ap, ar, po, invoice")

    # Calculate running balance
    last_balance = await conn.fetchval(
        "SELECT balance_after FROM cash_book ORDER BY entry_date DESC, id DESC LIMIT 1"
    )
    current_balance = float(last_balance or 0)

    if body.direction == "income":
        new_balance = current_balance + body.amount
    elif body.direction == "expense":
        new_balance = current_balance - body.amount
    else:  # transfer — neutral
        new_balance = current_balance

    row = await conn.fetchrow(
        """
        INSERT INTO cash_book (
            entry_date, direction, category, description,
            amount, currency, exchange_rate, amount,
            balance_after, notes, bank_ref,
            ref_type, ref_id, created_by
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
        RETURNING *
        """,
        body.entry_date, body.direction, body.category, body.description,
        body.amount, body.currency, body.exchange_rate, body.amount,
        new_balance, body.notes, body.bank_ref,
        body.ref_type, body.ref_id, token_data.user_id,
    )

    logger.info("cash_book entry %s created by %s", row["id"], token_data.user_id)
    return {"data": dict(row), "message": "Đã tạo bút toán sổ quỹ thành công"}


# ---------------------------------------------------------------------------
# GET /cash-flow
# ---------------------------------------------------------------------------

@router.get("/cash-flow")
async def cash_flow_summary(
    months: int = Query(12, ge=1, le=24, description="Số tháng nhìn lại"),
    token_data: TokenData = Depends(require_role("accountant", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Tóm tắt dòng tiền thu/chi theo tháng (12 tháng gần nhất)."""
    rows = await conn.fetch(
        """
        SELECT
            DATE_TRUNC('month', entry_date)::DATE AS month,
            COALESCE(SUM(CASE WHEN direction = 'in'  THEN amount ELSE 0 END), 0) AS income_vnd,
            COALESCE(SUM(CASE WHEN direction = 'out' THEN amount ELSE 0 END), 0) AS expense_vnd,
            COALESCE(SUM(CASE WHEN direction = 'in'  THEN amount ELSE 0 END), 0)
                - COALESCE(SUM(CASE WHEN direction = 'out' THEN amount ELSE 0 END), 0) AS net_vnd,
            COUNT(*) AS entry_count
        FROM cash_book
        WHERE entry_date >= DATE_TRUNC('month', NOW()) - ($1 - 1) * INTERVAL '1 month'
        GROUP BY 1
        ORDER BY 1
        """,
        months,
    )

    category_breakdown = await conn.fetch(
        """
        SELECT
            category,
            direction,
            COALESCE(SUM(amount), 0) AS total_vnd
        FROM cash_book
        WHERE entry_date >= DATE_TRUNC('month', NOW()) - ($1 - 1) * INTERVAL '1 month'
        GROUP BY category, direction
        ORDER BY total_vnd DESC
        """,
        months,
    )

    return {
        "data": {
            "monthly": _rows_to_list(rows),
            "category_breakdown": _rows_to_list(category_breakdown),
        },
        "message": f"Dòng tiền {months} tháng gần nhất",
    }


# ---------------------------------------------------------------------------
# GET /ap-summary
# ---------------------------------------------------------------------------

@router.get("/ap-summary")
async def ap_summary(
    token_data: TokenData = Depends(require_role("accountant", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Tóm tắt công nợ phải trả: tổng dư nợ, quá hạn, theo nhà cung cấp."""
    overview = await conn.fetchrow(
        """
        SELECT
            COUNT(*)                                                AS total_invoices,
            COALESCE(SUM(amount - paid_amount), 0)             AS total_outstanding_vnd,
            COALESCE(SUM(CASE WHEN due_date < CURRENT_DATE AND status != 'paid'
                              THEN amount - paid_amount ELSE 0 END), 0) AS overdue_vnd,
            COUNT(CASE WHEN due_date < CURRENT_DATE AND status != 'paid' THEN 1 END) AS overdue_count,
            COALESCE(SUM(paid_amount), 0)                          AS total_paid_vnd
        FROM accounts_payable
        WHERE status != 'paid'
        """
    )

    by_supplier = await conn.fetch(
        """
        SELECT
            s.id AS supplier_id,
            s.name AS supplier_name,
            s.country,
            COUNT(ap.id)                                           AS invoice_count,
            COALESCE(SUM(ap.amount - ap.paid_amount), 0)      AS outstanding_vnd,
            COALESCE(SUM(CASE WHEN ap.due_date < CURRENT_DATE AND ap.status != 'paid'
                              THEN ap.amount - ap.paid_amount ELSE 0 END), 0) AS overdue_vnd,
            MIN(ap.due_date)                                       AS earliest_due
        FROM accounts_payable ap
        JOIN suppliers s ON s.id = ap.supplier_id
        WHERE ap.status != 'paid'
        GROUP BY s.id, s.name, s.country
        ORDER BY outstanding_vnd DESC
        LIMIT 20
        """
    )

    aging = await conn.fetch(
        """
        SELECT
            CASE
                WHEN due_date >= CURRENT_DATE THEN 'current'
                WHEN due_date >= CURRENT_DATE - INTERVAL '30 days' THEN '1-30_days'
                WHEN due_date >= CURRENT_DATE - INTERVAL '60 days' THEN '31-60_days'
                WHEN due_date >= CURRENT_DATE - INTERVAL '90 days' THEN '61-90_days'
                ELSE 'over_90_days'
            END AS aging_bucket,
            COUNT(*)                                               AS count,
            COALESCE(SUM(amount - paid_amount), 0)            AS amount
        FROM accounts_payable
        WHERE status != 'paid'
        GROUP BY 1
        ORDER BY 1
        """
    )

    return {
        "data": {
            "overview": _row_to_dict(overview),
            "by_supplier": _rows_to_list(by_supplier),
            "aging": _rows_to_list(aging),
        },
        "message": "Tóm tắt công nợ phải trả",
    }


# ---------------------------------------------------------------------------
# GET /ar-summary
# ---------------------------------------------------------------------------

@router.get("/ar-summary")
async def ar_summary(
    token_data: TokenData = Depends(require_role("accountant", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Tóm tắt công nợ phải thu: tổng dư nợ, quá hạn, theo khách hàng."""
    overview = await conn.fetchrow(
        """
        SELECT
            COUNT(*)                                               AS total_invoices,
            COALESCE(SUM(amount - paid_amount), 0)                AS total_outstanding,
            COALESCE(SUM(CASE WHEN due_date < CURRENT_DATE AND status != 'paid'
                              THEN amount - paid_amount ELSE 0 END), 0) AS overdue_amount,
            COUNT(CASE WHEN due_date < CURRENT_DATE AND status != 'paid' THEN 1 END) AS overdue_count,
            COALESCE(SUM(paid_amount), 0)                         AS total_paid
        FROM accounts_receivable
        WHERE status != 'paid'
        """
    )

    by_customer = await conn.fetch(
        """
        SELECT
            c.id AS customer_id,
            c.company_name,
            c.short_name,
            c.customer_type,
            COUNT(ar.id)                                           AS invoice_count,
            COALESCE(SUM(ar.amount - ar.paid_amount), 0)          AS outstanding_amount,
            COALESCE(SUM(CASE WHEN ar.due_date < CURRENT_DATE AND ar.status != 'paid'
                              THEN ar.amount - ar.paid_amount ELSE 0 END), 0) AS overdue_amount,
            MIN(ar.due_date)                                       AS earliest_due,
            MAX(ar.invoice_date)                                   AS latest_invoice
        FROM accounts_receivable ar
        JOIN customers c ON c.id = ar.customer_id
        WHERE ar.status != 'paid'
        GROUP BY c.id, c.company_name, c.short_name, c.customer_type
        ORDER BY outstanding_amount DESC
        LIMIT 20
        """
    )

    aging = await conn.fetch(
        """
        SELECT
            CASE
                WHEN due_date >= CURRENT_DATE THEN 'current'
                WHEN due_date >= CURRENT_DATE - INTERVAL '30 days' THEN '1-30_days'
                WHEN due_date >= CURRENT_DATE - INTERVAL '60 days' THEN '31-60_days'
                WHEN due_date >= CURRENT_DATE - INTERVAL '90 days' THEN '61-90_days'
                ELSE 'over_90_days'
            END AS aging_bucket,
            COUNT(*)                                               AS count,
            COALESCE(SUM(amount - paid_amount), 0)                AS amount
        FROM accounts_receivable
        WHERE status != 'paid'
        GROUP BY 1
        ORDER BY 1
        """
    )

    return {
        "data": {
            "overview": _row_to_dict(overview),
            "by_customer": _rows_to_list(by_customer),
            "aging": _rows_to_list(aging),
        },
        "message": "Tóm tắt công nợ phải thu",
    }


# ---------------------------------------------------------------------------
# POST /record-payment  — Ghi nhận thanh toán AP (accounts_payable)
# ---------------------------------------------------------------------------

@router.post("/record-payment", status_code=201)
async def record_ap_payment(
    body: RecordPaymentRequest,
    token_data: TokenData = Depends(require_role("accountant", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Ghi nhận thanh toán cho một khoản phải trả (accounts_payable)."""
    ap = await conn.fetchrow(
        "SELECT id, amount, paid_amount, status, supplier_id, invoice_number FROM accounts_payable WHERE id = $1",
        body.ap_id,
    )
    if not ap:
        raise HTTPException(status_code=404, detail="Không tìm thấy khoản phải trả")
    if ap["status"] == "paid":
        raise HTTPException(status_code=400, detail="Khoản này đã được thanh toán đầy đủ")

    remaining = float(ap["amount"]) - float(ap["paid_amount"] or 0)
    if body.amount > remaining + 0.01:
        raise HTTPException(
            status_code=400,
            detail=f"Số tiền thanh toán ({body.amount:,.0f}) vượt quá số còn lại ({remaining:,.0f})",
        )

    new_paid = float(ap["paid_amount"] or 0) + body.amount
    new_status = "paid" if new_paid >= float(ap["amount"]) - 0.01 else "partial"

    async with conn.transaction():
        # Update accounts_payable
        await conn.execute(
            """
            UPDATE accounts_payable
            SET paid_amount = $1,
                status      = $2,
                updated_at  = NOW()
            WHERE id = $3
            """,
            new_paid,
            new_status,
            body.ap_id,
        )

        # Create cash_book entry
        last_balance = await conn.fetchval(
            "SELECT balance_after FROM cash_book ORDER BY entry_date DESC, id DESC LIMIT 1"
        )
        current_balance = float(last_balance or 0)
        new_balance = current_balance - body.amount

        cb_row = await conn.fetchrow(
            """
            INSERT INTO cash_book (
                entry_date, direction, category, description,
                amount, currency, exchange_rate, balance_after,
                bank_ref, notes, ref_type, ref_id, created_by
            ) VALUES ($1, 'expense', 'supplier_payment', $2, $3, 'VND', 1.0, $4, $5, $6, 'ap', $7, $8)
            RETURNING id
            """,
            body.payment_date,
            f"Thanh toán NCC — Hóa đơn {ap['invoice_number'] or ap['id']}",
            body.amount,
            new_balance,
            body.bank_ref,
            body.notes,
            body.ap_id,
            token_data.user_id,
        )

    logger.info(
        "AP payment recorded: ap_id=%s amount=%s by user=%s cash_book_id=%s",
        body.ap_id, body.amount, token_data.user_id, cb_row["id"],
    )
    return {
        "data": {
            "ap_id": body.ap_id,
            "amount_paid": body.amount,
            "new_paid_total": new_paid,
            "new_status": new_status,
            "cash_book_id": cb_row["id"],
        },
        "message": f"Đã ghi nhận thanh toán {body.amount:,.0f}₫ cho khoản phải trả #{body.ap_id}",
    }


# ---------------------------------------------------------------------------
# POST /record-receipt  — Ghi nhận thu tiền AR (accounts_receivable)
# ---------------------------------------------------------------------------

@router.post("/record-receipt", status_code=201)
async def record_ar_receipt(
    body: RecordReceiptRequest,
    token_data: TokenData = Depends(require_role("accountant", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Ghi nhận thu tiền cho một khoản phải thu (accounts_receivable)."""
    ar = await conn.fetchrow(
        "SELECT id, amount, paid_amount, status, customer_id, invoice_number FROM accounts_receivable WHERE id = $1",
        body.ar_id,
    )
    if not ar:
        raise HTTPException(status_code=404, detail="Không tìm thấy khoản phải thu")
    if ar["status"] == "paid":
        raise HTTPException(status_code=400, detail="Khoản này đã được thu đầy đủ")

    remaining = float(ar["amount"]) - float(ar["paid_amount"] or 0)
    if body.amount > remaining + 0.01:
        raise HTTPException(
            status_code=400,
            detail=f"Số tiền thu ({body.amount:,.0f}) vượt quá số còn lại ({remaining:,.0f})",
        )

    new_paid = float(ar["paid_amount"] or 0) + body.amount
    new_status = "paid" if new_paid >= float(ar["amount"]) - 0.01 else "partial"

    async with conn.transaction():
        # Update accounts_receivable
        await conn.execute(
            """
            UPDATE accounts_receivable
            SET paid_amount = $1,
                status      = $2,
                updated_at  = NOW()
            WHERE id = $3
            """,
            new_paid,
            new_status,
            body.ar_id,
        )

        # Create cash_book entry
        last_balance = await conn.fetchval(
            "SELECT balance_after FROM cash_book ORDER BY entry_date DESC, id DESC LIMIT 1"
        )
        current_balance = float(last_balance or 0)
        new_balance = current_balance + body.amount

        cb_row = await conn.fetchrow(
            """
            INSERT INTO cash_book (
                entry_date, direction, category, description,
                amount, currency, exchange_rate, balance_after,
                bank_ref, notes, ref_type, ref_id, created_by
            ) VALUES ($1, 'income', 'customer_receipt', $2, $3, 'VND', 1.0, $4, $5, $6, 'ar', $7, $8)
            RETURNING id
            """,
            body.payment_date,
            f"Thu tiền KH — Hóa đơn {ar['invoice_number'] or ar['id']}",
            body.amount,
            new_balance,
            body.bank_ref,
            body.notes,
            body.ar_id,
            token_data.user_id,
        )

    logger.info(
        "AR receipt recorded: ar_id=%s amount=%s by user=%s cash_book_id=%s",
        body.ar_id, body.amount, token_data.user_id, cb_row["id"],
    )
    return {
        "data": {
            "ar_id": body.ar_id,
            "amount_received": body.amount,
            "new_paid_total": new_paid,
            "new_status": new_status,
            "cash_book_id": cb_row["id"],
        },
        "message": f"Đã ghi nhận thu tiền {body.amount:,.0f}₫ cho khoản phải thu #{body.ar_id}",
    }


# ---------------------------------------------------------------------------
# GET /budget
# ---------------------------------------------------------------------------

@router.get("/budget")
async def get_budget(
    year: int = Query(..., ge=2020, le=2099),
    month: int = Query(..., ge=1, le=12),
    token_data: TokenData = Depends(require_role("accountant", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Ngân sách vs thực tế theo danh mục cho tháng/năm."""
    rows = await conn.fetch(
        """
        SELECT
            bt.id, bt.year, bt.month, bt.category,
            bt.budget_amount, bt.notes,
            COALESCE(SUM(cb.amount), 0) AS actual_amount,
            bt.budget_amount - COALESCE(SUM(cb.amount), 0) AS variance,
            CASE WHEN bt.budget_amount > 0
                 THEN ROUND(COALESCE(SUM(cb.amount), 0) / bt.budget_amount * 100, 2)
                 ELSE 0 END AS utilization_pct
        FROM budget_targets bt
        LEFT JOIN cash_book cb ON cb.category = bt.category
            AND EXTRACT(YEAR  FROM cb.entry_date) = bt.year
            AND EXTRACT(MONTH FROM cb.entry_date) = bt.month
            AND cb.direction = 'out'
        WHERE bt.year = $1 AND bt.month = $2
        GROUP BY bt.id, bt.year, bt.month, bt.category, bt.budget_amount, bt.notes
        ORDER BY bt.category
        """,
        year, month,
    )

    summary = {
        "total_budget": sum(r["budget_amount"] for r in rows),
        "total_actual": sum(r["actual_amount"] for r in rows),
        "total_variance": sum(r["variance"] for r in rows),
    }

    return {
        "data": {
            "year": year,
            "month": month,
            "items": _rows_to_list(rows),
            "summary": summary,
        },
        "message": f"Ngân sách tháng {month}/{year}",
    }


# ---------------------------------------------------------------------------
# POST /budget
# ---------------------------------------------------------------------------

@router.post("/budget", status_code=201)
async def set_budget(
    body: BudgetSetRequest,
    token_data: TokenData = Depends(require_role("manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Thiết lập mục tiêu ngân sách cho danh mục/tháng/năm (upsert)."""
    row = await conn.fetchrow(
        """
        INSERT INTO budget_targets (year, month, category, budget_amount, notes, created_by)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (year, month, category) DO UPDATE
            SET budget_amount = EXCLUDED.budget_amount,
                notes         = EXCLUDED.notes
        RETURNING *
        """,
        body.year, body.month, body.category, body.budget_amount,
        body.notes, token_data.user_id,
    )

    return {"data": dict(row), "message": "Đã lưu ngân sách thành công"}


# ---------------------------------------------------------------------------
# GET /dashboard
# ---------------------------------------------------------------------------

@router.get("/dashboard")
async def finance_dashboard(
    token_data: TokenData = Depends(require_role("accountant", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """
    Tổng quan tài chính:
    - Tổng tiền mặt (từ sổ quỹ)
    - Công nợ phải trả tổng
    - Công nợ phải thu tổng
    - P&L tháng này vs tháng trước
    - Thu chi 7 ngày gần nhất
    """
    # Cash position — last balance_after entry
    cash_balance = await conn.fetchval(
        "SELECT balance_after FROM cash_book ORDER BY entry_date DESC, id DESC LIMIT 1"
    )

    # Total outstanding AP
    ap_outstanding = await conn.fetchrow(
        """
        SELECT
            COALESCE(SUM(amount - paid_amount), 0) AS total_outstanding_vnd,
            COUNT(CASE WHEN due_date < CURRENT_DATE AND status != 'paid' THEN 1 END) AS overdue_count
        FROM accounts_payable
        WHERE status != 'paid'
        """
    )

    # Total outstanding AR
    ar_outstanding = await conn.fetchrow(
        """
        SELECT
            COALESCE(SUM(amount - paid_amount), 0) AS total_outstanding,
            COUNT(CASE WHEN due_date < CURRENT_DATE AND status != 'paid' THEN 1 END) AS overdue_count
        FROM accounts_receivable
        WHERE status != 'paid'
        """
    )

    # Monthly P&L: current month from deal_margins
    pl_current = await conn.fetchrow(
        """
        SELECT
            COALESCE(SUM(dm.revenue_vnd), 0)      AS revenue_vnd,
            COALESCE(SUM(dm.total_cost_vnd), 0)   AS cost_vnd,
            COALESCE(SUM(dm.gross_profit_vnd), 0) AS gross_profit_vnd,
            COALESCE(AVG(dm.margin_pct), 0)       AS avg_margin_pct
        FROM deal_margins dm
        JOIN sales_orders so ON so.id = dm.chain_code::BIGINT
        WHERE DATE_TRUNC('month', so.created_at) = DATE_TRUNC('month', NOW())
        """
    )

    pl_last = await conn.fetchrow(
        """
        SELECT
            COALESCE(SUM(dm.revenue_vnd), 0)      AS revenue_vnd,
            COALESCE(SUM(dm.total_cost_vnd), 0)   AS cost_vnd,
            COALESCE(SUM(dm.gross_profit_vnd), 0) AS gross_profit_vnd,
            COALESCE(AVG(dm.margin_pct), 0)       AS avg_margin_pct
        FROM deal_margins dm
        JOIN sales_orders so ON so.id = dm.chain_code::BIGINT
        WHERE DATE_TRUNC('month', so.created_at) = DATE_TRUNC('month', NOW()) - INTERVAL '1 month'
        """
    )

    # Recent 7 days cash flow
    recent_cash = await conn.fetch(
        """
        SELECT
            entry_date,
            COALESCE(SUM(CASE WHEN direction = 'in'  THEN amount ELSE 0 END), 0) AS income_vnd,
            COALESCE(SUM(CASE WHEN direction = 'out' THEN amount ELSE 0 END), 0) AS expense_vnd
        FROM cash_book
        WHERE entry_date >= CURRENT_DATE - INTERVAL '6 days'
        GROUP BY entry_date
        ORDER BY entry_date
        """
    )

    # Upcoming payments due in 7 days
    upcoming_ap = await conn.fetch(
        """
        SELECT ap.id, ap.invoice_number, s.name AS supplier_name,
               ap.due_date, (ap.amount - ap.paid_amount) AS remaining_vnd
        FROM accounts_payable ap
        JOIN suppliers s ON s.id = ap.supplier_id
        WHERE ap.status != 'paid'
          AND ap.due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'
        ORDER BY ap.due_date
        LIMIT 10
        """
    )

    return {
        "data": {
            "cash_balance_vnd": float(cash_balance or 0),
            "ap": _row_to_dict(ap_outstanding),
            "ar": _row_to_dict(ar_outstanding),
            "pl_current_month": _row_to_dict(pl_current),
            "pl_last_month": _row_to_dict(pl_last),
            "recent_cash_flow": _rows_to_list(recent_cash),
            "upcoming_payments": _rows_to_list(upcoming_ap),
        },
        "message": "Tổng quan tài chính",
    }
