"""
Task Assignment & Workload API (M14) — Assign tasks to staff, track workload,
and auto-distribute unassigned RFQs and POs based on current load.
"""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
import asyncpg

from app.core.database import get_db
from app.core.rbac import require_role
from app.core.security import TokenData

logger = logging.getLogger(__name__)

router = APIRouter()


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class TaskCreateRequest(BaseModel):
    title: str
    description: Optional[str] = None
    task_type: str = "general"          # rfq_review | po_followup | delivery_prep | invoice_review | general
    priority: int = 3                   # 1=urgent 2=high 3=normal 4=low
    assigned_to: str                    # UUID of target user
    due_date: Optional[str] = None      # ISO datetime string
    ref_type: Optional[str] = None
    ref_id: Optional[int] = None
    notes: Optional[str] = None


class TaskUpdateRequest(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    task_type: Optional[str] = None
    priority: Optional[int] = None
    assigned_to: Optional[str] = None
    due_date: Optional[str] = None
    ref_type: Optional[str] = None
    ref_id: Optional[int] = None
    notes: Optional[str] = None
    status: Optional[str] = None


# ---------------------------------------------------------------------------
# GET / — List tasks with filters and pagination
# ---------------------------------------------------------------------------

@router.get("")
async def list_tasks(
    assigned_to: Optional[str] = Query(None, description="UUID người được giao"),
    status: Optional[str] = Query(None, description="pending | in_progress | completed | cancelled | overdue"),
    priority: Optional[int] = Query(None, ge=1, le=4),
    task_type: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    conditions = ["1=1"]
    params: list = []
    idx = 1

    if assigned_to:
        conditions.append(f"ta.assigned_to = ${idx}::uuid")
        params.append(assigned_to)
        idx += 1

    if status:
        conditions.append(f"ta.status = ${idx}")
        params.append(status)
        idx += 1

    if priority is not None:
        conditions.append(f"ta.priority = ${idx}")
        params.append(priority)
        idx += 1

    if task_type:
        conditions.append(f"ta.task_type = ${idx}")
        params.append(task_type)
        idx += 1

    where = " AND ".join(conditions)
    offset = (page - 1) * limit

    total = await conn.fetchval(
        f"SELECT COUNT(*) FROM task_assignments ta WHERE {where}", *params
    )

    params.extend([limit, offset])
    rows = await conn.fetch(
        f"""
        SELECT ta.*,
               u_to.full_name   AS assigned_to_name,
               u_to.email       AS assigned_to_email,
               u_by.full_name   AS assigned_by_name
        FROM task_assignments ta
        LEFT JOIN users u_to ON u_to.id = ta.assigned_to
        LEFT JOIN users u_by ON u_by.id = ta.assigned_by
        WHERE {where}
        ORDER BY ta.priority ASC, ta.due_date ASC NULLS LAST, ta.created_at DESC
        LIMIT ${idx} OFFSET ${idx + 1}
        """,
        *params,
    )

    return {
        "data": {
            "items": [dict(r) for r in rows],
            "total": int(total or 0),
            "page": page,
        }
    }


# ---------------------------------------------------------------------------
# POST / — Create task (manager/admin)
# ---------------------------------------------------------------------------

@router.post("", status_code=201)
async def create_task(
    body: TaskCreateRequest,
    token_data: TokenData = Depends(require_role("manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    # Validate assignee exists
    assignee = await conn.fetchrow(
        "SELECT id, full_name, email FROM users WHERE id = $1::uuid AND is_active = true",
        body.assigned_to,
    )
    if not assignee:
        raise HTTPException(status_code=404, detail="Người được giao không tồn tại hoặc không hoạt động")

    if body.task_type not in ("rfq_review", "po_followup", "delivery_prep", "invoice_review", "general"):
        raise HTTPException(status_code=400, detail="Loại nhiệm vụ không hợp lệ")

    if body.priority not in (1, 2, 3, 4):
        raise HTTPException(status_code=400, detail="Mức độ ưu tiên phải từ 1 đến 4")

    task = await conn.fetchrow(
        """
        INSERT INTO task_assignments
            (title, description, task_type, priority, assigned_to, assigned_by,
             due_date, ref_type, ref_id, notes)
        VALUES ($1, $2, $3, $4, $5::uuid, $6::uuid,
                $7::timestamptz, $8, $9, $10)
        RETURNING *
        """,
        body.title,
        body.description,
        body.task_type,
        body.priority,
        body.assigned_to,
        token_data.user_id,
        body.due_date,
        body.ref_type,
        body.ref_id,
        body.notes,
    )

    # Notify the assignee
    try:
        priority_labels = {1: "Khẩn cấp", 2: "Cao", 3: "Bình thường", 4: "Thấp"}
        await conn.execute(
            """
            INSERT INTO notifications (recipient_id, type, title, body, ref_type, ref_id)
            VALUES ($1::uuid, 'task_assigned', $2, $3, 'task_assignments', $4)
            """,
            body.assigned_to,
            f"Nhiệm vụ mới: {body.title}",
            f"Bạn được giao nhiệm vụ [{priority_labels.get(body.priority, 'Bình thường')}]: {body.title}",
            task["id"],
        )
    except Exception as exc:
        logger.warning("Could not send task notification: %s", exc)

    return {
        "data": dict(task),
        "message": f"Đã tạo nhiệm vụ và thông báo cho {assignee['full_name']}",
    }


# ---------------------------------------------------------------------------
# GET /my-tasks — Current user's tasks
# ---------------------------------------------------------------------------

@router.get("/my-tasks")
async def my_tasks(
    status: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    conditions = ["ta.assigned_to = $1::uuid"]
    params: list = [token_data.user_id]
    idx = 2

    if status:
        conditions.append(f"ta.status = ${idx}")
        params.append(status)
        idx += 1

    where = " AND ".join(conditions)
    offset = (page - 1) * limit

    total = await conn.fetchval(
        f"SELECT COUNT(*) FROM task_assignments ta WHERE {where}", *params
    )

    params.extend([limit, offset])
    rows = await conn.fetch(
        f"""
        SELECT ta.*,
               u_by.full_name AS assigned_by_name
        FROM task_assignments ta
        LEFT JOIN users u_by ON u_by.id = ta.assigned_by
        WHERE {where}
        ORDER BY ta.priority ASC, ta.due_date ASC NULLS LAST, ta.created_at DESC
        LIMIT ${idx} OFFSET ${idx + 1}
        """,
        *params,
    )

    return {
        "data": {
            "items": [dict(r) for r in rows],
            "total": int(total or 0),
            "page": page,
        }
    }


# ---------------------------------------------------------------------------
# GET /workload — Workload per user
# ---------------------------------------------------------------------------

@router.get("/workload")
async def workload_summary(
    token_data: TokenData = Depends(require_role("manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """
    Returns pending + in_progress task count per active user,
    sorted by total load descending so managers can see who is busiest.
    """
    rows = await conn.fetch(
        """
        SELECT
            u.id::text                                              AS user_id,
            u.full_name,
            u.email,
            u.role,
            COUNT(ta.id) FILTER (WHERE ta.status = 'pending')      AS pending_count,
            COUNT(ta.id) FILTER (WHERE ta.status = 'in_progress')  AS in_progress_count,
            COUNT(ta.id) FILTER (WHERE ta.status = 'overdue')      AS overdue_count,
            COUNT(ta.id) FILTER (WHERE ta.status = 'completed'
                                   AND ta.completed_at >= NOW() - INTERVAL '30 days') AS completed_30d,
            COUNT(ta.id) FILTER (
                WHERE ta.status IN ('pending','in_progress')
            )                                                       AS active_load
        FROM users u
        LEFT JOIN task_assignments ta ON ta.assigned_to = u.id
        WHERE u.is_active = true
        GROUP BY u.id, u.full_name, u.email, u.role
        ORDER BY active_load DESC, u.full_name ASC
        """
    )

    return {
        "data": {
            "items": [dict(r) for r in rows],
            "total": len(rows),
        }
    }


# ---------------------------------------------------------------------------
# GET /{id} — Task detail
# ---------------------------------------------------------------------------

@router.get("/{task_id}")
async def get_task(
    task_id: int,
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    row = await conn.fetchrow(
        """
        SELECT ta.*,
               u_to.full_name  AS assigned_to_name,
               u_to.email      AS assigned_to_email,
               u_by.full_name  AS assigned_by_name
        FROM task_assignments ta
        LEFT JOIN users u_to ON u_to.id = ta.assigned_to
        LEFT JOIN users u_by ON u_by.id = ta.assigned_by
        WHERE ta.id = $1
        """,
        task_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Nhiệm vụ không tồn tại")
    return {"data": dict(row)}


# ---------------------------------------------------------------------------
# PUT /{id} — Update task
# ---------------------------------------------------------------------------

@router.put("/{task_id}")
async def update_task(
    task_id: int,
    body: TaskUpdateRequest,
    token_data: TokenData = Depends(require_role("manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    # Verify task exists
    existing = await conn.fetchrow("SELECT * FROM task_assignments WHERE id = $1", task_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Nhiệm vụ không tồn tại")

    set_parts = []
    params: list = []
    idx = 1

    field_map = {
        "title": body.title,
        "description": body.description,
        "task_type": body.task_type,
        "priority": body.priority,
        "due_date": body.due_date,
        "ref_type": body.ref_type,
        "ref_id": body.ref_id,
        "notes": body.notes,
        "status": body.status,
    }

    for field, value in field_map.items():
        if value is not None:
            if field == "due_date":
                set_parts.append(f"{field} = ${idx}::timestamptz")
            elif field == "assigned_to":
                set_parts.append(f"{field} = ${idx}::uuid")
            else:
                set_parts.append(f"{field} = ${idx}")
            params.append(value)
            idx += 1

    if body.assigned_to is not None:
        set_parts.append(f"assigned_to = ${idx}::uuid")
        params.append(body.assigned_to)
        idx += 1

    if not set_parts:
        return {"data": dict(existing), "message": "Không có thay đổi"}

    params.append(task_id)
    set_clause = ", ".join(set_parts)

    updated = await conn.fetchrow(
        f"""
        UPDATE task_assignments
        SET {set_clause}
        WHERE id = ${idx}
        RETURNING *
        """,
        *params,
    )

    return {"data": dict(updated), "message": "Đã cập nhật nhiệm vụ"}


# ---------------------------------------------------------------------------
# POST /{id}/start — Mark in_progress
# ---------------------------------------------------------------------------

@router.post("/{task_id}/start")
async def start_task(
    task_id: int,
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    row = await conn.fetchrow(
        """
        UPDATE task_assignments
        SET status = 'in_progress'
        WHERE id = $1
          AND status = 'pending'
          AND (assigned_to = $2::uuid OR $3 = ANY(ARRAY['manager','admin']))
        RETURNING id, status, title
        """,
        task_id,
        token_data.user_id,
        token_data.role,
    )
    if not row:
        raise HTTPException(
            status_code=400,
            detail="Không thể bắt đầu: nhiệm vụ không tồn tại, không ở trạng thái chờ, hoặc bạn không có quyền",
        )
    return {"data": dict(row), "message": "Đã bắt đầu thực hiện nhiệm vụ"}


# ---------------------------------------------------------------------------
# POST /{id}/complete — Mark completed
# ---------------------------------------------------------------------------

@router.post("/{task_id}/complete")
async def complete_task(
    task_id: int,
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    row = await conn.fetchrow(
        """
        UPDATE task_assignments
        SET status = 'completed',
            completed_at = NOW()
        WHERE id = $1
          AND status IN ('pending','in_progress')
          AND (assigned_to = $2::uuid OR $3 = ANY(ARRAY['manager','admin']))
        RETURNING id, status, title, completed_at
        """,
        task_id,
        token_data.user_id,
        token_data.role,
    )
    if not row:
        raise HTTPException(
            status_code=400,
            detail="Không thể hoàn thành: nhiệm vụ không tồn tại, đã hoàn thành, hoặc bạn không có quyền",
        )
    return {"data": dict(row), "message": "Đã hoàn thành nhiệm vụ"}


# ---------------------------------------------------------------------------
# POST /auto-assign — Auto-assign unassigned RFQs and POs to staff by workload
# ---------------------------------------------------------------------------

@router.post("/auto-assign")
async def auto_assign(
    token_data: TokenData = Depends(require_role("manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """
    Auto-assign workflow:
    1. Find active bqms_rfq records not yet linked to any task_assignment
    2. Find new purchase_orders not yet linked to any task_assignment
    3. Get workload per procurement/staff user (active task count)
    4. Round-robin assign to users with lowest load
    5. Create task_assignments + send notifications
    """
    # Get eligible staff (staff + manager, exclude admin-only roles)
    staff_rows = await conn.fetch(
        """
        SELECT u.id::text AS user_id, u.full_name, u.email,
               COUNT(ta.id) FILTER (WHERE ta.status IN ('pending','in_progress')) AS active_load
        FROM users u
        LEFT JOIN task_assignments ta ON ta.assigned_to = u.id
        WHERE u.is_active = true
          AND u.role IN ('staff','manager')
        GROUP BY u.id, u.full_name, u.email
        ORDER BY active_load ASC, u.full_name ASC
        """
    )

    if not staff_rows:
        return {
            "data": {"assigned": [], "total_assigned": 0},
            "message": "Không có nhân viên khả dụng để giao việc",
        }

    # Build mutable workload dict: {user_id: current_load}
    workload: dict[str, int] = {str(r["user_id"]): int(r["active_load"]) for r in staff_rows}
    staff_list = [str(r["user_id"]) for r in staff_rows]
    staff_names = {str(r["user_id"]): r["full_name"] for r in staff_rows}

    def pick_least_loaded() -> str:
        return min(workload, key=lambda uid: workload[uid])

    # --- Find unassigned RFQs (result = 'pending' or 'received', no existing task) ---
    unassigned_rfqs = await conn.fetch(
        """
        SELECT rfq.id, rfq.rfq_number, rfq.bqms_code, rfq.specification
        FROM bqms_rfq rfq
        WHERE rfq.result IN ('pending','received','new')
          AND NOT EXISTS (
              SELECT 1 FROM task_assignments ta
              WHERE ta.ref_type = 'bqms_rfq' AND ta.ref_id = rfq.id
                AND ta.status NOT IN ('completed','cancelled')
          )
        ORDER BY rfq.id ASC
        LIMIT 20
        """
    )

    # --- Find unassigned POs (status = 'draft' or 'submitted', no existing task) ---
    unassigned_pos = await conn.fetch(
        """
        SELECT po.id, po.po_number, po.total_amount
        FROM purchase_orders po
        WHERE po.status IN ('draft','submitted','pending_approval')
          AND NOT EXISTS (
              SELECT 1 FROM task_assignments ta
              WHERE ta.ref_type = 'purchase_orders' AND ta.ref_id = po.id
                AND ta.status NOT IN ('completed','cancelled')
          )
        ORDER BY po.id ASC
        LIMIT 20
        """
    )

    assigned = []

    async with conn.transaction():
        # Assign RFQs
        for rfq in unassigned_rfqs:
            uid = pick_least_loaded()
            title = f"Xem xét RFQ: {rfq['rfq_number']} — {rfq['bqms_code'] or rfq['specification'] or ''}"

            task = await conn.fetchrow(
                """
                INSERT INTO task_assignments
                    (title, task_type, priority, assigned_to, assigned_by,
                     ref_type, ref_id)
                VALUES ($1, 'rfq_review', 2, $2::uuid, $3::uuid,
                        'bqms_rfq', $4)
                RETURNING id
                """,
                title,
                uid,
                token_data.user_id,
                rfq["id"],
            )

            # Notify
            try:
                await conn.execute(
                    """
                    INSERT INTO notifications (recipient_id, type, title, body, ref_type, ref_id)
                    VALUES ($1::uuid, 'task_assigned', $2, $3, 'task_assignments', $4)
                    """,
                    uid,
                    f"Nhiệm vụ mới: {title}",
                    f"Hệ thống đã tự động giao cho bạn: {title}",
                    task["id"],
                )
            except Exception as exc:
                logger.warning("Notification failed for RFQ task: %s", exc)

            workload[uid] += 1
            assigned.append({
                "task_id": task["id"],
                "type": "rfq_review",
                "ref_type": "bqms_rfq",
                "ref_id": rfq["id"],
                "ref_number": rfq["rfq_number"],
                "assigned_to": uid,
                "assigned_to_name": staff_names[uid],
            })

        # Assign POs
        for po in unassigned_pos:
            uid = pick_least_loaded()
            title = f"Theo dõi PO: {po['po_number']}"

            task = await conn.fetchrow(
                """
                INSERT INTO task_assignments
                    (title, task_type, priority, assigned_to, assigned_by,
                     ref_type, ref_id)
                VALUES ($1, 'po_followup', 2, $2::uuid, $3::uuid,
                        'purchase_orders', $4)
                RETURNING id
                """,
                title,
                uid,
                token_data.user_id,
                po["id"],
            )

            try:
                await conn.execute(
                    """
                    INSERT INTO notifications (recipient_id, type, title, body, ref_type, ref_id)
                    VALUES ($1::uuid, 'task_assigned', $2, $3, 'task_assignments', $4)
                    """,
                    uid,
                    f"Nhiệm vụ mới: {title}",
                    f"Hệ thống đã tự động giao cho bạn: {title}",
                    task["id"],
                )
            except Exception as exc:
                logger.warning("Notification failed for PO task: %s", exc)

            workload[uid] += 1
            assigned.append({
                "task_id": task["id"],
                "type": "po_followup",
                "ref_type": "purchase_orders",
                "ref_id": po["id"],
                "ref_number": po["po_number"],
                "assigned_to": uid,
                "assigned_to_name": staff_names[uid],
            })

    return {
        "data": {
            "assigned": assigned,
            "total_assigned": len(assigned),
            "rfqs_assigned": len(unassigned_rfqs),
            "pos_assigned": len(unassigned_pos),
        },
        "message": f"Đã tự động giao {len(assigned)} nhiệm vụ cho nhân viên",
    }
