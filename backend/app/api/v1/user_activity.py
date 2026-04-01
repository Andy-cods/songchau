"""
User Activity Log API (M28) — Song Châu ERP

Tracks front-end user actions (page views, button clicks, exports, searches,
CRUD operations) for analytics, UX improvement, and audit purposes.

Endpoints:
  POST /track              — Log a user action (called from frontend)
  GET  /                   — List activity log (admin only) with filters
  GET  /summary            — Active users today, most viewed pages, actions by type
  GET  /user/{user_id}     — Activity history for a specific user
"""

from __future__ import annotations

import logging
from typing import Any, Optional

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.core.database import get_db
from app.core.rbac import require_role
from app.core.security import TokenData

logger = logging.getLogger(__name__)

router = APIRouter()

VALID_ACTIONS = {
    "page_view",
    "button_click",
    "export",
    "search",
    "create",
    "update",
    "delete",
    "download",
    "login",
    "logout",
    "filter",
    "sort",
}


# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------

class TrackActionRequest(BaseModel):
    action: str
    page: Optional[str] = None
    entity_type: Optional[str] = None
    entity_id: Optional[int] = None
    metadata: Optional[dict[str, Any]] = None
    session_id: Optional[str] = None


# ---------------------------------------------------------------------------
# POST /track — Log a user action
# ---------------------------------------------------------------------------

@router.post("/track", status_code=201)
async def track_action(
    body: TrackActionRequest,
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    # Accept unknown actions gracefully (don't reject; just normalise)
    action = body.action if body.action in VALID_ACTIONS else "button_click"

    import json as _json
    metadata_json = _json.dumps(body.metadata or {})

    try:
        row = await conn.fetchrow(
            """
            INSERT INTO user_activity_log
                (user_id, action, page, entity_type, entity_id, metadata, session_id)
            VALUES ($1::uuid, $2, $3, $4, $5, $6::jsonb, $7)
            RETURNING id, created_at
            """,
            token_data.user_id,
            action,
            body.page,
            body.entity_type,
            body.entity_id,
            metadata_json,
            body.session_id,
        )
    except Exception as exc:
        # Never block the UI because of a tracking failure
        logger.warning("Activity tracking failed: %s", exc)
        return {"data": {"tracked": False}, "message": "Không thể ghi log hoạt động"}

    return {
        "data": {"id": row["id"], "tracked": True, "created_at": str(row["created_at"])},
        "message": "Đã ghi lại hoạt động",
    }


# ---------------------------------------------------------------------------
# GET / — List activity log (admin only)
# ---------------------------------------------------------------------------

@router.get("")
async def list_activity(
    user_id: Optional[str] = Query(None, description="UUID người dùng"),
    action: Optional[str] = Query(None, description="Loại hành động"),
    page_path: Optional[str] = Query(None, description="Đường dẫn trang", alias="page"),
    date_from: Optional[str] = Query(None, description="ISO date: 2024-01-01"),
    date_to: Optional[str] = Query(None, description="ISO date: 2024-12-31"),
    session_id: Optional[str] = Query(None),
    pg: int = Query(1, ge=1, alias="page_num"),
    limit: int = Query(100, ge=1, le=500),
    token_data: TokenData = Depends(require_role("admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    conditions = ["1=1"]
    params: list = []
    idx = 1

    if user_id:
        conditions.append(f"ual.user_id = ${idx}::uuid")
        params.append(user_id)
        idx += 1

    if action:
        conditions.append(f"ual.action = ${idx}")
        params.append(action)
        idx += 1

    if page_path:
        conditions.append(f"ual.page ILIKE ${idx}")
        params.append(f"%{page_path}%")
        idx += 1

    if date_from:
        conditions.append(f"ual.created_at >= ${idx}::timestamptz")
        params.append(date_from)
        idx += 1

    if date_to:
        conditions.append(f"ual.created_at < (${idx}::date + INTERVAL '1 day')::timestamptz")
        params.append(date_to)
        idx += 1

    if session_id:
        conditions.append(f"ual.session_id = ${idx}")
        params.append(session_id)
        idx += 1

    where = " AND ".join(conditions)
    offset = (pg - 1) * limit

    total = await conn.fetchval(
        f"SELECT COUNT(*) FROM user_activity_log ual WHERE {where}", *params
    )

    params.extend([limit, offset])
    rows = await conn.fetch(
        f"""
        SELECT ual.*,
               u.full_name AS user_name,
               u.email     AS user_email,
               u.role      AS user_role
        FROM user_activity_log ual
        LEFT JOIN users u ON u.id = ual.user_id
        WHERE {where}
        ORDER BY ual.created_at DESC
        LIMIT ${idx} OFFSET ${idx + 1}
        """,
        *params,
    )

    return {
        "data": {
            "items": [dict(r) for r in rows],
            "total": int(total or 0),
            "page": pg,
            "limit": limit,
        }
    }


# ---------------------------------------------------------------------------
# GET /summary — Analytics summary
# ---------------------------------------------------------------------------

@router.get("/summary")
async def activity_summary(
    token_data: TokenData = Depends(require_role("manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    # Active users today
    active_users_today = await conn.fetchval(
        """
        SELECT COUNT(DISTINCT user_id)
        FROM user_activity_log
        WHERE created_at >= CURRENT_DATE::timestamptz
        """
    )

    # Active users this week
    active_users_week = await conn.fetchval(
        """
        SELECT COUNT(DISTINCT user_id)
        FROM user_activity_log
        WHERE created_at >= NOW() - INTERVAL '7 days'
        """
    )

    # Most viewed pages (last 7 days)
    top_pages = await conn.fetch(
        """
        SELECT page, COUNT(*) AS views
        FROM user_activity_log
        WHERE action = 'page_view'
          AND page IS NOT NULL
          AND created_at >= NOW() - INTERVAL '7 days'
        GROUP BY page
        ORDER BY views DESC
        LIMIT 10
        """
    )

    # Actions by type (last 30 days)
    actions_by_type = await conn.fetch(
        """
        SELECT action, COUNT(*) AS count
        FROM user_activity_log
        WHERE created_at >= NOW() - INTERVAL '30 days'
        GROUP BY action
        ORDER BY count DESC
        """
    )

    # Most active users (last 7 days)
    most_active_users = await conn.fetch(
        """
        SELECT ual.user_id::text,
               u.full_name,
               u.email,
               COUNT(*) AS action_count
        FROM user_activity_log ual
        LEFT JOIN users u ON u.id = ual.user_id
        WHERE ual.created_at >= NOW() - INTERVAL '7 days'
        GROUP BY ual.user_id, u.full_name, u.email
        ORDER BY action_count DESC
        LIMIT 10
        """
    )

    # Hourly activity pattern today
    hourly_today = await conn.fetch(
        """
        SELECT EXTRACT(HOUR FROM created_at)::int AS hour,
               COUNT(*) AS count
        FROM user_activity_log
        WHERE created_at >= CURRENT_DATE::timestamptz
        GROUP BY hour
        ORDER BY hour ASC
        """
    )

    return {
        "data": {
            "active_users_today": int(active_users_today or 0),
            "active_users_week": int(active_users_week or 0),
            "top_pages_7d": [dict(r) for r in top_pages],
            "actions_by_type_30d": [dict(r) for r in actions_by_type],
            "most_active_users_7d": [dict(r) for r in most_active_users],
            "hourly_activity_today": [dict(r) for r in hourly_today],
        }
    }


# ---------------------------------------------------------------------------
# GET /user/{user_id} — Activity history for a specific user
# ---------------------------------------------------------------------------

@router.get("/user/{user_id}")
async def user_activity_history(
    user_id: str,
    action: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    token_data: TokenData = Depends(require_role("admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    # Verify user exists
    user = await conn.fetchrow(
        "SELECT id, full_name, email, role FROM users WHERE id = $1::uuid", user_id
    )
    if not user:
        raise HTTPException(status_code=404, detail="Người dùng không tồn tại")

    conditions = ["ual.user_id = $1::uuid"]
    params: list = [user_id]
    idx = 2

    if action:
        conditions.append(f"ual.action = ${idx}")
        params.append(action)
        idx += 1

    if date_from:
        conditions.append(f"ual.created_at >= ${idx}::timestamptz")
        params.append(date_from)
        idx += 1

    if date_to:
        conditions.append(f"ual.created_at < (${idx}::date + INTERVAL '1 day')::timestamptz")
        params.append(date_to)
        idx += 1

    where = " AND ".join(conditions)
    offset = (page - 1) * limit

    total = await conn.fetchval(
        f"SELECT COUNT(*) FROM user_activity_log ual WHERE {where}", *params
    )

    params.extend([limit, offset])
    rows = await conn.fetch(
        f"""
        SELECT id, action, page, entity_type, entity_id,
               metadata, session_id, created_at
        FROM user_activity_log ual
        WHERE {where}
        ORDER BY created_at DESC
        LIMIT ${idx} OFFSET ${idx + 1}
        """,
        *params,
    )

    # Summary stats for this user
    stats = await conn.fetchrow(
        """
        SELECT
            COUNT(*)                                                    AS total_actions,
            COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE::timestamptz) AS actions_today,
            COUNT(DISTINCT DATE(created_at))                            AS active_days,
            MIN(created_at)::text                                       AS first_seen,
            MAX(created_at)::text                                       AS last_seen,
            COUNT(*) FILTER (WHERE action = 'page_view')                AS page_views,
            COUNT(*) FILTER (WHERE action = 'export')                   AS exports
        FROM user_activity_log
        WHERE user_id = $1::uuid
        """,
        user_id,
    )

    return {
        "data": {
            "user": dict(user),
            "stats": dict(stats) if stats else {},
            "activities": [dict(r) for r in rows],
            "total": int(total or 0),
            "page": page,
            "limit": limit,
        }
    }
