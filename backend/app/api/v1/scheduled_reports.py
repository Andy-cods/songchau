"""
M08: Scheduled Reports API.

CRUD for report schedules + manual trigger + execution history.
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.core.database import get_db
from app.core.rbac import require_role, TokenData

router = APIRouter()


# ─── Models ───────────────────────────────────────────────────

class ScheduleCreate(BaseModel):
    report_type: str  # daily_kpi, weekly_summary, monthly_revenue, custom
    report_name: str
    schedule_cron: str  # e.g. "0 7 * * *" (daily 7am)
    recipients: list[str]  # user IDs
    email_subject: str | None = None
    parameters: dict[str, Any] = {}
    is_active: bool = True


class ScheduleUpdate(BaseModel):
    report_name: str | None = None
    schedule_cron: str | None = None
    recipients: list[str] | None = None
    email_subject: str | None = None
    parameters: dict[str, Any] | None = None
    is_active: bool | None = None


# ─── CRUD ─────────────────────────────────────────────────────

@router.get("")
async def list_schedules(
    token_data: TokenData = Depends(require_role("admin", "manager", "director")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """List all scheduled reports."""
    rows = await conn.fetch(
        """
        SELECT sr.*,
               u.full_name as created_by_name,
               (SELECT COUNT(*) FROM report_executions re WHERE re.schedule_id = sr.id) as execution_count,
               (SELECT status FROM report_executions re WHERE re.schedule_id = sr.id ORDER BY created_at DESC LIMIT 1) as last_status
        FROM scheduled_reports sr
        LEFT JOIN users u ON u.id = sr.created_by
        ORDER BY sr.is_active DESC, sr.created_at DESC
        """
    )
    return {"data": [dict(r) for r in rows]}


@router.post("")
async def create_schedule(
    body: ScheduleCreate,
    token_data: TokenData = Depends(require_role("admin", "manager")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Create a new report schedule."""
    # Validate cron expression (basic check)
    parts = body.schedule_cron.strip().split()
    if len(parts) != 5:
        raise HTTPException(400, "Cron expression phải có 5 phần (minute hour day month weekday)")

    row = await conn.fetchrow(
        """
        INSERT INTO scheduled_reports
            (report_type, report_name, schedule_cron, recipients, email_subject, parameters, is_active, created_by)
        VALUES ($1, $2, $3, $4::uuid[], $5, $6::jsonb, $7, $8::uuid)
        RETURNING *
        """,
        body.report_type,
        body.report_name,
        body.schedule_cron,
        body.recipients,
        body.email_subject or f"[Song Châu ERP] {body.report_name}",
        json.dumps(body.parameters, default=str),
        body.is_active,
        token_data.user_id,
    )
    return {"data": dict(row), "message": f"Lịch báo cáo '{body.report_name}' đã được tạo"}


@router.put("/{schedule_id}")
async def update_schedule(
    schedule_id: int,
    body: ScheduleUpdate,
    token_data: TokenData = Depends(require_role("admin", "manager")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Update a report schedule."""
    existing = await conn.fetchrow("SELECT * FROM scheduled_reports WHERE id = $1", schedule_id)
    if not existing:
        raise HTTPException(404, "Lịch báo cáo không tồn tại")

    updates: list[str] = []
    params: list[Any] = []
    idx = 1

    for field, value in body.model_dump(exclude_none=True).items():
        if field == "recipients":
            updates.append(f"recipients = ${idx}::uuid[]")
            params.append(value)
        elif field == "parameters":
            updates.append(f"parameters = ${idx}::jsonb")
            params.append(json.dumps(value, default=str))
        else:
            updates.append(f"{field} = ${idx}")
            params.append(value)
        idx += 1

    if not updates:
        return {"data": dict(existing), "message": "Không có thay đổi"}

    updates.append(f"updated_at = NOW()")
    params.append(schedule_id)

    row = await conn.fetchrow(
        f"UPDATE scheduled_reports SET {', '.join(updates)} WHERE id = ${idx} RETURNING *",
        *params,
    )
    return {"data": dict(row), "message": "Đã cập nhật lịch báo cáo"}


@router.delete("/{schedule_id}")
async def delete_schedule(
    schedule_id: int,
    token_data: TokenData = Depends(require_role("admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Delete a report schedule."""
    deleted = await conn.fetchval(
        "DELETE FROM scheduled_reports WHERE id = $1 RETURNING id", schedule_id
    )
    if not deleted:
        raise HTTPException(404, "Lịch báo cáo không tồn tại")
    return {"message": "Đã xóa lịch báo cáo"}


# ─── Manual Trigger ───────────────────────────────────────────

@router.post("/{schedule_id}/trigger")
async def trigger_report(
    schedule_id: int,
    token_data: TokenData = Depends(require_role("admin", "manager")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Manually trigger a scheduled report."""
    schedule = await conn.fetchrow("SELECT * FROM scheduled_reports WHERE id = $1", schedule_id)
    if not schedule:
        raise HTTPException(404, "Lịch báo cáo không tồn tại")

    # Create execution record
    exec_row = await conn.fetchrow(
        """
        INSERT INTO report_executions (schedule_id, report_type, status, started_at)
        VALUES ($1, $2, 'running', NOW())
        RETURNING *
        """,
        schedule_id, schedule["report_type"],
    )

    # Run report generation
    from app.services.report_scheduler import generate_report

    try:
        result = await generate_report(conn, dict(schedule))

        await conn.execute(
            """
            UPDATE report_executions
            SET status = 'completed', completed_at = NOW(), file_path = $2
            WHERE id = $1
            """,
            exec_row["id"], result.get("file_path"),
        )

        await conn.execute(
            "UPDATE scheduled_reports SET last_run_at = NOW() WHERE id = $1",
            schedule_id,
        )

        return {
            "data": {"execution_id": exec_row["id"], "status": "completed", "file_path": result.get("file_path")},
            "message": "Báo cáo đã được tạo thành công",
        }

    except Exception as exc:
        await conn.execute(
            "UPDATE report_executions SET status = 'failed', completed_at = NOW(), error_message = $2 WHERE id = $1",
            exec_row["id"], str(exc),
        )
        raise HTTPException(500, f"Lỗi tạo báo cáo: {exc}")


# ─── Execution History ───────────────────────────────────────

@router.get("/{schedule_id}/executions")
async def list_executions(
    schedule_id: int,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    token_data: TokenData = Depends(require_role("admin", "manager", "director")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """List execution history for a scheduled report."""
    offset = (page - 1) * limit
    total = await conn.fetchval(
        "SELECT COUNT(*) FROM report_executions WHERE schedule_id = $1", schedule_id
    )
    rows = await conn.fetch(
        """
        SELECT * FROM report_executions
        WHERE schedule_id = $1
        ORDER BY created_at DESC
        LIMIT $2 OFFSET $3
        """,
        schedule_id, limit, offset,
    )
    return {
        "data": {
            "items": [dict(r) for r in rows],
            "total": total,
            "page": page,
            "limit": limit,
        }
    }
