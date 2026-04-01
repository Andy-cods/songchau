"""
Security Log API (M23) — Song Châu ERP

Detailed security audit trail: login attempts, permission denials,
suspicious activities, role changes, password updates.

Endpoints:
  GET  /              — List security events with filters + pagination
  GET  /summary       — Summary stats (today's logins, failures, by severity)
  GET  /user/{user_id} — Security history for a specific user
"""

from __future__ import annotations

import logging
from typing import Optional

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.core.database import get_db
from app.core.rbac import require_role
from app.core.security import TokenData

logger = logging.getLogger(__name__)

router = APIRouter()

VALID_EVENT_TYPES = {
    "login",
    "logout",
    "login_failed",
    "password_change",
    "role_change",
    "permission_denied",
    "suspicious_activity",
    "token_refresh",
}

VALID_SEVERITIES = {"info", "warning", "critical"}


# ---------------------------------------------------------------------------
# GET / — List security events
# ---------------------------------------------------------------------------

@router.get("")
async def list_security_events(
    event_type: Optional[str] = Query(None, description="Loại sự kiện bảo mật"),
    user_id: Optional[str] = Query(None, description="UUID người dùng"),
    severity: Optional[str] = Query(None, description="info | warning | critical"),
    date_from: Optional[str] = Query(None, description="ISO date: 2024-01-01"),
    date_to: Optional[str] = Query(None, description="ISO date: 2024-12-31"),
    ip_address: Optional[str] = Query(None, description="Địa chỉ IP"),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=500),
    token_data: TokenData = Depends(require_role("admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    conditions = ["1=1"]
    params: list = []
    idx = 1

    if event_type:
        if event_type not in VALID_EVENT_TYPES:
            raise HTTPException(
                status_code=400,
                detail=f"Loại sự kiện không hợp lệ. Chấp nhận: {', '.join(sorted(VALID_EVENT_TYPES))}",
            )
        conditions.append(f"sl.event_type = ${idx}")
        params.append(event_type)
        idx += 1

    if user_id:
        conditions.append(f"sl.user_id = ${idx}::uuid")
        params.append(user_id)
        idx += 1

    if severity:
        if severity not in VALID_SEVERITIES:
            raise HTTPException(
                status_code=400,
                detail="Mức độ nghiêm trọng phải là: info, warning, hoặc critical",
            )
        conditions.append(f"sl.severity = ${idx}")
        params.append(severity)
        idx += 1

    if date_from:
        conditions.append(f"sl.created_at >= ${idx}::timestamptz")
        params.append(date_from)
        idx += 1

    if date_to:
        conditions.append(f"sl.created_at < (${idx}::date + INTERVAL '1 day')::timestamptz")
        params.append(date_to)
        idx += 1

    if ip_address:
        conditions.append(f"sl.ip_address = ${idx}::inet")
        params.append(ip_address)
        idx += 1

    where = " AND ".join(conditions)
    offset = (page - 1) * limit

    total = await conn.fetchval(
        f"SELECT COUNT(*) FROM security_log sl WHERE {where}", *params
    )

    params.extend([limit, offset])
    rows = await conn.fetch(
        f"""
        SELECT sl.*,
               sl.ip_address::text AS ip_address_text,
               u.full_name         AS user_name,
               u.email             AS user_email,
               u.role              AS user_role
        FROM security_log sl
        LEFT JOIN users u ON u.id = sl.user_id
        WHERE {where}
        ORDER BY sl.created_at DESC
        LIMIT ${idx} OFFSET ${idx + 1}
        """,
        *params,
    )

    items = []
    for r in rows:
        item = dict(r)
        # Replace inet field with text representation
        item["ip_address"] = item.pop("ip_address_text", None)
        items.append(item)

    return {
        "data": {
            "items": items,
            "total": int(total or 0),
            "page": page,
            "limit": limit,
        }
    }


# ---------------------------------------------------------------------------
# GET /summary — Stats summary
# ---------------------------------------------------------------------------

@router.get("/summary")
async def security_summary(
    token_data: TokenData = Depends(require_role("admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    # Today's date range
    summary = await conn.fetchrow(
        """
        SELECT
            COUNT(*) FILTER (
                WHERE event_type = 'login'
                  AND created_at >= CURRENT_DATE::timestamptz
            )                                                       AS logins_today,
            COUNT(*) FILTER (
                WHERE event_type = 'login_failed'
                  AND created_at >= CURRENT_DATE::timestamptz
            )                                                       AS failed_logins_today,
            COUNT(*) FILTER (
                WHERE event_type = 'suspicious_activity'
                  AND created_at >= CURRENT_DATE::timestamptz
            )                                                       AS suspicious_today,
            COUNT(*) FILTER (
                WHERE event_type = 'permission_denied'
                  AND created_at >= CURRENT_DATE::timestamptz
            )                                                       AS permission_denied_today,
            COUNT(*) FILTER (WHERE severity = 'critical')           AS critical_total,
            COUNT(*) FILTER (WHERE severity = 'warning')            AS warning_total,
            COUNT(*) FILTER (
                WHERE severity = 'critical'
                  AND created_at >= NOW() - INTERVAL '24 hours'
            )                                                       AS critical_24h
        FROM security_log
        """
    )

    # Events by type (last 30 days)
    by_type = await conn.fetch(
        """
        SELECT event_type, COUNT(*) AS count
        FROM security_log
        WHERE created_at >= NOW() - INTERVAL '30 days'
        GROUP BY event_type
        ORDER BY count DESC
        """
    )

    # Events by severity (last 30 days)
    by_severity = await conn.fetch(
        """
        SELECT severity, COUNT(*) AS count
        FROM security_log
        WHERE created_at >= NOW() - INTERVAL '30 days'
        GROUP BY severity
        ORDER BY count DESC
        """
    )

    # Top IPs with failed logins (last 7 days)
    top_failed_ips = await conn.fetch(
        """
        SELECT ip_address::text AS ip, COUNT(*) AS failed_count
        FROM security_log
        WHERE event_type = 'login_failed'
          AND created_at >= NOW() - INTERVAL '7 days'
        GROUP BY ip_address
        ORDER BY failed_count DESC
        LIMIT 10
        """
    )

    return {
        "data": {
            "today": dict(summary) if summary else {},
            "events_by_type_30d": [dict(r) for r in by_type],
            "events_by_severity_30d": [dict(r) for r in by_severity],
            "top_failed_ips_7d": [dict(r) for r in top_failed_ips],
        }
    }


# ---------------------------------------------------------------------------
# GET /user/{user_id} — Security history for a specific user
# ---------------------------------------------------------------------------

@router.get("/user/{user_id}")
async def user_security_history(
    user_id: str,
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    token_data: TokenData = Depends(require_role("admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    # Verify user exists
    user = await conn.fetchrow(
        "SELECT id, full_name, email, role FROM users WHERE id = $1::uuid",
        user_id,
    )
    if not user:
        raise HTTPException(status_code=404, detail="Người dùng không tồn tại")

    total = await conn.fetchval(
        "SELECT COUNT(*) FROM security_log WHERE user_id = $1::uuid", user_id
    )

    offset = (page - 1) * limit
    rows = await conn.fetch(
        """
        SELECT id, event_type, ip_address::text AS ip_address,
               user_agent, details, severity, created_at
        FROM security_log
        WHERE user_id = $1::uuid
        ORDER BY created_at DESC
        LIMIT $2 OFFSET $3
        """,
        user_id,
        limit,
        offset,
    )

    return {
        "data": {
            "user": dict(user),
            "events": [dict(r) for r in rows],
            "total": int(total or 0),
            "page": page,
            "limit": limit,
        }
    }
