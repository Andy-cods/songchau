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
from app.services.crm_mapping_service import get_customer_match_context, non_empty_aliases

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
    email: EmailStr | None = None
    phone: str | None = None
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


class ExternalMapCreateRequest(BaseModel):
    source_system: str = Field(..., min_length=1, max_length=100)
    match_field: str = Field(..., min_length=1, max_length=100)
    match_value: str = Field(..., min_length=1, max_length=255)
    is_primary: bool = False
    notes: str | None = None


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

async def _get_customer_match_context_or_404(
    conn: asyncpg.Connection,
    customer_id: int,
) -> dict:
    context = await get_customer_match_context(conn, customer_id)
    if not context:
        raise HTTPException(404, detail=f"Customer ID {customer_id} does not exist")
    return context

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
            pc.full_name AS primary_contact_name,
            pc.email AS email,
            pc.phone AS phone,
            COUNT(DISTINCT so.id)               AS total_orders,
            COALESCE(SUM(so.total_amount), 0)   AS total_revenue,
            MAX(so.created_at)::DATE            AS last_order_date,
            COUNT(DISTINCT inv.id)              AS total_invoices,
            COALESCE(SUM(inv.total_amount), 0)  AS total_invoiced
        FROM customers c
        LEFT JOIN LATERAL (
            SELECT full_name, email, phone
            FROM crm_contacts
            WHERE customer_id = c.id
            ORDER BY is_primary DESC, created_at ASC
            LIMIT 1
        ) pc ON true
        LEFT JOIN sales_orders so  ON so.customer_id = c.id
        LEFT JOIN invoices inv     ON inv.customer_id = c.id
        WHERE c.id = $1
        GROUP BY c.id, pc.full_name, pc.email, pc.phone
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
            COALESCE(SUM(amount - COALESCE(paid_amount, 0)), 0) AS outstanding,
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
        ) VALUES ($1,$2,$3,$4,$5,$6::text::business_system,$7,$8)
        RETURNING *
        """,
        body.customer_code, body.company_name, body.short_name, body.tax_code,
        body.address, body.business_system, body.customer_type, body.is_active,
    )

    if body.email or body.phone:
        await conn.execute(
            """
            INSERT INTO crm_contacts (
                customer_id, full_name, email, phone, is_primary, notes
            ) VALUES ($1, $2, $3, $4, true, $5)
            """,
            row["id"],
            body.short_name or body.company_name,
            body.email,
            body.phone,
            "Auto-created from customer form",
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

    # Fields that need special casting
    enum_fields = {"business_system"}

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
            if field in enum_fields:
                updates.append(f"{field} = ${idx}::text::{field}")
            else:
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
# Customer external mappings
# ---------------------------------------------------------------------------

@router.get("/customers/{customer_id}/external-maps")
async def list_customer_external_maps(
    customer_id: int,
    token_data: TokenData = Depends(require_role("staff", "accountant", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    await _assert_customer_exists(conn, customer_id)
    rows = await conn.fetch(
        """
        SELECT id, customer_id, source_system, match_field, match_value,
               is_primary, notes, created_at, updated_at
        FROM crm_account_external_map
        WHERE customer_id = $1
        ORDER BY source_system, match_field, is_primary DESC, match_value
        """,
        customer_id,
    )
    return {"data": {"mappings": _rows_to_list(rows)}}


@router.post("/customers/{customer_id}/external-maps", status_code=201)
async def create_customer_external_map(
    customer_id: int,
    body: ExternalMapCreateRequest,
    token_data: TokenData = Depends(require_role("manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    await _assert_customer_exists(conn, customer_id)

    if body.is_primary:
        await conn.execute(
            """
            UPDATE crm_account_external_map
            SET is_primary = false, updated_at = NOW()
            WHERE customer_id = $1 AND source_system = $2 AND match_field = $3
            """,
            customer_id,
            body.source_system,
            body.match_field,
        )

    row = await conn.fetchrow(
        """
        INSERT INTO crm_account_external_map (
            customer_id, source_system, match_field, match_value, is_primary, notes
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (customer_id, source_system, match_field, match_value)
        DO UPDATE SET
            is_primary = EXCLUDED.is_primary,
            notes = EXCLUDED.notes,
            updated_at = NOW()
        RETURNING id, customer_id, source_system, match_field, match_value,
                  is_primary, notes, created_at, updated_at
        """,
        customer_id,
        body.source_system.strip(),
        body.match_field.strip(),
        body.match_value.strip(),
        body.is_primary,
        body.notes,
    )
    return {"data": dict(row), "message": "External mapping saved"}


@router.delete("/customers/{customer_id}/external-maps/{mapping_id}")
async def delete_customer_external_map(
    customer_id: int,
    mapping_id: int,
    token_data: TokenData = Depends(require_role("manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    await _assert_customer_exists(conn, customer_id)
    deleted = await conn.fetchrow(
        """
        DELETE FROM crm_account_external_map
        WHERE id = $1 AND customer_id = $2
        RETURNING id
        """,
        mapping_id,
        customer_id,
    )
    if not deleted:
        raise HTTPException(404, detail="Mapping not found")
    return {"message": "External mapping deleted"}


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


# ---------------------------------------------------------------------------
# CRM Overview — KPI tổng quan
# ---------------------------------------------------------------------------

@router.get("/overview")
async def crm_overview(
    token_data: TokenData = Depends(require_role("staff", "accountant", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """KPI tổng quan CRM: tổng KH, doanh thu, công nợ, win rate."""
    stats = await conn.fetchrow("""
        SELECT
            (SELECT COUNT(*) FROM customers WHERE is_active = true AND deleted_at IS NULL)::int AS total_customers,
            (SELECT COALESCE(SUM(amount), 0) FROM bqms_samsung_po)::bigint AS total_revenue,
            (SELECT COALESCE(SUM(amount), 0) FROM bqms_samsung_po
             WHERE po_date >= DATE_TRUNC('month', CURRENT_DATE))::bigint AS revenue_this_month,
            (SELECT COALESCE(SUM((amount - COALESCE(paid_amount, 0))), 0) FROM accounts_receivable
             WHERE status != 'paid')::bigint AS total_ar_outstanding,
            (SELECT COUNT(*) FROM accounts_receivable
             WHERE status != 'paid' AND due_date < CURRENT_DATE)::int AS ar_overdue_count,
            (SELECT ROUND(
                COUNT(*) FILTER (WHERE result::text ILIKE '%%won%%')::numeric
                / NULLIF(COUNT(*) FILTER (WHERE result::text ILIKE '%%won%%' OR result::text ILIKE '%%lost%%'), 0) * 100, 1
            ) FROM bqms_rfq) AS win_rate
    """)

    # Top 5 customers by PO amount
    top_customers = await conn.fetch("""
        WITH mapped_pos AS (
            SELECT DISTINCT map.customer_id, sp.id, sp.amount
            FROM crm_account_external_map map
            JOIN bqms_samsung_po sp
              ON LOWER(COALESCE(sp.company, '')) = LOWER(map.match_value)
            WHERE map.source_system = 'bqms_samsung_po'
              AND map.match_field = 'company'
        )
        SELECT c.id, c.company_name, c.short_name, c.customer_code,
               COUNT(DISTINCT mp.id)::int AS po_count,
               COALESCE(SUM(mp.amount), 0)::bigint AS total_amount
        FROM customers c
        LEFT JOIN mapped_pos mp ON mp.customer_id = c.id
        WHERE c.is_active = true AND c.deleted_at IS NULL
        GROUP BY c.id
        ORDER BY total_amount DESC, c.company_name
        LIMIT 5
    """)

    # Monthly revenue trend (last 6 months)
    monthly = await conn.fetch("""
        SELECT DATE_TRUNC('month', po_date)::date AS month,
               COALESCE(SUM(amount), 0)::bigint AS total
        FROM bqms_samsung_po
        WHERE po_date >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '5 months'
        GROUP BY 1 ORDER BY 1
    """)

    return {"data": {
        **(dict(stats) if stats else {}),
        "top_customers": _rows_to_list(top_customers),
        "monthly_revenue": _rows_to_list(monthly),
    }}


# ---------------------------------------------------------------------------
# Customer Orders (PO + Deliveries)
# ---------------------------------------------------------------------------

@router.get("/customers/{customer_id}/orders")
async def customer_orders(
    customer_id: int,
    page: int = Query(1, ge=1),
    limit: int = Query(5, ge=1, le=50),
    token_data: TokenData = Depends(require_role("staff", "accountant", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """L???ch s??? ????n h??ng (PO + deliveries) c???a kh??ch h??ng."""
    match_context = await _get_customer_match_context_or_404(conn, customer_id)
    po_companies = non_empty_aliases(match_context.get("po_companies", []))
    delivery_types = non_empty_aliases(match_context.get("delivery_types", []))
    offset = (page - 1) * limit

    if po_companies:
        po_keys = [value.lower() for value in po_companies]
        pos = await conn.fetch(
            """
            SELECT po_number, bqms_code, LEFT(specification, 60) AS spec,
                   po_date, order_qty, amount, process_status::text AS status
            FROM bqms_samsung_po
            WHERE LOWER(COALESCE(company, '')) = ANY($1::text[])
            ORDER BY po_date DESC NULLS LAST
            LIMIT $2 OFFSET $3
            """,
            po_keys,
            limit,
            offset,
        )
        total_pos = await conn.fetchval(
            """
            SELECT COUNT(*)
            FROM bqms_samsung_po
            WHERE LOWER(COALESCE(company, '')) = ANY($1::text[])
            """,
            po_keys,
        )
    else:
        pos = []
        total_pos = 0

    if delivery_types:
        delivery_keys = [value.lower() for value in delivery_types]
        deliveries = await conn.fetch(
            """
            SELECT po_number, bqms_code, LEFT(specification, 60) AS spec,
                   delivery_date, quantity, amount, delivery_status::text AS status
            FROM bqms_deliveries
            WHERE LOWER(COALESCE(sev_type, '')) = ANY($1::text[])
            ORDER BY po_date DESC NULLS LAST
            LIMIT $2 OFFSET $3
            """,
            delivery_keys,
            limit,
            offset,
        )
        total_deliveries = await conn.fetchval(
            """
            SELECT COUNT(*)
            FROM bqms_deliveries
            WHERE LOWER(COALESCE(sev_type, '')) = ANY($1::text[])
            """,
            delivery_keys,
        )
    else:
        deliveries = []
        total_deliveries = 0

    return {"data": {
        "pos": _rows_to_list(pos),
        "total_pos": total_pos,
        "deliveries": _rows_to_list(deliveries),
        "total_deliveries": total_deliveries,
        "match_context": {
            "po_companies": po_companies,
            "delivery_types": delivery_types,
        },
    }}


# ---------------------------------------------------------------------------
# Customer Financials
# ---------------------------------------------------------------------------

@router.get("/customers/{customer_id}/financials")
async def customer_financials(
    customer_id: int,
    token_data: TokenData = Depends(require_role("staff", "accountant", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """T??i ch??nh kh??ch h??ng: c??ng n???, thanh to??n, h??a ????n."""
    ar_aging = await conn.fetchrow("""
        SELECT
            COALESCE(SUM((amount - COALESCE(paid_amount, 0))) FILTER (WHERE due_date >= CURRENT_DATE), 0)::bigint AS current_amount,
            COALESCE(SUM((amount - COALESCE(paid_amount, 0))) FILTER (WHERE CURRENT_DATE - due_date BETWEEN 1 AND 30), 0)::bigint AS days_1_30,
            COALESCE(SUM((amount - COALESCE(paid_amount, 0))) FILTER (WHERE CURRENT_DATE - due_date BETWEEN 31 AND 60), 0)::bigint AS days_31_60,
            COALESCE(SUM((amount - COALESCE(paid_amount, 0))) FILTER (WHERE CURRENT_DATE - due_date > 60), 0)::bigint AS days_over_60,
            COALESCE(SUM((amount - COALESCE(paid_amount, 0))), 0)::bigint AS total_outstanding
        FROM accounts_receivable
        WHERE customer_id = $1 AND status != 'paid'
    """, customer_id)

    payments = await conn.fetch("""
        SELECT updated_at AS paid_date, paid_amount, invoice_number, notes
        FROM accounts_receivable
        WHERE customer_id = $1 AND status = 'paid'
        ORDER BY updated_at DESC
        LIMIT 5
    """, customer_id)

    match_context = await _get_customer_match_context_or_404(conn, customer_id)
    po_companies = non_empty_aliases(match_context.get("po_companies", []))

    if po_companies:
        po_keys = [value.lower() for value in po_companies]
        revenue = await conn.fetchrow("""
            SELECT
                COALESCE(SUM(amount), 0)::bigint AS total_revenue,
                COALESCE(SUM(amount) FILTER (WHERE po_date >= DATE_TRUNC('month', CURRENT_DATE)), 0)::bigint AS revenue_this_month,
                COUNT(*)::int AS total_pos
            FROM bqms_samsung_po
            WHERE LOWER(COALESCE(company, '')) = ANY($1::text[])
        """, po_keys)
    else:
        revenue = {"total_revenue": 0, "revenue_this_month": 0, "total_pos": 0}

    return {"data": {
        "ar_aging": dict(ar_aging) if ar_aging else {},
        "recent_payments": _rows_to_list(payments),
        "revenue": dict(revenue) if revenue else {},
        "match_context": {
            "po_companies": po_companies,
        },
    }}


# ---------------------------------------------------------------------------
# All Contacts (across all customers)
# ---------------------------------------------------------------------------

@router.get("/contacts-all")
async def all_contacts(
    search: str = Query("", description="Tìm theo tên, email, SĐT"),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    token_data: TokenData = Depends(require_role("staff", "accountant", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Danh bạ tổng hợp — tất cả contacts từ mọi KH + BQMS."""
    where = "1=1"
    params: list = []
    idx = 1

    if search:
        where = f"(cc.full_name ILIKE ${idx} OR cc.email ILIKE ${idx} OR cc.phone ILIKE ${idx})"
        params.append(f"%{search}%")
        idx += 1

    total = await conn.fetchval(
        f"SELECT COUNT(*) FROM crm_contacts cc WHERE {where}", *params
    )

    params.extend([limit, (page - 1) * limit])
    rows = await conn.fetch(f"""
        SELECT cc.id, cc.full_name, cc.position, cc.email, cc.phone,
               cc.department, cc.last_contacted_at, cc.is_primary,
               c.company_name, c.short_name, c.id AS customer_id
        FROM crm_contacts cc
        LEFT JOIN customers c ON c.id = cc.customer_id
        WHERE {where}
        ORDER BY cc.full_name
        LIMIT ${idx} OFFSET ${idx + 1}
    """, *params)

    # Also include bqms_contacts not yet in crm_contacts
    bqms = await conn.fetch("""
        SELECT bc.id, bc.full_name, bc.email_username AS email, bc.phone,
               bc.delivery_info AS department, 'Samsung BQMS' AS company_name
        FROM bqms_contacts bc
        WHERE bc.is_active = true
        ORDER BY bc.full_name
        LIMIT 50
    """)

    return {"data": {
        "contacts": _rows_to_list(rows),
        "bqms_contacts": _rows_to_list(bqms),
        "total": total,
    }}


# ---------------------------------------------------------------------------
# Customer Quotes (RFQ history)
# ---------------------------------------------------------------------------

@router.get("/customers/{customer_id}/quotes")
async def customer_quotes(
    customer_id: int,
    page: int = Query(1, ge=1),
    limit: int = Query(5, ge=1, le=50),
    token_data: TokenData = Depends(require_role("staff", "accountant", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """L???ch s??? RFQ/b??o gi?? cho kh??ch h??ng."""
    await _assert_customer_exists(conn, customer_id)
    offset = (page - 1) * limit
    match_context = await _get_customer_match_context_or_404(conn, customer_id)
    order_customer_names = non_empty_aliases(match_context.get("order_customer_names", []))
    order_keys = [value.lower() for value in order_customer_names]
    has_direct_submission_links = bool(
        await conn.fetchval(
            "SELECT 1 FROM bqms_rfq_submissions WHERE customer_id = $1 LIMIT 1",
            customer_id,
        )
    )

    stats = await conn.fetchrow(
        """
        WITH matched_rfqs AS (
            SELECT DISTINCT sub.rfq_number
            FROM bqms_rfq_submissions sub
            WHERE sub.customer_id = $1
            UNION
            SELECT DISTINCT bo.rfq_number
            FROM bqms_orders bo
            WHERE CARDINALITY($2::text[]) > 0
              AND LOWER(COALESCE(bo.customer_name, '')) = ANY($2::text[])
        )
        SELECT
            COUNT(*)::int AS total_rfqs,
            COUNT(*) FILTER (WHERE rfq.result::text ILIKE '%%won%%')::int AS won,
            COUNT(*) FILTER (WHERE rfq.result::text ILIKE '%%lost%%')::int AS lost,
            COUNT(*) FILTER (WHERE rfq.result IS NULL OR rfq.result::text = '' OR rfq.result::text = 'pending')::int AS pending,
            ROUND(
                COUNT(*) FILTER (WHERE rfq.result::text ILIKE '%%won%%')::numeric
                / NULLIF(COUNT(*) FILTER (WHERE rfq.result::text ILIKE '%%won%%' OR rfq.result::text ILIKE '%%lost%%'), 0) * 100,
                1
            ) AS win_rate
        FROM bqms_rfq rfq
        JOIN matched_rfqs mr ON mr.rfq_number = rfq.rfq_number
        """,
        customer_id,
        order_keys,
    )

    rfqs = await conn.fetch(
        """
        WITH matched_rfqs AS (
            SELECT DISTINCT sub.rfq_number
            FROM bqms_rfq_submissions sub
            WHERE sub.customer_id = $1
            UNION
            SELECT DISTINCT bo.rfq_number
            FROM bqms_orders bo
            WHERE CARDINALITY($2::text[]) > 0
              AND LOWER(COALESCE(bo.customer_name, '')) = ANY($2::text[])
        )
        SELECT rfq.id, rfq.rfq_number, rfq.bqms_code, LEFT(rfq.specification, 60) AS spec,
               rfq.maker, rfq.result::text, rfq.inquiry_date,
               rfq.quoted_price_bqms_v1, rfq.quoted_price_bqms_v2
        FROM bqms_rfq rfq
        JOIN matched_rfqs mr ON mr.rfq_number = rfq.rfq_number
        ORDER BY rfq.inquiry_date DESC NULLS LAST, rfq.id DESC
        LIMIT $3 OFFSET $4
        """,
        customer_id,
        order_keys,
        limit,
        offset,
    )

    total = await conn.fetchval(
        """
        WITH matched_rfqs AS (
            SELECT DISTINCT sub.rfq_number
            FROM bqms_rfq_submissions sub
            WHERE sub.customer_id = $1
            UNION
            SELECT DISTINCT bo.rfq_number
            FROM bqms_orders bo
            WHERE CARDINALITY($2::text[]) > 0
              AND LOWER(COALESCE(bo.customer_name, '')) = ANY($2::text[])
        )
        SELECT COUNT(*)
        FROM bqms_rfq rfq
        JOIN matched_rfqs mr ON mr.rfq_number = rfq.rfq_number
        """,
        customer_id,
        order_keys,
    )

    return {"data": {
        "stats": dict(stats) if stats else {},
        "rfqs": _rows_to_list(rfqs),
        "total": total,
        "match_context": {
            "order_customer_names": order_customer_names,
            "has_direct_submission_links": has_direct_submission_links,
        },
    }}
