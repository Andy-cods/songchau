"""
M41 — Attendance Incidents API.

Plan: plans/employee-productivity/PLAN.md §14.

Workflow
--------
Staff self-reports late / early-leave / no-show. There is NO approval — the
record exists once created. Manager (same dept) or admin can click
"Đã ghi nhận" (acknowledge), which is purely informational.

`minutes_off` is derived from (expected_time, actual_time) at create/patch
time so the API response is always consistent. For `no_show`, both times
are NULL and `minutes_off` defaults to 480 (one full 8-hour workday) — this
ensures KPI rolls up the absence as a measurable cost.

Endpoints
---------
POST   /incidents                 Create (self by default; admin/manager-of-dept can log on behalf).
GET    /incidents                 List with RBAC filters.
GET    /incidents/{id}            One.
PATCH  /incidents/{id}            Edit reason/times within 24h (requester) / admin.
DELETE /incidents/{id}            Hard delete within 24h (requester) / admin.
POST   /incidents/{id}/acknowledge  Manager same-dept / admin: stamp acknowledged_by/at.
GET    /work-hours                Public (any auth): returns the canonical
                                  work_start_time / work_end_time from system_config.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, time, timedelta
from typing import Any, Literal, Optional

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Path, Query
from pydantic import BaseModel, Field, field_validator

from app.core.database import get_db
from app.core.rbac import require_role
from app.core.security import TokenData

logger = logging.getLogger(__name__)
router = APIRouter()


INCIDENT_TYPES = ("late", "early_leave", "no_show")
DEFAULT_FULL_DAY_MINUTES = 480  # 8h


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _user_dept(conn: asyncpg.Connection, user_id: str) -> Optional[str]:
    return await conn.fetchval(
        "SELECT department FROM users WHERE id = $1::uuid AND deleted_at IS NULL",
        user_id,
    )


async def _work_hours(conn: asyncpg.Connection) -> tuple[time, time]:
    """Read canonical work hours from system_config; fallback 08:00–17:00."""
    rows = await conn.fetch(
        "SELECT key, value FROM system_config WHERE key IN ('work_start_time','work_end_time')"
    )
    cfg = {r["key"]: r["value"] for r in rows}
    def _parse(t: str, default: time) -> time:
        try:
            hh, mm = t.split(":")
            return time(int(hh), int(mm))
        except Exception:
            return default
    return (
        _parse(cfg.get("work_start_time", "08:00"), time(8, 0)),
        _parse(cfg.get("work_end_time",   "17:00"), time(17, 0)),
    )


def _minutes_off(
    incident_type: str,
    expected: Optional[time],
    actual: Optional[time],
) -> int:
    """Derive the impact in minutes."""
    if incident_type == "no_show":
        return DEFAULT_FULL_DAY_MINUTES
    if expected is None or actual is None:
        # Best-effort fallback: 0 minutes if times missing.
        return 0
    e = expected.hour * 60 + expected.minute
    a = actual.hour   * 60 + actual.minute
    if incident_type == "late":
        diff = a - e               # arrived after expected
    else:                          # early_leave: left before expected
        diff = e - a
    return max(0, diff)


# ---------------------------------------------------------------------------
# Pydantic
# ---------------------------------------------------------------------------

class IncidentCreate(BaseModel):
    user_id: Optional[str] = None         # admin/manager can log on behalf
    incident_date: date
    incident_type: Literal["late", "early_leave", "no_show"]
    expected_time: Optional[time] = None  # default: from system_config
    actual_time: Optional[time] = None
    reason: Optional[str] = None

    @field_validator("incident_date")
    @classmethod
    def _not_in_future(cls, v: date) -> date:
        if v > date.today():
            raise ValueError("incident_date không được ở tương lai.")
        return v


class IncidentPatch(BaseModel):
    expected_time: Optional[time] = None
    actual_time: Optional[time] = None
    reason: Optional[str] = None


# ---------------------------------------------------------------------------
# GET /work-hours
# ---------------------------------------------------------------------------

@router.get("/work-hours")
async def work_hours(
    token_data: TokenData = Depends(require_role("staff", "manager", "admin", "accountant", "procurement", "warehouse")),
    conn: asyncpg.Connection = Depends(get_db),
) -> dict[str, Any]:
    start, end = await _work_hours(conn)
    return {
        "data": {
            "work_start_time": start.strftime("%H:%M"),
            "work_end_time":   end.strftime("%H:%M"),
            "full_day_minutes": (end.hour - start.hour) * 60 + (end.minute - start.minute),
        }
    }


# ---------------------------------------------------------------------------
# POST /incidents
# ---------------------------------------------------------------------------

@router.post("/incidents", status_code=201)
async def create_incident(
    body: IncidentCreate,
    token_data: TokenData = Depends(require_role("staff", "manager", "admin", "accountant", "procurement", "warehouse")),
    conn: asyncpg.Connection = Depends(get_db),
) -> dict[str, Any]:
    target_user = body.user_id or token_data.user_id
    actor_dept  = await _user_dept(conn, token_data.user_id)
    target_dept = await _user_dept(conn, target_user) if target_user != token_data.user_id else actor_dept
    if target_dept is None and target_user != token_data.user_id:
        raise HTTPException(404, "Không tìm thấy người dùng.")

    # RBAC: self / manager same dept / admin.
    if target_user != token_data.user_id:
        if token_data.role == "admin":
            pass
        elif token_data.role == "manager" and target_dept == actor_dept:
            pass
        else:
            raise HTTPException(403, "Bạn chỉ tự khai báo cho bản thân.")

    # Default times from system_config when missing (only sensible for late / early_leave).
    work_start, work_end = await _work_hours(conn)
    expected = body.expected_time
    if expected is None and body.incident_type in ("late", "early_leave"):
        expected = work_start if body.incident_type == "late" else work_end

    minutes = _minutes_off(body.incident_type, expected, body.actual_time)

    try:
        row = await conn.fetchrow(
            """
            INSERT INTO attendance_incidents
                (user_id, department, incident_date, incident_type,
                 expected_time, actual_time, minutes_off, reason, created_by)
            VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9::uuid)
            RETURNING id, created_at
            """,
            target_user, target_dept, body.incident_date, body.incident_type,
            expected, body.actual_time, minutes, body.reason, token_data.user_id,
        )
    except asyncpg.UniqueViolationError:
        raise HTTPException(
            409,
            f"Đã có ghi nhận '{body.incident_type}' của ngày {body.incident_date} cho người dùng này.",
        )

    return {
        "data": {
            "id": row["id"],
            "user_id": target_user,
            "incident_date": body.incident_date.isoformat(),
            "incident_type": body.incident_type,
            "expected_time": expected.isoformat() if expected else None,
            "actual_time": body.actual_time.isoformat() if body.actual_time else None,
            "minutes_off": minutes,
        },
        "message": "Đã ghi nhận sự cố chuyên cần.",
    }


# ---------------------------------------------------------------------------
# GET /incidents — list
# ---------------------------------------------------------------------------

@router.get("/incidents")
async def list_incidents(
    user_id: Optional[str] = Query(None),
    department: Optional[str] = Query(None),
    incident_type: Optional[Literal["late", "early_leave", "no_show"]] = Query(None),
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    acknowledged: Optional[bool] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    token_data: TokenData = Depends(require_role("staff", "manager", "admin", "accountant", "procurement", "warehouse")),
    conn: asyncpg.Connection = Depends(get_db),
) -> dict[str, Any]:
    actor_dept = await _user_dept(conn, token_data.user_id)
    conds: list[str] = ["1=1"]
    params: list[Any] = []
    idx = 1

    if token_data.role == "admin":
        if user_id:
            conds.append(f"ai.user_id = ${idx}::uuid"); params.append(user_id); idx += 1
        if department:
            conds.append(f"ai.department = ${idx}");   params.append(department); idx += 1
    elif token_data.role == "manager":
        if user_id and user_id != token_data.user_id:
            tgt = await _user_dept(conn, user_id)
            if tgt != actor_dept:
                raise HTTPException(403, "Manager chỉ xem nhân viên cùng phòng.")
            conds.append(f"ai.user_id = ${idx}::uuid"); params.append(user_id); idx += 1
        else:
            conds.append(f"(ai.user_id = ${idx}::uuid OR ai.department = ${idx+1})")
            params.extend([token_data.user_id, actor_dept]); idx += 2
    else:
        conds.append(f"ai.user_id = ${idx}::uuid"); params.append(token_data.user_id); idx += 1

    if incident_type:
        conds.append(f"ai.incident_type = ${idx}"); params.append(incident_type); idx += 1
    if date_from:
        conds.append(f"ai.incident_date >= ${idx}"); params.append(date_from); idx += 1
    if date_to:
        conds.append(f"ai.incident_date <= ${idx}"); params.append(date_to); idx += 1
    if acknowledged is True:
        conds.append("ai.acknowledged_at IS NOT NULL")
    elif acknowledged is False:
        conds.append("ai.acknowledged_at IS NULL")

    where = " AND ".join(conds)
    offset = (page - 1) * limit
    total = await conn.fetchval(
        f"SELECT COUNT(*) FROM attendance_incidents ai WHERE {where}", *params
    )
    params.extend([limit, offset])
    rows = await conn.fetch(
        f"""
        SELECT ai.*, u.full_name AS user_name, u.email AS user_email
        FROM attendance_incidents ai
        JOIN users u ON u.id = ai.user_id
        WHERE {where}
        ORDER BY ai.incident_date DESC, ai.created_at DESC
        LIMIT ${idx} OFFSET ${idx+1}
        """,
        *params,
    )

    return {
        "data": {
            "items": [_serialise(r) for r in rows],
            "total": int(total or 0),
            "page": page,
            "limit": limit,
        }
    }


def _serialise(row: asyncpg.Record) -> dict[str, Any]:
    d = dict(row)
    out: dict[str, Any] = {}
    for k, v in d.items():
        if isinstance(v, datetime):
            out[k] = v.isoformat()
        elif isinstance(v, date):
            out[k] = v.isoformat()
        elif isinstance(v, time):
            out[k] = v.isoformat()
        else:
            out[k] = v
    if out.get("user_id"):
        out["user_id"] = str(out["user_id"])
    return out


# ---------------------------------------------------------------------------
# GET /incidents/{id}
# ---------------------------------------------------------------------------

async def _get_incident_or_403(
    conn: asyncpg.Connection,
    token_data: TokenData,
    incident_id: int,
) -> asyncpg.Record:
    row = await conn.fetchrow(
        """
        SELECT ai.*, u.full_name AS user_name, u.email AS user_email
        FROM attendance_incidents ai
        JOIN users u ON u.id = ai.user_id
        WHERE ai.id = $1
        """,
        incident_id,
    )
    if not row:
        raise HTTPException(404, "Không tìm thấy ghi nhận.")
    if token_data.role == "admin":
        return row
    if str(row["user_id"]) == token_data.user_id:
        return row
    if token_data.role == "manager":
        actor_dept = await _user_dept(conn, token_data.user_id)
        if row["department"] == actor_dept:
            return row
    raise HTTPException(403, "Bạn không có quyền xem ghi nhận này.")


@router.get("/incidents/{incident_id:int}")
async def get_incident(
    incident_id: int = Path(..., ge=1),
    token_data: TokenData = Depends(require_role("staff", "manager", "admin", "accountant", "procurement", "warehouse")),
    conn: asyncpg.Connection = Depends(get_db),
) -> dict[str, Any]:
    row = await _get_incident_or_403(conn, token_data, incident_id)
    return {"data": _serialise(row)}


# ---------------------------------------------------------------------------
# PATCH /incidents/{id} — within 24h (requester) or admin
# ---------------------------------------------------------------------------

def _within_edit_window(created_at: datetime) -> bool:
    return (datetime.now(created_at.tzinfo) - created_at) < timedelta(hours=24)


@router.patch("/incidents/{incident_id:int}")
async def patch_incident(
    incident_id: int,
    body: IncidentPatch,
    token_data: TokenData = Depends(require_role("staff", "manager", "admin", "accountant", "procurement", "warehouse")),
    conn: asyncpg.Connection = Depends(get_db),
) -> dict[str, Any]:
    row = await _get_incident_or_403(conn, token_data, incident_id)
    is_creator = str(row["created_by"]) == token_data.user_id
    is_admin   = token_data.role == "admin"
    if not is_admin and not (is_creator and _within_edit_window(row["created_at"])):
        raise HTTPException(403, "Quá 24h hoặc không phải người tạo — không sửa được.")

    new_expected = body.expected_time if body.expected_time is not None else row["expected_time"]
    new_actual   = body.actual_time   if body.actual_time   is not None else row["actual_time"]
    new_minutes  = _minutes_off(row["incident_type"], new_expected, new_actual)

    await conn.execute(
        """
        UPDATE attendance_incidents
        SET expected_time = $1,
            actual_time   = $2,
            minutes_off   = $3,
            reason        = COALESCE($4, reason)
        WHERE id = $5
        """,
        new_expected, new_actual, new_minutes, body.reason, incident_id,
    )
    return {
        "data": {"id": incident_id, "minutes_off": new_minutes},
        "message": "Đã cập nhật ghi nhận.",
    }


# ---------------------------------------------------------------------------
# DELETE /incidents/{id}
# ---------------------------------------------------------------------------

@router.delete("/incidents/{incident_id:int}")
async def delete_incident(
    incident_id: int,
    token_data: TokenData = Depends(require_role("staff", "manager", "admin", "accountant", "procurement", "warehouse")),
    conn: asyncpg.Connection = Depends(get_db),
) -> dict[str, Any]:
    row = await _get_incident_or_403(conn, token_data, incident_id)
    is_creator = str(row["created_by"]) == token_data.user_id
    is_admin   = token_data.role == "admin"
    if not is_admin and not (is_creator and _within_edit_window(row["created_at"])):
        raise HTTPException(403, "Quá 24h hoặc không phải người tạo — không xóa được.")

    await conn.execute("DELETE FROM attendance_incidents WHERE id = $1", incident_id)
    return {"data": {"id": incident_id}, "message": "Đã xóa ghi nhận."}


# ---------------------------------------------------------------------------
# POST /incidents/{id}/acknowledge
# ---------------------------------------------------------------------------

@router.post("/incidents/{incident_id:int}/acknowledge")
async def acknowledge_incident(
    incident_id: int,
    token_data: TokenData = Depends(require_role("manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
) -> dict[str, Any]:
    row = await _get_incident_or_403(conn, token_data, incident_id)

    if row["acknowledged_at"] is not None:
        return {
            "data": {"id": incident_id, "acknowledged_at": row["acknowledged_at"].isoformat()},
            "message": "Đã ghi nhận trước đó.",
        }

    if token_data.role == "manager":
        actor_dept = await _user_dept(conn, token_data.user_id)
        if row["department"] != actor_dept:
            raise HTTPException(403, "Manager chỉ ghi nhận cho phòng mình.")

    await conn.execute(
        """
        UPDATE attendance_incidents
        SET acknowledged_by = $1::uuid, acknowledged_at = NOW()
        WHERE id = $2
        """,
        token_data.user_id, incident_id,
    )
    return {"data": {"id": incident_id}, "message": "Đã ghi nhận."}
