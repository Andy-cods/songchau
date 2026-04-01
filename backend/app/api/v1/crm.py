"""
CRM API (M33) — Customer Relationship Management.

Endpoints:
  GET  /customers                   — Enhanced customer list with stats
  GET  /customers/{id}              — Customer detail (contacts, interactions, orders)
  POST /customers                   — Create customer
  PUT  /customers/{id}              — Update customer
  GET  /contacts                    — List contacts (with customer filter)
  POST /contacts                    — Create contact
  GET  /interactions                — List interactions (with customer filter)
  POST /interactions                — Log interaction
  GET  /customers/{id}/timeline     — Combined timeline for a customer
"""

from __future__ import annotations

import logging
from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, EmailStr, Field
import asyncpg

from app.core.database import get_db
from app.core.rbac import require_role
from app.core.security import TokenData

logger = logging.getLogger(__name__)
router = APIRouter()


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class CustomerCreateRequest(BaseModel):
    customer_code: str = Field(..., min_length=1, max_length=50)
    company_name: str = Field(..., min_length=1, max_length=255)
    short_name: str | None = Field(None, max_length=100)
    tax_code: str | None = None
    address: str | None = None
    business_system: str | None = None
    customer_type: str | None = None
    is_active: bool = True


class CustomerUpdateRequest(BaseModel):
    company_name: str | None = None
    short_name: str | None = None
    tax_code: str | None = None
    address: str | None = None
    business_system: str | None = None
    customer_type: str | None = None
    is_active: bool | None = None


class ContactCreateRequest(BaseModel):
    customer_id: int
    full_name: str = Field(..., min_length=1, max_length=200)
    position: str | None = None
    department: str | None = None
    email: str | None = None
    phone: str | None = None
    is_primary: bool = False
    notes: str | None = None


class InteractionCreateRequest(BaseModel):
    customer_id: int
    contact_id: int | None = None
    interaction_type: Literal["email", "call", "meeting", "visit", "other"]
    subject: str = Field(..., min_length=1, max_length=500)
    notes: str | None = None
    outcome: str | None = None
    follow_up_date: date | None = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _rows_to_list(rows: list[asyncpg.Record]) -> list[dict]:
    return [dict(r) for r in rows]


def _row_to_dict(row: asyncpg.Record | None) -> dict | None:
    if row is None:
        return None
    return dict(row)


async def _assert_customer_exists(conn: asyncpg.Connection, customer_id: int) -> None:
    exists = await conn.fetchval("SELECT 1 FROM customers WHERE id = $1", customer_id)
    if not exists:
        raise HTTPException(404, detail=f"Không tìm thấy khách hàng ID {customer_id}")


# ---------------------------------------------------------------------------
# GET /customers
# ---------------------------------------------------------------------------

@router.get("/customers")
async def list_customers(
    search: str | None = Query(None, description="Tìm kiếm tên / mã / MST"),
    customer_type: str | None = Query(None),
    is_active: bool | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    token_data: TokenData = Depends(require_role("staff", "accountant", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Danh sách khách hàng có thống kê: tổng đơn hàng, doanh thu, ngày đặt hàng gần nhất."""
    conditions = ["1=1"]
    params: list = []
    idx = 1

    if search:
        conditions.append(
            f"(c.company_name ILIKE ${idx} OR c.customer_code ILIKE ${idx} OR c.tax_code ILIKE ${idx})"
        )
        params.append(f"%{search}%")
        idx += 1

    if customer_type:
        conditions.append(f"c.customer_type = ${idx}")
        params.append(customer_type)
        idx += 1

    if is_active is not None:
        conditions.append(f"c.is_active = ${idx}")
        params.append(is_active)
        idx += 1

    where_clause = " AND ".join(conditions)
    offset = (page - 1) * page_size

    count_row = await conn.fetchrow(
        f"SELECT COUNT(*) AS total FROM customers c WHERE {where_clause}", *params
    )
    total = count_row["total"] if count_row else 0

    rows = await conn.fetch(
        f"""
        SELECT
            c.id, c.customer_code, c.company_name, c.short_name,
            c.tax_code, c.address, c.business_system, c.customer_type,
            c.is_active,
            COUNT(DISTINCT so.id)                               AS total_orders,
            COALESCE(SUM(so.total_amount), 0)                  AS total_revenue,
            MAX(so.created_at)::DATE                           AS last_order_date,
            COUNT(DISTINCT cc.id)                              AS contact_count,
            COUNT(DISTINCT ci.id)                              AS interaction_count
        FROM customers c
        LEFT JOIN sales_orders so ON so.customer_id = c.id
        LEFT JOIN crm_contacts cc ON cc.customer_id = c.id
        LEFT JOIN crm_interactions ci ON ci.customer_id = c.id
        WHERE {where_clause}
        GROUP BY c.id, c.customer_code, c.company_name, c.short_name,
                 c.tax_code, c.address, c.business_system, c.customer_type, c.is_active
        ORDER BY total_revenue DESC NULLS LAST, c.company_name
        LIMIT ${idx} OFFSET ${idx + 1}
        """,
        *params, page_size, offset,
    )

    return {
        "data": {
            "customers": _rows_to_list(rows),
            "pagination": {
                "page": page,
                "page_size": page_size,
                "total": total,
                "total_pages": max(1, (total + page_size - 1) // page_size),
            },
        },
        "message": "Danh sách khách hàng",
    }


# ---------------------------------------------------------------------------
# GET /customers/{id}
# ---------------------------------------------------------------------------

@router.get("/customers/{customer_id}")
async def get_customer_detail(
    customer_id: int,
    token_data: TokenData = Depends(require_role("staff", "accountant", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Chi tiết khách hàng: thông tin, danh bạ, tương tác, lịch sử đơn hàng, doanh thu."""
    customer = await conn.fetchrow(
        """
        SELECT
            c.*,
            COUNT(DISTINCT so.id)               AS total_orders,
            COALESCE(SUM(so.total_amount), 0)   AS total_revenue,
            MAX(so.created_at)::DATE            AS last_order_date,
            COUNT(DISTINCT inv.id)              AS total_invoices,
            COALESCE(SUM(inv.total_amount), 0)  AS total_invoiced
        FROM customers c
        LEFT JOIN sales_orders so  ON so.customer_id = c.id
        LEFT JOIN invoices inv     ON inv.customer_id = c.id
        WHERE c.id = $1
        GROUP BY c.id
        """,
        customer_id,
    )

    if not customer:
        raise HTTPException(404, detail=f"Không tìm thấy khách hàng ID {customer_id}")

    contacts = await conn.fetch(
        """
        SELECT id, full_name, position, department, email, phone,
               is_primary, notes, last_contacted_at, created_at
        FROM crm_contacts
        WHERE customer_id = $1
        ORDER BY is_primary DESC, full_name
        """,
        customer_id,
    )

    recent_interactions = await conn.fetch(
        """
        SELECT
            ci.id, ci.interaction_type, ci.subject, ci.notes,
            ci.outcome, ci.follow_up_date, ci.created_at,
            cc.full_name AS contact_name,
            u.full_name  AS created_by_name
        FROM crm_interactions ci
        LEFT JOIN crm_contacts cc ON cc.id = ci.contact_id
        LEFT JOIN users u         ON u.id  = ci.created_by
        WHERE ci.customer_id = $1
        ORDER BY ci.created_at DESC
        LIMIT 10
        """,
        customer_id,
    )

    recent_orders = await conn.fetch(
        """
        SELECT id, order_number, total_amount, status, created_at
        FROM sales_orders
        WHERE customer_id = $1
        ORDER BY created_at DESC
        LIMIT 10
        """,
        customer_id,
    )

    ar_outstanding = await conn.fetchrow(
        """
        SELECT
            COALESCE(SUM(amount - paid_amount), 0)              AS outstanding_amount,
            COUNT(CASE WHEN due_date < CURRENT_DATE THEN 1 END) AS overdue_count
        FROM accounts_receivable
        WHERE customer_id = $1 AND status != 'paid'
        """,
        customer_id,
    )

    return {
        "data": {
            "customer": dict(customer),
            "contacts": _rows_to_list(contacts),
            "recent_interactions": _rows_to_list(recent_interactions),
            "recent_orders": _rows_to_list(recent_orders),
            "ar_summary": _row_to_dict(ar_outstanding),
        },
        "message": "Chi tiết khách hàng",
    }


# ---------------------------------------------------------------------------
# POST /customers
# ---------------------------------------------------------------------------

@router.post("/customers", status_code=201)
async def create_customer(
    body: CustomerCreateRequest,
    token_data: TokenData = Depends(require_role("manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Tạo khách hàng mới."""
    # Check duplicate customer_code
    existing = await conn.fetchval(
        "SELECT id FROM customers WHERE customer_code = $1", body.customer_code
    )
    if existing:
        raise HTTPException(409, detail=f"Mã khách hàng '{body.customer_code}' đã tồn tại")

    row = await conn.fetchrow(
        """
        INSERT INTO customers (
            customer_code, company_name, short_name, tax_code,
            address, business_system, customer_type, is_active
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        RETURNING *
        """,
        body.customer_code, body.company_name, body.short_name, body.tax_code,
        body.address, body.business_system, body.customer_type, body.is_active,
    )

    logger.info("Customer %s created by %s", row["id"], token_data.user_id)
    return {"data": dict(row), "message": "Đã tạo khách hàng thành công"}


# ---------------------------------------------------------------------------
# PUT /customers/{id}
# ---------------------------------------------------------------------------

@router.put("/customers/{customer_id}")
async def update_customer(
    customer_id: int,
    body: CustomerUpdateRequest,
    token_data: TokenData = Depends(require_role("manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Cập nhật thông tin khách hàng."""
    await _assert_customer_exists(conn, customer_id)

    updates: list[str] = []
    params: list = []
    idx = 1

    field_map = {
        "company_name": body.company_name,
        "short_name": body.short_name,
        "tax_code": body.tax_code,
        "address": body.address,
        "business_system": body.business_system,
        "customer_type": body.customer_type,
        "is_active": body.is_active,
    }

    for field, value in field_map.items():
        if value is not None:
            updates.append(f"{field} = ${idx}")
            params.append(value)
            idx += 1

    if not updates:
        raise HTTPException(400, detail="Không có trường nào được cập nhật")

    params.append(customer_id)
    row = await conn.fetchrow(
        f"UPDATE customers SET {', '.join(updates)} WHERE id = ${idx} RETURNING *",
        *params,
    )

    return {"data": dict(row), "message": "Đã cập nhật khách hàng thành công"}


# ---------------------------------------------------------------------------
# GET /contacts
# ---------------------------------------------------------------------------

@router.get("/contacts")
async def list_contacts(
    customer_id: int | None = Query(None),
    search: str | None = Query(None, description="Tìm theo tên / email / SĐT"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    token_data: TokenData = Depends(require_role("staff", "accountant", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Danh sách liên hệ khách hàng."""
    conditions = ["1=1"]
    params: list = []
    idx = 1

    if customer_id:
        conditions.append(f"cc.customer_id = ${idx}")
        params.append(customer_id)
        idx += 1

    if search:
        conditions.append(
            f"(cc.full_name ILIKE ${idx} OR cc.email ILIKE ${idx} OR cc.phone ILIKE ${idx})"
        )
        params.append(f"%{search}%")
        idx += 1

    where_clause = " AND ".join(conditions)
    offset = (page - 1) * page_size

    count_row = await conn.fetchrow(
        f"SELECT COUNT(*) AS total FROM crm_contacts cc WHERE {where_clause}", *params
    )
    total = count_row["total"] if count_row else 0

    rows = await conn.fetch(
        f"""
        SELECT
            cc.id, cc.customer_id, cc.full_name, cc.position, cc.department,
            cc.email, cc.phone, cc.is_primary, cc.notes, cc.last_contacted_at,
            cc.created_at, cc.updated_at,
            c.company_name AS customer_name
        FROM crm_contacts cc
        JOIN customers c ON c.id = cc.customer_id
        WHERE {where_clause}
        ORDER BY c.company_name, cc.is_primary DESC, cc.full_name
        LIMIT ${idx} OFFSET ${idx + 1}
        """,
        *params, page_size, offset,
    )

    return {
        "data": {
            "contacts": _rows_to_list(rows),
            "pagination": {
                "page": page,
                "page_size": page_size,
                "total": total,
                "total_pages": max(1, (total + page_size - 1) // page_size),
            },
        },
        "message": "Danh sách liên hệ",
    }


# ---------------------------------------------------------------------------
# POST /contacts
# ---------------------------------------------------------------------------

@router.post("/contacts", status_code=201)
async def create_contact(
    body: ContactCreateRequest,
    token_data: TokenData = Depends(require_role("staff", "accountant", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Tạo liên hệ mới cho khách hàng."""
    await _assert_customer_exists(conn, body.customer_id)

    # If this is primary, unset other primaries for this customer
    if body.is_primary:
        await conn.execute(
            "UPDATE crm_contacts SET is_primary = false WHERE customer_id = $1",
            body.customer_id,
        )

    row = await conn.fetchrow(
        """
        INSERT INTO crm_contacts (
            customer_id, full_name, position, department,
            email, phone, is_primary, notes
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        RETURNING *
        """,
        body.customer_id, body.full_name, body.position, body.department,
        body.email, body.phone, body.is_primary, body.notes,
    )

    logger.info("Contact %s created for customer %s", row["id"], body.customer_id)
    return {"data": dict(row), "message": "Đã tạo liên hệ thành công"}


# ---------------------------------------------------------------------------
# GET /interactions
# ---------------------------------------------------------------------------

@router.get("/interactions")
async def list_interactions(
    customer_id: int | None = Query(None),
    interaction_type: str | None = Query(None),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    token_data: TokenData = Depends(require_role("staff", "accountant", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Danh sách tương tác với khách hàng."""
    conditions = ["1=1"]
    params: list = []
    idx = 1

    if customer_id:
        conditions.append(f"ci.customer_id = ${idx}")
        params.append(customer_id)
        idx += 1

    if interaction_type:
        conditions.append(f"ci.interaction_type = ${idx}")
        params.append(interaction_type)
        idx += 1

    if date_from:
        conditions.append(f"ci.created_at::DATE >= ${idx}")
        params.append(date_from)
        idx += 1

    if date_to:
        conditions.append(f"ci.created_at::DATE <= ${idx}")
        params.append(date_to)
        idx += 1

    where_clause = " AND ".join(conditions)
    offset = (page - 1) * page_size

    count_row = await conn.fetchrow(
        f"SELECT COUNT(*) AS total FROM crm_interactions ci WHERE {where_clause}", *params
    )
    total = count_row["total"] if count_row else 0

    rows = await conn.fetch(
        f"""
        SELECT
            ci.id, ci.customer_id, ci.contact_id, ci.interaction_type,
            ci.subject, ci.notes, ci.outcome, ci.follow_up_date, ci.created_at,
            c.company_name  AS customer_name,
            cc.full_name    AS contact_name,
            u.full_name     AS created_by_name
        FROM crm_interactions ci
        JOIN customers c        ON c.id  = ci.customer_id
        LEFT JOIN crm_contacts cc ON cc.id = ci.contact_id
        LEFT JOIN users u         ON u.id  = ci.created_by
        WHERE {where_clause}
        ORDER BY ci.created_at DESC
        LIMIT ${idx} OFFSET ${idx + 1}
        """,
        *params, page_size, offset,
    )

    return {
        "data": {
            "interactions": _rows_to_list(rows),
            "pagination": {
                "page": page,
                "page_size": page_size,
                "total": total,
                "total_pages": max(1, (total + page_size - 1) // page_size),
            },
        },
        "message": "Danh sách tương tác",
    }


# ---------------------------------------------------------------------------
# POST /interactions
# ---------------------------------------------------------------------------

@router.post("/interactions", status_code=201)
async def create_interaction(
    body: InteractionCreateRequest,
    token_data: TokenData = Depends(require_role("staff", "accountant", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Ghi lại tương tác mới với khách hàng."""
    await _assert_customer_exists(conn, body.customer_id)

    if body.contact_id:
        contact_ok = await conn.fetchval(
            "SELECT 1 FROM crm_contacts WHERE id = $1 AND customer_id = $2",
            body.contact_id, body.customer_id,
        )
        if not contact_ok:
            raise HTTPException(
                400,
                detail=f"Liên hệ ID {body.contact_id} không thuộc khách hàng ID {body.customer_id}",
            )

    async with conn.transaction():
        row = await conn.fetchrow(
            """
            INSERT INTO crm_interactions (
                customer_id, contact_id, interaction_type,
                subject, notes, outcome, follow_up_date, created_by
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
            RETURNING *
            """,
            body.customer_id, body.contact_id, body.interaction_type,
            body.subject, body.notes, body.outcome, body.follow_up_date,
            token_data.user_id,
        )

        # Update last_contacted_at on the contact
        if body.contact_id:
            await conn.execute(
                "UPDATE crm_contacts SET last_contacted_at = NOW(), updated_at = NOW() WHERE id = $1",
                body.contact_id,
            )

    logger.info("Interaction %s logged for customer %s", row["id"], body.customer_id)
    return {"data": dict(row), "message": "Đã ghi lại tương tác thành công"}


# ---------------------------------------------------------------------------
# GET /customers/{id}/timeline
# ---------------------------------------------------------------------------

@router.get("/customers/{customer_id}/timeline")
async def customer_timeline(
    customer_id: int,
    limit: int = Query(50, ge=1, le=200, description="Số sự kiện tối đa"),
    token_data: TokenData = Depends(require_role("staff", "accountant", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """
    Timeline kết hợp của đơn hàng + tương tác + hóa đơn cho một khách hàng.
    Trả về danh sách sự kiện sắp xếp theo thời gian giảm dần.
    """
    await _assert_customer_exists(conn, customer_id)

    # Sales orders
    orders = await conn.fetch(
        """
        SELECT
            'order'         AS event_type,
            id              AS ref_id,
            order_number    AS ref_number,
            'Đơn hàng: ' || order_number || ' - ' || status AS title,
            total_amount::TEXT AS detail,
            created_at
        FROM sales_orders
        WHERE customer_id = $1
        ORDER BY created_at DESC
        LIMIT $2
        """,
        customer_id, limit,
    )

    # Invoices
    invoices = await conn.fetch(
        """
        SELECT
            'invoice'           AS event_type,
            id                  AS ref_id,
            invoice_number      AS ref_number,
            'Hóa đơn: ' || invoice_number || ' - ' || status AS title,
            total_amount::TEXT  AS detail,
            created_at
        FROM invoices
        WHERE customer_id = $1
        ORDER BY created_at DESC
        LIMIT $2
        """,
        customer_id, limit,
    )

    # Interactions
    interactions = await conn.fetch(
        """
        SELECT
            'interaction'           AS event_type,
            ci.id                   AS ref_id,
            ci.interaction_type     AS ref_number,
            ci.subject              AS title,
            COALESCE(ci.outcome, ci.notes, '')  AS detail,
            ci.created_at
        FROM crm_interactions ci
        WHERE ci.customer_id = $1
        ORDER BY ci.created_at DESC
        LIMIT $2
        """,
        customer_id, limit,
    )

    # Merge and sort
    all_events = (
        _rows_to_list(orders)
        + _rows_to_list(invoices)
        + _rows_to_list(interactions)
    )
    all_events.sort(key=lambda x: x["created_at"], reverse=True)
    all_events = all_events[:limit]

    return {
        "data": {
            "customer_id": customer_id,
            "events": all_events,
            "total": len(all_events),
        },
        "message": "Timeline khách hàng",
    }
