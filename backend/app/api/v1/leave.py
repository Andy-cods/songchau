"""
M41 — Leave Management API.

Plan: plans/employee-productivity/PLAN.md §4.3, §4.4, §4.5, §5.4.

Workflow
--------
pending → approved | rejected | cancelled

- Requester: any authenticated user.
- Approver: manager in the same `users.department` as the requester (verified
  inside the handler — RBAC alone cannot compare departments). Admin can
  approve any.
- Manager cannot approve their OWN request — admin must.
- Cancel: requester while status='pending'; admin always.
- Approve runs in a transaction with `SELECT … FOR UPDATE` on `leave_balance`.

Endpoints
---------
POST   /                        Create request (status=pending).
GET    /                        List with RBAC-aware filters.
GET    /{id}                    Get one.
PATCH  /{id}                    Edit reason / dates while pending (requester).
DELETE /{id}                    Cancel while pending (requester).
POST   /{id}/approve            Manager same-dept (or admin).
POST   /{id}/reject             Manager same-dept (or admin).
GET    /balance/{user_id}       Annual balance + remaining.
GET    /policy                  Read merged policy applying to caller.
PUT    /policy                  Admin-only: upsert a policy row.
"""

from __future__ import annotations

import json
import logging
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Any, Literal, Optional

import asyncpg
from fastapi import APIRouter, Body, Depends, HTTPException, Path, Query
from pydantic import BaseModel, Field, field_validator

from app.core.database import get_db
from app.core.rbac import require_role
from app.core.security import TokenData

logger = logging.getLogger(__name__)
router = APIRouter()


LEAVE_TYPES = ("annual", "sick", "personal", "maternity", "other")
USED_COL = {
    "annual":    "annual_used",
    "sick":      "sick_used",
    "personal":  "personal_used",
    "maternity": "maternity_used",
    "other":     "other_used",
}
TOTAL_COL = {
    "annual":    "annual_total",
    "sick":      "sick_total",
    "personal":  "personal_total",
    "maternity": "maternity_total",
    "other":     None,  # 'other' has no quota; uncapped
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _user_dept(conn: asyncpg.Connection, user_id: str) -> Optional[str]:
    return await conn.fetchval(
        "SELECT department FROM users WHERE id = $1::uuid AND deleted_at IS NULL",
        user_id,
    )


def _business_days(
    start: date,
    end: date,
    half_day_start: bool,
    half_day_end: bool,
) -> float:
    """Mon–Fri count between start and end (inclusive), minus 0.5 for each
    half-day flag if it lands on a workday."""
    if start > end:
        raise ValueError("start_date must be <= end_date")
    days = 0
    cur = start
    while cur <= end:
        if cur.isoweekday() < 6:
            days += 1
        cur += timedelta(days=1)
    if days == 0:
        return 0.0
    if half_day_start and start.isoweekday() < 6:
        days -= 0.5
    if half_day_end and end.isoweekday() < 6 and start != end:
        days -= 0.5
    elif half_day_end and start == end and not half_day_start:
        # Single-day, half-day-end only → 0.5 day
        days -= 0.5
    return float(days)


async def _ensure_balance_row(conn: asyncpg.Connection, user_id: str, year: int) -> None:
    """Create a balance row for (user, year) if missing, snapshotting the
    user's current policy totals."""
    pol = await conn.fetchrow("SELECT * FROM get_leave_policy($1::uuid)", user_id)
    if pol is None:
        # Fall back to global default
        pol = await conn.fetchrow(
            "SELECT * FROM leave_policy WHERE role IS NULL AND department IS NULL "
            "AND is_active = true LIMIT 1"
        )
    # get_leave_policy() có thể trả row TOÀN NULL (không phải zero rows) khi user
    # chưa có policy riêng → guard TỪNG field, không chỉ `if pol` (nếu không float(None) → 500).
    def _pv(key: str, default: float) -> Decimal:
        # leave_balance totals là numeric(4,1) → asyncpg cần Decimal (float bị từ
        # chối: "a Decimal is required, got float"). Guard từng field (get_leave_policy
        # có thể trả row toàn NULL).
        v = pol[key] if pol is not None else None
        return Decimal(str(v)) if v is not None else Decimal(str(default))
    annual_total    = _pv("annual_days", 12.0)
    sick_total      = _pv("sick_days", 30.0)
    personal_total  = _pv("personal_days", 3.0)
    maternity_total = _pv("maternity_days", 180.0)

    await conn.execute(
        """
        INSERT INTO leave_balance
            (user_id, period_year,
             annual_total, sick_total, personal_total, maternity_total)
        VALUES ($1::uuid, $2, $3, $4, $5, $6)
        ON CONFLICT (user_id, period_year) DO NOTHING
        """,
        user_id, year, annual_total, sick_total, personal_total, maternity_total,
    )


async def _notify_managers_of_dept(
    conn: asyncpg.Connection,
    department: Optional[str],
    notif_type: str,
    title: str,
    body: str,
    link: str,
) -> int:
    """Create one notification per manager in `department`. Returns count."""
    if not department:
        return 0
    rows = await conn.fetch(
        """
        SELECT id FROM users
        WHERE role = 'manager'
          AND department = $1
          AND is_active = true
          AND deleted_at IS NULL
        """,
        department,
    )
    n = 0
    for r in rows:
        await conn.execute(
            """
            INSERT INTO notifications (recipient_id, type, title, body, ref_type, metadata)
            VALUES ($1::uuid, $2::notification_type, $3, $4, 'leave', $5::jsonb)
            """,
            str(r["id"]), notif_type, title, body, json.dumps({"link": link}),
        )
        n += 1
    return n


async def _notify_user(
    conn: asyncpg.Connection,
    user_id: str,
    notif_type: str,
    title: str,
    body: str,
    link: str,
) -> None:
    await conn.execute(
        """
        INSERT INTO notifications (recipient_id, type, title, body, ref_type, metadata)
        VALUES ($1::uuid, $2::notification_type, $3, $4, 'leave', $5::jsonb)
        """,
        user_id, notif_type, title, body, json.dumps({"link": link}),
    )


# ---------------------------------------------------------------------------
# Pydantic
# ---------------------------------------------------------------------------

class LeaveCreate(BaseModel):
    leave_type: Literal["annual", "sick", "personal", "maternity", "other"]
    start_date: date
    end_date: date
    half_day_start: bool = False
    half_day_end: bool = False
    reason: Optional[str] = None

    @field_validator("end_date")
    @classmethod
    def _dates_ok(cls, v: date, info):
        s = info.data.get("start_date")
        if s and v < s:
            raise ValueError("end_date phải >= start_date")
        return v


class LeavePatch(BaseModel):
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    half_day_start: Optional[bool] = None
    half_day_end: Optional[bool] = None
    leave_type: Optional[Literal["annual", "sick", "personal", "maternity", "other"]] = None
    reason: Optional[str] = None


class DecisionBody(BaseModel):
    decision_note: Optional[str] = None


class PolicyUpsert(BaseModel):
    role: Optional[Literal["admin", "manager", "procurement", "warehouse", "staff", "accountant"]] = None
    department: Optional[str] = None
    annual_days: float = Field(12, ge=0, le=365)
    sick_days: float = Field(30, ge=0, le=365)
    personal_days: float = Field(3, ge=0, le=365)
    maternity_days: float = Field(180, ge=0, le=365)
    carry_over_max_days: float = Field(0, ge=0, le=365)
    notes: Optional[str] = None
    is_active: bool = True


# ---------------------------------------------------------------------------
# POST /  — create request
# ---------------------------------------------------------------------------

@router.post("", status_code=201)
async def create_leave_request(
    body: LeaveCreate,
    token_data: TokenData = Depends(require_role("staff", "manager", "admin", "accountant", "procurement", "warehouse")),
    conn: asyncpg.Connection = Depends(get_db),
) -> dict[str, Any]:
    days = _business_days(body.start_date, body.end_date, body.half_day_start, body.half_day_end)
    if days <= 0:
        raise HTTPException(
            status_code=400,
            detail="Khoảng thời gian không có ngày làm việc nào (chỉ rơi vào cuối tuần?).",
        )

    dept = await _user_dept(conn, token_data.user_id)
    year = body.start_date.year
    await _ensure_balance_row(conn, token_data.user_id, year)

    # Optional: warn if balance would overflow (do NOT block here — overflow
    # is enforced at approve-time).
    row = await conn.fetchrow(
        """
        INSERT INTO leave_requests
            (user_id, department, leave_type, start_date, end_date,
             days_count, reason, status,
             half_day_start, half_day_end)
        VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, 'pending', $8, $9)
        RETURNING id, created_at
        """,
        token_data.user_id, dept, body.leave_type,
        body.start_date, body.end_date, Decimal(str(days)), body.reason,
        body.half_day_start, body.half_day_end,
    )

    # Notify managers of the same department.
    full_name = await conn.fetchval(
        "SELECT full_name FROM users WHERE id = $1::uuid", token_data.user_id
    ) or "(không rõ)"
    await _notify_managers_of_dept(
        conn,
        department=dept,
        notif_type="leave_request",
        title=f"Đơn xin nghỉ phép từ {full_name}",
        body=f"{full_name} xin nghỉ {days} ngày ({body.start_date} → {body.end_date}).",
        link=f"/hr/leave/{row['id']}",
    )

    return {
        "data": {"id": row["id"], "days_count": days, "status": "pending"},
        "message": "Đã gửi đơn xin nghỉ phép, chờ quản lý duyệt.",
    }


# ---------------------------------------------------------------------------
# GET /  — list
# ---------------------------------------------------------------------------

@router.get("")
async def list_leave_requests(
    user_id: Optional[str] = Query(None),
    department: Optional[str] = Query(None),
    status: Optional[Literal["pending", "approved", "rejected", "cancelled"]] = Query(None),
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    token_data: TokenData = Depends(require_role("staff", "manager", "admin", "accountant", "procurement", "warehouse")),
    conn: asyncpg.Connection = Depends(get_db),
) -> dict[str, Any]:
    """RBAC-aware list:
       - staff/accountant/procurement/warehouse: own requests only
       - manager: own + own department
       - admin: any
    """
    actor_dept = await _user_dept(conn, token_data.user_id)

    conds = ["1=1"]
    params: list[Any] = []
    idx = 1

    if token_data.role == "admin":
        if user_id:
            conds.append(f"lr.user_id = ${idx}::uuid"); params.append(user_id); idx += 1
        if department:
            conds.append(f"lr.department = ${idx}");    params.append(department); idx += 1
    elif token_data.role == "manager":
        if user_id and user_id != token_data.user_id:
            target_dept = await _user_dept(conn, user_id)
            if target_dept != actor_dept:
                raise HTTPException(403, "Manager chỉ xem nhân viên cùng phòng.")
            conds.append(f"lr.user_id = ${idx}::uuid"); params.append(user_id); idx += 1
        else:
            conds.append(f"(lr.user_id = ${idx}::uuid OR lr.department = ${idx+1})")
            params.extend([token_data.user_id, actor_dept])
            idx += 2
    else:
        # staff & similar: own only
        conds.append(f"lr.user_id = ${idx}::uuid"); params.append(token_data.user_id); idx += 1

    if status:
        conds.append(f"lr.status = ${idx}"); params.append(status); idx += 1
    if date_from:
        conds.append(f"lr.end_date >= ${idx}"); params.append(date_from); idx += 1
    if date_to:
        conds.append(f"lr.start_date <= ${idx}"); params.append(date_to); idx += 1

    where = " AND ".join(conds)
    offset = (page - 1) * limit

    total = await conn.fetchval(
        f"SELECT COUNT(*) FROM leave_requests lr WHERE {where}", *params
    )
    params.extend([limit, offset])
    rows = await conn.fetch(
        f"""
        SELECT lr.*, u.full_name AS user_name, u.email AS user_email
        FROM leave_requests lr
        JOIN users u ON u.id = lr.user_id
        WHERE {where}
        ORDER BY lr.created_at DESC
        LIMIT ${idx} OFFSET ${idx+1}
        """,
        *params,
    )

    return {
        "data": {
            "items": [
                {
                    **{k: (str(v) if isinstance(v, (datetime, date)) else v) for k, v in dict(r).items()},
                    "days_count": float(r["days_count"]),
                }
                for r in rows
            ],
            "total": int(total or 0),
            "page": page,
            "limit": limit,
        }
    }


# ---------------------------------------------------------------------------
# GET /{id}
# ---------------------------------------------------------------------------

async def _get_leave_or_403(
    conn: asyncpg.Connection,
    token_data: TokenData,
    leave_id: int,
) -> asyncpg.Record:
    row = await conn.fetchrow(
        """
        SELECT lr.*, u.full_name AS user_name, u.email AS user_email
        FROM leave_requests lr
        JOIN users u ON u.id = lr.user_id
        WHERE lr.id = $1
        """,
        leave_id,
    )
    if not row:
        raise HTTPException(404, "Không tìm thấy đơn xin nghỉ.")

    if token_data.role == "admin":
        return row
    if str(row["user_id"]) == token_data.user_id:
        return row
    if token_data.role == "manager":
        actor_dept = await _user_dept(conn, token_data.user_id)
        if row["department"] == actor_dept:
            return row
    raise HTTPException(403, "Bạn không có quyền xem đơn này.")


@router.get("/{leave_id:int}")
async def get_leave_request(
    leave_id: int = Path(..., ge=1),
    token_data: TokenData = Depends(require_role("staff", "manager", "admin", "accountant", "procurement", "warehouse")),
    conn: asyncpg.Connection = Depends(get_db),
) -> dict[str, Any]:
    row = await _get_leave_or_403(conn, token_data, leave_id)
    d = {k: (str(v) if isinstance(v, (datetime, date)) else v) for k, v in dict(row).items()}
    d["days_count"] = float(row["days_count"])
    return {"data": d}


# ---------------------------------------------------------------------------
# PATCH /{id} — edit while pending (requester)
# ---------------------------------------------------------------------------

@router.patch("/{leave_id:int}")
async def patch_leave_request(
    leave_id: int,
    body: LeavePatch,
    token_data: TokenData = Depends(require_role("staff", "manager", "admin", "accountant", "procurement", "warehouse")),
    conn: asyncpg.Connection = Depends(get_db),
) -> dict[str, Any]:
    row = await _get_leave_or_403(conn, token_data, leave_id)
    if row["status"] != "pending":
        raise HTTPException(409, "Chỉ chỉnh sửa được đơn ở trạng thái 'pending'.")
    if str(row["user_id"]) != token_data.user_id and token_data.role != "admin":
        raise HTTPException(403, "Chỉ người tạo đơn hoặc admin mới được sửa.")

    new_start = body.start_date or row["start_date"]
    new_end   = body.end_date   or row["end_date"]
    new_hds   = body.half_day_start if body.half_day_start is not None else row["half_day_start"]
    new_hde   = body.half_day_end   if body.half_day_end   is not None else row["half_day_end"]
    new_type  = body.leave_type or row["leave_type"]
    new_days  = _business_days(new_start, new_end, new_hds, new_hde)
    if new_days <= 0:
        raise HTTPException(400, "Khoảng ngày không có ngày làm việc.")

    await conn.execute(
        """
        UPDATE leave_requests
        SET start_date     = $1,
            end_date       = $2,
            half_day_start = $3,
            half_day_end   = $4,
            leave_type     = $5,
            days_count     = $6,
            reason         = COALESCE($7, reason)
        WHERE id = $8
        """,
        new_start, new_end, new_hds, new_hde, new_type, Decimal(str(new_days)), body.reason, leave_id,
    )
    return {"data": {"id": leave_id, "days_count": new_days}, "message": "Đã cập nhật đơn."}


# ---------------------------------------------------------------------------
# DELETE /{id} — cancel
# ---------------------------------------------------------------------------

@router.delete("/{leave_id:int}", status_code=200)
async def cancel_leave_request(
    leave_id: int,
    token_data: TokenData = Depends(require_role("staff", "manager", "admin", "accountant", "procurement", "warehouse")),
    conn: asyncpg.Connection = Depends(get_db),
) -> dict[str, Any]:
    row = await _get_leave_or_403(conn, token_data, leave_id)
    is_owner = str(row["user_id"]) == token_data.user_id
    is_admin = token_data.role == "admin"
    if not (is_owner or is_admin):
        raise HTTPException(403, "Chỉ người tạo đơn hoặc admin mới được hủy.")

    if row["status"] == "cancelled":
        return {"data": {"id": leave_id, "status": "cancelled"}, "message": "Đơn đã được hủy trước đó."}

    if row["status"] == "approved":
        if not is_admin:
            raise HTTPException(403, "Đơn đã duyệt — chỉ admin mới hủy được.")
        # Restore balance
        async with conn.transaction():
            year = row["start_date"].year
            used_col = USED_COL[row["leave_type"]]
            await conn.execute(
                f"UPDATE leave_balance SET {used_col} = GREATEST(0, {used_col} - $1) "
                "WHERE user_id = $2::uuid AND period_year = $3",
                row["days_count"], str(row["user_id"]), year,
            )
            await conn.execute(
                """
                UPDATE leave_requests
                SET status='cancelled', cancelled_by=$1::uuid, cancelled_at=NOW()
                WHERE id=$2
                """,
                token_data.user_id, leave_id,
            )
    elif row["status"] == "pending":
        await conn.execute(
            """
            UPDATE leave_requests
            SET status='cancelled', cancelled_by=$1::uuid, cancelled_at=NOW()
            WHERE id=$2
            """,
            token_data.user_id, leave_id,
        )
    else:
        raise HTTPException(409, f"Không hủy được đơn ở trạng thái '{row['status']}'.")

    await _notify_user(
        conn, str(row["user_id"]),
        "leave_cancelled",
        "Đơn xin nghỉ đã hủy",
        f"Đơn nghỉ {row['leave_type']} ({row['start_date']} → {row['end_date']}) đã được hủy.",
        f"/hr/leave/{leave_id}",
    )
    return {"data": {"id": leave_id, "status": "cancelled"}, "message": "Đã hủy đơn."}


# ---------------------------------------------------------------------------
# POST /{id}/approve  &  /reject
# ---------------------------------------------------------------------------

async def _verify_approver(
    conn: asyncpg.Connection,
    token_data: TokenData,
    request_row: asyncpg.Record,
) -> None:
    """Manager same-dept (and not self), or admin."""
    if token_data.role == "admin":
        return
    if token_data.role != "manager":
        raise HTTPException(403, "Chỉ manager hoặc admin mới được duyệt/từ chối.")
    if str(request_row["user_id"]) == token_data.user_id:
        raise HTTPException(403, "Manager không tự duyệt đơn của chính mình; cần admin.")
    actor_dept = await _user_dept(conn, token_data.user_id)
    if actor_dept is None or request_row["department"] != actor_dept:
        raise HTTPException(403, "Manager chỉ duyệt được đơn của phòng mình.")


@router.post("/{leave_id:int}/approve")
async def approve_leave(
    leave_id: int,
    body: DecisionBody = Body(default_factory=DecisionBody),
    token_data: TokenData = Depends(require_role("manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
) -> dict[str, Any]:
    async with conn.transaction():
        row = await conn.fetchrow(
            "SELECT * FROM leave_requests WHERE id = $1 FOR UPDATE",
            leave_id,
        )
        if not row:
            raise HTTPException(404, "Không tìm thấy đơn.")
        if row["status"] != "pending":
            raise HTTPException(409, f"Đơn đang ở trạng thái '{row['status']}', không duyệt được.")
        await _verify_approver(conn, token_data, row)

        # Lock balance row
        year = row["start_date"].year
        await _ensure_balance_row(conn, str(row["user_id"]), year)

        bal = await conn.fetchrow(
            "SELECT * FROM leave_balance WHERE user_id = $1::uuid AND period_year = $2 FOR UPDATE",
            str(row["user_id"]), year,
        )
        used_col  = USED_COL[row["leave_type"]]
        total_col = TOTAL_COL[row["leave_type"]]
        days = float(row["days_count"])

        if total_col is not None:
            new_used = float(bal[used_col]) + days
            if new_used > float(bal[total_col]):
                raise HTTPException(
                    409,
                    f"Vượt quá hạn mức {row['leave_type']} năm {year}: "
                    f"đã dùng {bal[used_col]}, hạn mức {bal[total_col]}, đơn xin {days}.",
                )

        await conn.execute(
            f"UPDATE leave_balance SET {used_col} = {used_col} + $1 "
            "WHERE user_id = $2::uuid AND period_year = $3",
            row["days_count"], str(row["user_id"]), year,
        )
        await conn.execute(
            """
            UPDATE leave_requests
            SET status='approved',
                approved_by=$1::uuid, approved_at=NOW(),
                decision_note=$2
            WHERE id=$3
            """,
            token_data.user_id, body.decision_note, leave_id,
        )

    await _notify_user(
        conn, str(row["user_id"]),
        "leave_approved",
        "Đơn xin nghỉ đã được duyệt",
        f"{row['start_date']} → {row['end_date']} ({days} ngày, {row['leave_type']}).",
        f"/hr/leave/{leave_id}",
    )
    return {"data": {"id": leave_id, "status": "approved"}, "message": "Đã duyệt đơn."}


@router.post("/{leave_id:int}/reject")
async def reject_leave(
    leave_id: int,
    body: DecisionBody = Body(default_factory=DecisionBody),
    token_data: TokenData = Depends(require_role("manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
) -> dict[str, Any]:
    row = await conn.fetchrow("SELECT * FROM leave_requests WHERE id = $1", leave_id)
    if not row:
        raise HTTPException(404, "Không tìm thấy đơn.")
    if row["status"] != "pending":
        raise HTTPException(409, f"Đơn đang ở trạng thái '{row['status']}'.")
    await _verify_approver(conn, token_data, row)

    await conn.execute(
        """
        UPDATE leave_requests
        SET status='rejected',
            rejected_by=$1::uuid, rejected_at=NOW(),
            decision_note=$2
        WHERE id=$3
        """,
        token_data.user_id, body.decision_note, leave_id,
    )
    await _notify_user(
        conn, str(row["user_id"]),
        "leave_rejected",
        "Đơn xin nghỉ bị từ chối",
        f"Đơn {row['start_date']} → {row['end_date']} đã bị từ chối."
        + (f" Lý do: {body.decision_note}" if body.decision_note else ""),
        f"/hr/leave/{leave_id}",
    )
    return {"data": {"id": leave_id, "status": "rejected"}, "message": "Đã từ chối đơn."}


# ---------------------------------------------------------------------------
# GET /balance/{user_id}
# ---------------------------------------------------------------------------

@router.get("/balance/{user_id}")
async def get_balance(
    user_id: str = Path(...),
    year: Optional[int] = Query(None, ge=2024, le=2099),
    token_data: TokenData = Depends(require_role("staff", "manager", "admin", "accountant", "procurement", "warehouse")),
    conn: asyncpg.Connection = Depends(get_db),
) -> dict[str, Any]:
    if token_data.role != "admin" and user_id != token_data.user_id:
        if token_data.role == "manager":
            actor_dept = await _user_dept(conn, token_data.user_id)
            target_dept = await _user_dept(conn, user_id)
            if actor_dept != target_dept:
                raise HTTPException(403, "Manager chỉ xem nhân viên cùng phòng.")
        else:
            raise HTTPException(403, "Bạn chỉ xem được số dư của bản thân.")

    if year is None:
        year = date.today().year

    await _ensure_balance_row(conn, user_id, year)
    row = await conn.fetchrow(
        """
        SELECT * FROM leave_balance
        WHERE user_id = $1::uuid AND period_year = $2
        """,
        user_id, year,
    )
    out = {k: (float(v) if isinstance(v, (int, float)) or hasattr(v, "as_tuple") else v)
           for k, v in dict(row).items()}
    out["user_id"] = str(out["user_id"])
    out["remaining"] = {
        lt: float(row[TOTAL_COL[lt]]) - float(row[USED_COL[lt]])
        for lt in ("annual", "sick", "personal", "maternity")
    }
    return {"data": out}


# ---------------------------------------------------------------------------
# Policy
# ---------------------------------------------------------------------------

@router.get("/policy")
async def get_policy(
    user_id: Optional[str] = Query(None, description="Default: caller."),
    token_data: TokenData = Depends(require_role("staff", "manager", "admin", "accountant", "procurement", "warehouse")),
    conn: asyncpg.Connection = Depends(get_db),
) -> dict[str, Any]:
    target = user_id or token_data.user_id
    if target != token_data.user_id and token_data.role not in ("manager", "admin"):
        raise HTTPException(403, "Bạn chỉ xem được chính sách áp dụng cho bản thân.")
    row = await conn.fetchrow("SELECT * FROM get_leave_policy($1::uuid)", target)
    if not row:
        return {"data": None}
    out = {k: (float(v) if k.endswith("_days") else v) for k, v in dict(row).items()}
    return {"data": out}


@router.put("/policy")
async def upsert_policy(
    body: PolicyUpsert,
    token_data: TokenData = Depends(require_role("admin")),
    conn: asyncpg.Connection = Depends(get_db),
) -> dict[str, Any]:
    row = await conn.fetchrow(
        """
        INSERT INTO leave_policy
            (role, department, annual_days, sick_days, personal_days,
             maternity_days, carry_over_max_days, notes, is_active)
        VALUES ($1::role_enum, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (role, department)
        DO UPDATE SET
            annual_days         = EXCLUDED.annual_days,
            sick_days           = EXCLUDED.sick_days,
            personal_days       = EXCLUDED.personal_days,
            maternity_days      = EXCLUDED.maternity_days,
            carry_over_max_days = EXCLUDED.carry_over_max_days,
            notes               = EXCLUDED.notes,
            is_active           = EXCLUDED.is_active
        RETURNING id
        """,
        body.role, body.department,
        Decimal(str(body.annual_days)), Decimal(str(body.sick_days)),
        Decimal(str(body.personal_days)), Decimal(str(body.maternity_days)),
        Decimal(str(body.carry_over_max_days)), body.notes, body.is_active,
    )
    return {"data": {"id": row["id"]}, "message": "Đã cập nhật chính sách."}
