"""
Email History API (M15) — Samsung Email Communication Log.

Endpoints:
  GET  /                          — List emails (direction, ref_type, search, pagination)
  GET  /stats                     — Email stats: sent/received by month, avg response time
  GET  /by-entity/{ref_type}/{ref_id} — Emails linked to specific RFQ/PO/Invoice
  GET  /{id}                      — Email detail with full body
"""

from __future__ import annotations

import logging
from typing import Optional

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.database import get_db
from app.core.rbac import require_role
from app.core.security import TokenData

logger = logging.getLogger(__name__)
router = APIRouter()


# ---------------------------------------------------------------------------
# GET /  — List emails
# ---------------------------------------------------------------------------

@router.get("/")
async def list_emails(
    direction: Optional[str] = Query(None, description="inbound | outbound"),
    ref_type: Optional[str] = Query(None, description="bqms_rfq | purchase_orders | invoices"),
    search: Optional[str] = Query(None, description="Tìm theo subject / from_email / to_email"),
    is_read: Optional[bool] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Danh sách email trao đổi với Samsung — có filter và phân trang."""
    offset = (page - 1) * page_size

    conditions: list[str] = []
    params: list = []
    idx = 1

    if direction:
        conditions.append(f"direction = ${idx}")
        params.append(direction)
        idx += 1

    if ref_type:
        conditions.append(f"ref_type = ${idx}")
        params.append(ref_type)
        idx += 1

    if is_read is not None:
        conditions.append(f"is_read = ${idx}")
        params.append(is_read)
        idx += 1

    if search:
        conditions.append(
            f"(subject ILIKE ${idx} OR from_email ILIKE ${idx} OR to_email ILIKE ${idx})"
        )
        params.append(f"%{search}%")
        idx += 1

    where_clause = ("WHERE " + " AND ".join(conditions)) if conditions else ""

    count_row = await conn.fetchrow(
        f"SELECT COUNT(*) AS total FROM email_history {where_clause}",
        *params,
    )
    total = count_row["total"]

    params_page = params + [page_size, offset]
    rows = await conn.fetch(
        f"""
        SELECT
            id, direction, from_email, to_email, subject,
            body_preview, has_attachments, attachment_names,
            message_id, conversation_id,
            ref_type, ref_id, is_read,
            received_at, created_at
        FROM email_history
        {where_clause}
        ORDER BY COALESCE(received_at, created_at) DESC
        LIMIT ${idx} OFFSET ${idx + 1}
        """,
        *params_page,
    )

    return {
        "data": {
            "items": [dict(r) for r in rows],
            "total": total,
            "page": page,
            "page_size": page_size,
            "pages": (total + page_size - 1) // page_size,
        },
        "message": "Lấy danh sách email thành công",
    }


# ---------------------------------------------------------------------------
# GET /stats  — Email statistics
# ---------------------------------------------------------------------------

@router.get("/stats")
async def email_stats(
    months: int = Query(6, ge=1, le=24, description="Số tháng nhìn lại"),
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Thống kê email: gửi/nhận theo tháng, thời gian phản hồi trung bình."""

    # Monthly sent/received counts
    monthly_rows = await conn.fetch(
        """
        SELECT
            TO_CHAR(DATE_TRUNC('month', COALESCE(received_at, created_at)), 'YYYY-MM') AS month,
            direction,
            COUNT(*) AS email_count
        FROM email_history
        WHERE COALESCE(received_at, created_at) >= NOW() - ($1 || ' months')::INTERVAL
        GROUP BY 1, 2
        ORDER BY 1 DESC, 2
        """,
        str(months),
    )

    # Avg response time: for each inbound email that has a matching outbound
    # in the same conversation within 72h
    avg_response = await conn.fetchrow(
        """
        SELECT
            AVG(
                EXTRACT(EPOCH FROM (o.received_at - i.received_at)) / 3600.0
            )::NUMERIC(10,2) AS avg_response_hours
        FROM email_history i
        JOIN email_history o
            ON o.conversation_id = i.conversation_id
            AND o.direction = 'outbound'
            AND o.received_at > i.received_at
            AND o.received_at <= i.received_at + INTERVAL '72 hours'
        WHERE i.direction = 'inbound'
          AND i.received_at >= NOW() - ($1 || ' months')::INTERVAL
        """,
        str(months),
    )

    # Overall totals
    totals = await conn.fetch(
        """
        SELECT direction, COUNT(*) AS cnt
        FROM email_history
        WHERE COALESCE(received_at, created_at) >= NOW() - ($1 || ' months')::INTERVAL
        GROUP BY direction
        """,
        str(months),
    )

    totals_map = {r["direction"]: r["cnt"] for r in totals}

    return {
        "data": {
            "monthly": [dict(r) for r in monthly_rows],
            "total_inbound": totals_map.get("inbound", 0),
            "total_outbound": totals_map.get("outbound", 0),
            "avg_response_hours": avg_response["avg_response_hours"] if avg_response else None,
            "period_months": months,
        },
        "message": "Thống kê email thành công",
    }


# ---------------------------------------------------------------------------
# GET /by-entity/{ref_type}/{ref_id}  — Emails linked to an entity
# ---------------------------------------------------------------------------

@router.get("/by-entity/{ref_type}/{ref_id}")
async def emails_by_entity(
    ref_type: str,
    ref_id: int,
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Danh sách email gắn với một RFQ / PO / Invoice cụ thể."""
    valid_ref_types = {"bqms_rfq", "purchase_orders", "invoices"}
    if ref_type not in valid_ref_types:
        raise HTTPException(
            status_code=400,
            detail=f"ref_type không hợp lệ. Chấp nhận: {', '.join(valid_ref_types)}",
        )

    rows = await conn.fetch(
        """
        SELECT
            id, direction, from_email, to_email, subject,
            body_preview, has_attachments, attachment_names,
            message_id, conversation_id,
            is_read, received_at, created_at
        FROM email_history
        WHERE ref_type = $1 AND ref_id = $2
        ORDER BY COALESCE(received_at, created_at) DESC
        """,
        ref_type,
        ref_id,
    )

    return {
        "data": {
            "ref_type": ref_type,
            "ref_id": ref_id,
            "items": [dict(r) for r in rows],
            "total": len(rows),
        },
        "message": "Lấy email theo thực thể thành công",
    }


# ---------------------------------------------------------------------------
# GET /{id}  — Email detail
# ---------------------------------------------------------------------------

@router.get("/{email_id}")
async def get_email(
    email_id: int,
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Chi tiết email bao gồm nội dung HTML đầy đủ."""
    row = await conn.fetchrow(
        """
        SELECT
            id, direction, from_email, to_email, subject,
            body_preview, body_html, has_attachments, attachment_names,
            message_id, conversation_id,
            ref_type, ref_id, is_read,
            received_at, created_at
        FROM email_history
        WHERE id = $1
        """,
        email_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Không tìm thấy email")

    # Mark as read
    await conn.execute(
        "UPDATE email_history SET is_read = true WHERE id = $1 AND is_read = false",
        email_id,
    )

    return {
        "data": dict(row),
        "message": "Lấy chi tiết email thành công",
    }
