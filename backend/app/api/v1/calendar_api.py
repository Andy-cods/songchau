"""
Calendar & Leave API (M39) — Team Calendar and Employee Leave Management.

Endpoints:
  GET    /events                      — List calendar events (date range filter)
  POST   /events                      — Create calendar event
  PUT    /events/{id}                 — Update calendar event
  DELETE /events/{id}                 — Delete calendar event
  GET    /leaves                      — List leave requests (status filter)
  POST   /leaves                      — Create leave request
  POST   /leaves/{id}/approve         — Approve leave request (manager/admin)
  POST   /leaves/{id}/reject          — Reject leave request (manager/admin)
  GET    /leaves/balance/{user_id}    — Leave balance: annual 12 days − used
"""

from __future__ import annotations

import logging
from datetime import date, datetime
from typing import Literal, Optional
from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.core.database import get_db
from app.core.rbac import require_role
from app.core.security import TokenData

logger = logging.getLogger(__name__)
router = APIRouter()

ANNUAL_LEAVE_DAYS = 12  # baseline annual leave entitlement per year


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class CalendarEventCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=300)
    description: Optional[str] = None
    event_type: Literal["meeting", "deadline", "holiday", "leave", "delivery", "other"]
    start_time: datetime
    end_time: Optional[datetime] = None
    all_day: bool = False
    location: Optional[str] = None
    attendees: list[str] = Field(default_factory=list, description="List of user UUID strings")
    ref_type: Optional[str] = None
    ref_id: Optional[int] = None
    color: str = "#3b82f6"


class CalendarEventUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=300)
    description: Optional[str] = None
    event_type: Optional[Literal["meeting", "deadline", "holiday", "leave", "delivery", "other"]] = None
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    all_day: Optional[bool] = None
    location: Optional[str] = None
    attendees: Optional[list[str]] = None
    ref_type: Optional[str] = None
    ref_id: Optional[int] = None
    color: Optional[str] = None


class LeaveRequestCreate(BaseModel):
    leave_type: Literal["annual", "sick", "personal", "maternity", "other"]
    start_date: date
    end_date: date
    reason: Optional[str] = None

    def days_count(self) -> float:
        """Calculate working days count (calendar days inclusive)."""
        delta = (self.end_date - self.start_date).days + 1
        if delta <= 0:
            raise ValueError("end_date phải sau hoặc bằng start_date")
        return float(delta)


class LeaveApproveRequest(BaseModel):
    notes: Optional[str] = None


class LeaveRejectRequest(BaseModel):
    notes: str = Field(..., min_length=1, description="Lý do từ chối")


# ---------------------------------------------------------------------------
# Calendar Events
# ---------------------------------------------------------------------------

@router.get("/events")
async def list_events(
    start: Optional[datetime] = Query(None, description="Từ ngày (ISO 8601)"),
    end: Optional[datetime] = Query(None, description="Đến ngày (ISO 8601)"),
    event_type: Optional[str] = Query(None),
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Danh sách sự kiện lịch trong khoảng thời gian cho trước."""
    conditions: list[str] = []
    params: list = []
    idx = 1

    if start:
        conditions.append(f"start_time >= ${idx}")
        params.append(start)
        idx += 1
    if end:
        conditions.append(f"start_time <= ${idx}")
        params.append(end)
        idx += 1
    if event_type:
        conditions.append(f"event_type = ${idx}")
        params.append(event_type)
        idx += 1

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""

    rows = await conn.fetch(
        f"""
        SELECT
            e.id, e.title, e.description, e.event_type,
            e.start_time, e.end_time, e.all_day,
            e.location, e.attendees, e.ref_type, e.ref_id,
            e.color, e.created_by,
            u.full_name AS created_by_name,
            e.created_at, e.updated_at
        FROM calendar_events e
        LEFT JOIN users u ON u.id = e.created_by
        {where}
        ORDER BY e.start_time ASC
        """,
        *params,
    )

    return {
        "data": [dict(r) for r in rows],
        "message": "Lấy danh sách sự kiện thành công",
    }


@router.post("/events", status_code=201)
async def create_event(
    body: CalendarEventCreate,
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Tạo sự kiện lịch mới."""
    if body.end_time and body.end_time < body.start_time:
        raise HTTPException(status_code=400, detail="end_time phải sau start_time")

    attendees_array = body.attendees or []

    record = await conn.fetchrow(
        """
        INSERT INTO calendar_events (
            title, description, event_type, start_time, end_time,
            all_day, location, attendees, ref_type, ref_id,
            color, created_by
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        RETURNING id, title, event_type, start_time, end_time, all_day, color, created_at
        """,
        body.title,
        body.description,
        body.event_type,
        body.start_time,
        body.end_time,
        body.all_day,
        body.location,
        attendees_array,
        body.ref_type,
        body.ref_id,
        body.color,
        token_data.user_id,
    )

    return {
        "data": dict(record),
        "message": "Tạo sự kiện lịch thành công",
    }


@router.put("/events/{event_id}")
async def update_event(
    event_id: int,
    body: CalendarEventUpdate,
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Cập nhật sự kiện lịch. Chỉ người tạo hoặc admin được sửa."""
    existing = await conn.fetchrow(
        "SELECT id, created_by FROM calendar_events WHERE id = $1", event_id
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Không tìm thấy sự kiện")

    is_admin = "admin" in ([token_data.role] or [])
    is_owner = str(existing["created_by"]) == str(token_data.user_id)
    if not is_admin and not is_owner:
        raise HTTPException(status_code=403, detail="Bạn không có quyền sửa sự kiện này")

    # Build dynamic SET clause
    updates: list[str] = []
    params: list = []
    idx = 1

    field_map = {
        "title": body.title,
        "description": body.description,
        "event_type": body.event_type,
        "start_time": body.start_time,
        "end_time": body.end_time,
        "all_day": body.all_day,
        "location": body.location,
        "attendees": body.attendees,
        "ref_type": body.ref_type,
        "ref_id": body.ref_id,
        "color": body.color,
    }

    for col, val in field_map.items():
        if val is not None:
            updates.append(f"{col} = ${idx}")
            params.append(val)
            idx += 1

    if not updates:
        raise HTTPException(status_code=400, detail="Không có trường nào được cập nhật")

    updates.append(f"updated_at = NOW()")
    params.append(event_id)

    updated = await conn.fetchrow(
        f"""
        UPDATE calendar_events
        SET {', '.join(updates)}
        WHERE id = ${idx}
        RETURNING id, title, event_type, start_time, end_time, all_day, color, updated_at
        """,
        *params,
    )

    return {
        "data": dict(updated),
        "message": "Cập nhật sự kiện thành công",
    }


@router.delete("/events/{event_id}", status_code=200)
async def delete_event(
    event_id: int,
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Xóa sự kiện lịch. Chỉ người tạo hoặc admin được xóa."""
    existing = await conn.fetchrow(
        "SELECT id, created_by FROM calendar_events WHERE id = $1", event_id
    )
    if not existing:
        raise HTTPException(status_code=404, detail="Không tìm thấy sự kiện")

    is_admin = "admin" in ([token_data.role] or [])
    is_owner = str(existing["created_by"]) == str(token_data.user_id)
    if not is_admin and not is_owner:
        raise HTTPException(status_code=403, detail="Bạn không có quyền xóa sự kiện này")

    await conn.execute("DELETE FROM calendar_events WHERE id = $1", event_id)

    return {"data": {"id": event_id}, "message": "Xóa sự kiện thành công"}


# ---------------------------------------------------------------------------
# Leave Requests
# ---------------------------------------------------------------------------

@router.get("/leaves")
async def list_leaves(
    status: Optional[str] = Query(None, description="pending|approved|rejected|cancelled"),
    user_id: Optional[str] = Query(None, description="Filter theo nhân viên (UUID)"),
    year: Optional[int] = Query(None, ge=2020, le=2099),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Danh sách đơn xin nghỉ phép. Nhân viên chỉ thấy đơn của mình, manager/admin thấy tất cả."""
    offset = (page - 1) * page_size

    is_manager_or_admin = any(r in ([token_data.role] or []) for r in ["manager", "admin"])

    conditions: list[str] = []
    params: list = []
    idx = 1

    # Non-managers can only see their own leaves
    if not is_manager_or_admin:
        conditions.append(f"lr.user_id = ${idx}")
        params.append(token_data.user_id)
        idx += 1
    elif user_id:
        conditions.append(f"lr.user_id = ${idx}")
        params.append(user_id)
        idx += 1

    if status:
        valid = {"pending", "approved", "rejected", "cancelled"}
        if status not in valid:
            raise HTTPException(status_code=400, detail=f"status không hợp lệ: {status}")
        conditions.append(f"lr.status = ${idx}")
        params.append(status)
        idx += 1

    if year:
        conditions.append(f"EXTRACT(YEAR FROM lr.start_date) = ${idx}")
        params.append(year)
        idx += 1

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""

    count_row = await conn.fetchrow(
        f"SELECT COUNT(*) AS total FROM leave_requests lr {where}", *params
    )
    total = count_row["total"]

    rows = await conn.fetch(
        f"""
        SELECT
            lr.id, lr.user_id, lr.leave_type,
            lr.start_date, lr.end_date, lr.days_count,
            lr.reason, lr.status,
            lr.approved_by, lr.approved_at, lr.notes,
            lr.created_at,
            u.full_name AS user_name,
            a.full_name AS approved_by_name
        FROM leave_requests lr
        LEFT JOIN users u ON u.id = lr.user_id
        LEFT JOIN users a ON a.id = lr.approved_by
        {where}
        ORDER BY lr.created_at DESC
        LIMIT ${idx} OFFSET ${idx + 1}
        """,
        *(params + [page_size, offset]),
    )

    return {
        "data": {
            "items": [dict(r) for r in rows],
            "total": total,
            "page": page,
            "page_size": page_size,
            "pages": (total + page_size - 1) // page_size,
        },
        "message": "Lấy danh sách đơn nghỉ phép thành công",
    }


@router.post("/leaves", status_code=201)
async def create_leave(
    body: LeaveRequestCreate,
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Tạo đơn xin nghỉ phép."""
    if body.end_date < body.start_date:
        raise HTTPException(status_code=400, detail="end_date phải sau hoặc bằng start_date")

    days = body.days_count()

    # Check for overlapping approved/pending leave
    overlap = await conn.fetchval(
        """
        SELECT id FROM leave_requests
        WHERE user_id = $1
          AND status IN ('pending','approved')
          AND start_date <= $2
          AND end_date >= $3
        LIMIT 1
        """,
        token_data.user_id,
        body.end_date,
        body.start_date,
    )
    if overlap:
        raise HTTPException(
            status_code=409,
            detail="Đã có đơn nghỉ phép trong khoảng thời gian này",
        )

    record = await conn.fetchrow(
        """
        INSERT INTO leave_requests (
            user_id, leave_type, start_date, end_date,
            days_count, reason, status
        )
        VALUES ($1,$2,$3,$4,$5,$6,'pending')
        RETURNING id, leave_type, start_date, end_date, days_count, status, created_at
        """,
        token_data.user_id,
        body.leave_type,
        body.start_date,
        body.end_date,
        days,
        body.reason,
    )

    return {
        "data": dict(record),
        "message": "Tạo đơn nghỉ phép thành công, đang chờ duyệt",
    }


@router.post("/leaves/{leave_id}/approve")
async def approve_leave(
    leave_id: int,
    body: LeaveApproveRequest,
    token_data: TokenData = Depends(require_role("manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Duyệt đơn nghỉ phép (manager/admin)."""
    leave = await conn.fetchrow(
        "SELECT id, status, user_id, leave_type, days_count FROM leave_requests WHERE id = $1",
        leave_id,
    )
    if not leave:
        raise HTTPException(status_code=404, detail="Không tìm thấy đơn nghỉ phép")
    if leave["status"] != "pending":
        raise HTTPException(
            status_code=409,
            detail=f"Không thể duyệt đơn ở trạng thái '{leave['status']}'",
        )

    updated = await conn.fetchrow(
        """
        UPDATE leave_requests
        SET status = 'approved', approved_by = $1, approved_at = NOW(), notes = $2
        WHERE id = $3
        RETURNING id, status, approved_at, notes
        """,
        token_data.user_id,
        body.notes,
        leave_id,
    )

    return {
        "data": dict(updated),
        "message": "Đã duyệt đơn nghỉ phép thành công",
    }


@router.post("/leaves/{leave_id}/reject")
async def reject_leave(
    leave_id: int,
    body: LeaveRejectRequest,
    token_data: TokenData = Depends(require_role("manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Từ chối đơn nghỉ phép (manager/admin)."""
    leave = await conn.fetchrow(
        "SELECT id, status FROM leave_requests WHERE id = $1", leave_id
    )
    if not leave:
        raise HTTPException(status_code=404, detail="Không tìm thấy đơn nghỉ phép")
    if leave["status"] != "pending":
        raise HTTPException(
            status_code=409,
            detail=f"Không thể từ chối đơn ở trạng thái '{leave['status']}'",
        )

    updated = await conn.fetchrow(
        """
        UPDATE leave_requests
        SET status = 'rejected', approved_by = $1, approved_at = NOW(), notes = $2
        WHERE id = $3
        RETURNING id, status, approved_at, notes
        """,
        token_data.user_id,
        body.notes,
        leave_id,
    )

    return {
        "data": dict(updated),
        "message": "Đã từ chối đơn nghỉ phép",
    }


@router.get("/leaves/balance/{user_id}")
async def leave_balance(
    user_id: str,
    year: Optional[int] = Query(None, description="Năm cần kiểm tra (mặc định năm hiện tại)"),
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """
    Số ngày nghỉ phép còn lại.
    Annual: 12 ngày/năm − số ngày đã dùng (approved).
    """
    # Only allow staff to view their own balance; managers/admins can view anyone
    is_manager_or_admin = any(r in ([token_data.role] or []) for r in ["manager", "admin"])
    if not is_manager_or_admin and str(token_data.user_id) != user_id:
        raise HTTPException(status_code=403, detail="Bạn không có quyền xem số dư phép của người khác")

    # Verify user exists
    user = await conn.fetchrow(
        "SELECT id, full_name FROM users WHERE id = $1", user_id
    )
    if not user:
        raise HTTPException(status_code=404, detail="Không tìm thấy người dùng")

    check_year = year or date.today().year

    # Sum approved leave days by type for the given year
    rows = await conn.fetch(
        """
        SELECT leave_type, SUM(days_count) AS used_days
        FROM leave_requests
        WHERE user_id = $1
          AND status = 'approved'
          AND EXTRACT(YEAR FROM start_date) = $2
        GROUP BY leave_type
        """,
        user_id,
        check_year,
    )

    used_map: dict[str, float] = {r["leave_type"]: float(r["used_days"]) for r in rows}
    annual_used = used_map.get("annual", 0.0)
    annual_remaining = max(0.0, ANNUAL_LEAVE_DAYS - annual_used)

    return {
        "data": {
            "user_id": user_id,
            "user_name": user["full_name"],
            "year": check_year,
            "annual_entitlement": ANNUAL_LEAVE_DAYS,
            "annual_used": annual_used,
            "annual_remaining": annual_remaining,
            "used_by_type": used_map,
        },
        "message": "Lấy số dư nghỉ phép thành công",
    }
