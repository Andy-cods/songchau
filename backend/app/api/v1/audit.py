"""Audit Log API — Immutable audit trail, admin only."""

from __future__ import annotations

from datetime import date
from fastapi import APIRouter, Depends, Query
import asyncpg

from app.core.database import get_db
from app.core.rbac import require_role
from app.core.security import TokenData

router = APIRouter()


@router.get("")
async def list_audit_logs(
    user_id: str | None = Query(None, description="UUID của người dùng"),
    table_name: str | None = Query(None),
    action: str | None = Query(None, description="INSERT, UPDATE, DELETE"),
    record_id: str | None = Query(None),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    token_data: TokenData = Depends(require_role("admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """List audit log entries — admin only.

    The audit_log table is immutable: no UPDATE or DELETE is allowed.
    This endpoint provides read-only access with rich filtering.
    """
    conditions = ["1=1"]
    params: list = []
    idx = 1

    if user_id:
        conditions.append(f"al.user_id = ${idx}::uuid")
        params.append(user_id)
        idx += 1
    if table_name:
        conditions.append(f"al.table_name = ${idx}")
        params.append(table_name)
        idx += 1
    if action:
        conditions.append(f"al.action = ${idx}")
        params.append(action)
        idx += 1
    if record_id:
        conditions.append(f"al.record_id = ${idx}")
        params.append(record_id)
        idx += 1
    if date_from:
        conditions.append(f"al.created_at::date >= ${idx}")
        params.append(date_from)
        idx += 1
    if date_to:
        conditions.append(f"al.created_at::date <= ${idx}")
        params.append(date_to)
        idx += 1

    where = " AND ".join(conditions)

    total = await conn.fetchval(
        f"SELECT COUNT(*) FROM audit_log al WHERE {where}", *params
    )

    params.extend([limit, offset])
    rows = await conn.fetch(
        f"""
        SELECT al.id, al.user_id, al.user_email,
               al.action, al.table_name, al.record_id,
               al.old_data, al.new_data,
               al.ip_address, al.user_agent, al.request_id,
               al.created_at,
               u.full_name AS user_name
        FROM audit_log al
        LEFT JOIN users u ON u.id = al.user_id
        WHERE {where}
        ORDER BY al.created_at DESC
        LIMIT ${idx} OFFSET ${idx + 1}
        """,
        *params,
    )
    return {"data": [dict(r) for r in rows], "total": total}
