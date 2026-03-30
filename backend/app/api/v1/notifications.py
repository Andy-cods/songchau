"""Notifications API — list, mark read, mark all read."""

from fastapi import APIRouter, Depends, HTTPException, Query
import asyncpg

from app.core.database import get_db
from app.core.rbac import require_role
from app.core.security import TokenData

router = APIRouter()


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("")
async def list_notifications(
    is_read: bool | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    conditions = ["n.recipient_id = $1::uuid"]
    params: list = [token_data.user_id]
    idx = 2

    if is_read is not None:
        conditions.append(f"n.is_read = ${idx}")
        params.append(is_read)
        idx += 1

    where = " AND ".join(conditions)

    total = await conn.fetchval(
        f"SELECT COUNT(*) FROM notifications n WHERE {where}", *params
    )

    unread_count = await conn.fetchval(
        "SELECT COUNT(*) FROM notifications WHERE recipient_id = $1::uuid AND is_read = false",
        token_data.user_id,
    )

    params.extend([limit, offset])
    rows = await conn.fetch(
        f"""
        SELECT n.*
        FROM notifications n
        WHERE {where}
        ORDER BY n.created_at DESC
        LIMIT ${idx} OFFSET ${idx + 1}
        """,
        *params,
    )
    return {
        "data": [dict(r) for r in rows],
        "total": total,
        "unread_count": unread_count,
    }


@router.put("/{notification_id}/read")
async def mark_read(
    notification_id: str,
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    row = await conn.fetchrow(
        """
        UPDATE notifications
        SET is_read = true, read_at = NOW()
        WHERE id = $1 AND recipient_id = $2::uuid
        RETURNING id, is_read
        """,
        notification_id,
        token_data.user_id,
    )
    if not row:
        raise HTTPException(
            status_code=404, detail="Thông báo không tồn tại hoặc không thuộc về bạn"
        )
    return {"data": dict(row), "message": "Đã đánh dấu đã đọc"}


@router.put("/read-all")
async def mark_all_read(
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    result = await conn.execute(
        """
        UPDATE notifications
        SET is_read = true, read_at = NOW()
        WHERE recipient_id = $1::uuid AND is_read = false
        """,
        token_data.user_id,
    )
    # result is like "UPDATE N"
    count = int(result.split()[-1]) if result else 0
    return {"data": {"updated": count}, "message": f"Đã đánh dấu {count} thông báo đã đọc"}
