"""
Retry Queue API (M20) — Manage failed background jobs for Song Châu ERP.

Endpoints:
  GET  /          — List retry queue items with filters and pagination
  POST /{id}/retry  — Manually retry a failed job
  POST /{id}/cancel — Permanently cancel a job
  GET  /summary   — Count by status and job_type
  POST /cleanup   — Delete completed items older than 30 days
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
# GET / — List retry queue items
# ---------------------------------------------------------------------------

@router.get("")
async def list_retry_queue(
    status: Optional[str] = Query(
        None,
        description="pending | retrying | completed | failed_permanently",
    ),
    job_type: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    token_data: TokenData = Depends(require_role("admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """List retry queue items with optional filters and pagination."""
    conditions = ["1=1"]
    params: list = []
    idx = 1

    if status:
        conditions.append(f"status = ${idx}")
        params.append(status)
        idx += 1

    if job_type:
        conditions.append(f"job_type = ${idx}")
        params.append(job_type)
        idx += 1

    where = " AND ".join(conditions)

    total = await conn.fetchval(
        f"SELECT COUNT(*) FROM retry_queue WHERE {where}", *params
    )

    offset = (page - 1) * limit
    rows = await conn.fetch(
        f"""
        SELECT
            id, job_type, status, attempts, max_attempts,
            last_error, next_retry_at, completed_at, created_at,
            job_data
        FROM retry_queue
        WHERE {where}
        ORDER BY
            CASE status
                WHEN 'retrying' THEN 1
                WHEN 'pending' THEN 2
                WHEN 'failed_permanently' THEN 3
                ELSE 4
            END,
            created_at DESC
        LIMIT ${idx} OFFSET ${idx + 1}
        """,
        *params,
        limit,
        offset,
    )

    return {
        "data": {
            "items": [
                {
                    "id": r["id"],
                    "job_type": r["job_type"],
                    "status": r["status"],
                    "attempts": r["attempts"],
                    "max_attempts": r["max_attempts"],
                    "last_error": r["last_error"],
                    "next_retry_at": r["next_retry_at"].isoformat() if r["next_retry_at"] else None,
                    "completed_at": r["completed_at"].isoformat() if r["completed_at"] else None,
                    "created_at": r["created_at"].isoformat(),
                    "job_data": r["job_data"],
                }
                for r in rows
            ],
            "total": total,
            "page": page,
            "limit": limit,
        },
        "message": f"Hàng đợi thử lại ({total} công việc)",
    }


# ---------------------------------------------------------------------------
# POST /{id}/retry — Manually retry a failed job
# ---------------------------------------------------------------------------

@router.post("/{job_id}/retry")
async def retry_job(
    job_id: int,
    token_data: TokenData = Depends(require_role("admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """
    Reset a failed job back to 'pending' so the worker picks it up again.
    Clears last_error and sets next_retry_at to NOW().
    """
    row = await conn.fetchrow(
        "SELECT id, status, job_type, attempts, max_attempts FROM retry_queue WHERE id = $1",
        job_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Công việc không tìm thấy")

    if row["status"] == "completed":
        raise HTTPException(
            status_code=400,
            detail="Công việc đã hoàn thành, không cần thử lại",
        )
    if row["status"] in ("pending", "retrying"):
        raise HTTPException(
            status_code=400,
            detail=f"Công việc đang ở trạng thái '{row['status']}', không cần thử lại",
        )

    await conn.execute(
        """
        UPDATE retry_queue
        SET status = 'pending',
            attempts = 0,
            last_error = NULL,
            next_retry_at = NOW(),
            completed_at = NULL
        WHERE id = $1
        """,
        job_id,
    )

    logger.info(
        "Job manually retried: id=%s type=%s by user=%s",
        job_id,
        row["job_type"],
        token_data.user_id,
    )

    return {
        "data": {"id": job_id, "status": "pending", "attempts": 0},
        "message": f"Công việc #{job_id} đã được đặt lại để thử lại",
    }


# ---------------------------------------------------------------------------
# POST /{id}/cancel — Permanently cancel a job
# ---------------------------------------------------------------------------

@router.post("/{job_id}/cancel")
async def cancel_job(
    job_id: int,
    token_data: TokenData = Depends(require_role("admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Mark a job as failed_permanently, preventing further retry attempts."""
    row = await conn.fetchrow(
        "SELECT id, status, job_type FROM retry_queue WHERE id = $1", job_id
    )
    if not row:
        raise HTTPException(status_code=404, detail="Công việc không tìm thấy")

    if row["status"] == "completed":
        raise HTTPException(
            status_code=400,
            detail="Không thể huỷ công việc đã hoàn thành",
        )
    if row["status"] == "failed_permanently":
        raise HTTPException(
            status_code=400,
            detail="Công việc đã bị huỷ vĩnh viễn",
        )

    await conn.execute(
        """
        UPDATE retry_queue
        SET status = 'failed_permanently',
            last_error = COALESCE(last_error, 'Huỷ thủ công bởi admin')
        WHERE id = $1
        """,
        job_id,
    )

    logger.info(
        "Job cancelled permanently: id=%s type=%s by user=%s",
        job_id,
        row["job_type"],
        token_data.user_id,
    )

    return {
        "data": {"id": job_id, "status": "failed_permanently"},
        "message": f"Công việc #{job_id} đã bị huỷ vĩnh viễn",
    }


# ---------------------------------------------------------------------------
# GET /summary — Count by status and job_type
# ---------------------------------------------------------------------------

@router.get("/summary")
async def retry_queue_summary(
    token_data: TokenData = Depends(require_role("admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Return counts grouped by status and job_type."""
    by_status = await conn.fetch(
        """
        SELECT status, COUNT(*) AS count
        FROM retry_queue
        GROUP BY status
        ORDER BY
            CASE status
                WHEN 'retrying' THEN 1
                WHEN 'pending' THEN 2
                WHEN 'failed_permanently' THEN 3
                ELSE 4
            END
        """
    )

    by_job_type = await conn.fetch(
        """
        SELECT job_type, status, COUNT(*) AS count
        FROM retry_queue
        GROUP BY job_type, status
        ORDER BY job_type, status
        """
    )

    # Aggregate by_job_type into nested structure
    job_type_map: dict = {}
    for r in by_job_type:
        jt = r["job_type"]
        if jt not in job_type_map:
            job_type_map[jt] = {"job_type": jt, "total": 0, "by_status": {}}
        job_type_map[jt]["by_status"][r["status"]] = r["count"]
        job_type_map[jt]["total"] += r["count"]

    return {
        "data": {
            "by_status": [dict(r) for r in by_status],
            "by_job_type": list(job_type_map.values()),
        },
        "message": "Tóm tắt hàng đợi thử lại",
    }


# ---------------------------------------------------------------------------
# POST /cleanup — Delete completed items older than 30 days
# ---------------------------------------------------------------------------

@router.post("/cleanup")
async def cleanup_retry_queue(
    days: int = Query(30, ge=1, le=365, description="Xoá bản ghi hoàn thành cũ hơn N ngày"),
    token_data: TokenData = Depends(require_role("admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """
    Delete completed retry queue items older than the specified number of days.
    Only 'completed' records are removed; failed_permanently records are kept.
    """
    deleted = await conn.fetchval(
        """
        DELETE FROM retry_queue
        WHERE status = 'completed'
          AND completed_at < NOW() - ($1 || ' days')::INTERVAL
        RETURNING COUNT(*)
        """,
        str(days),
    )

    # fetchval on a DELETE RETURNING COUNT(*) returns the count directly
    # but asyncpg may return None if 0 rows; handle both cases
    deleted_count = int(deleted) if deleted is not None else 0

    logger.info(
        "Retry queue cleanup: deleted %d completed records older than %d days by user=%s",
        deleted_count,
        days,
        token_data.user_id,
    )

    return {
        "data": {"deleted_count": deleted_count, "older_than_days": days},
        "message": f"Đã xoá {deleted_count} công việc đã hoàn thành cũ hơn {days} ngày",
    }
