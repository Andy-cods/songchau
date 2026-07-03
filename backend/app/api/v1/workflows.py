"""Workflow approval API."""

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
import asyncpg

from app.core.database import get_db
from app.core.rbac import require_role
from app.core.security import TokenData
from app.services.workflow_engine import (
    create_workflow,
    get_workflow,
    list_workflows,
    list_pending_for_user,
    execute_action,
    get_history,
)

router = APIRouter()


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class WorkflowCreateRequest(BaseModel):
    entity_type: str
    entity_id: str
    amount: float = 0
    title: str | None = None


class WorkflowActionRequest(BaseModel):
    action: str  # approve | reject | cancel
    comment: str | None = None


class WorkflowCommentRequest(BaseModel):
    """Payload for the thin approve/reject/escalate aliases (comment only)."""
    comment: str | None = None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("")
async def list_workflows_endpoint(
    status: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    data, total = await list_workflows(
        conn, role=token_data.role, user_id=token_data.user_id,
        status=status, limit=limit, offset=offset,
    )
    return {"data": {"items": data or [], "total": total}}


@router.post("", status_code=201)
async def create_workflow_endpoint(
    body: WorkflowCreateRequest,
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    wf = await create_workflow(
        conn,
        entity_type=body.entity_type,
        entity_id=body.entity_id,
        amount=body.amount,
        created_by=token_data.user_id,
        title=body.title,
    )
    return {"data": wf}


@router.get("/pending/me")
async def pending_for_me(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    data, total = await list_pending_for_user(
        conn, role=token_data.role, user_id=token_data.user_id,
        limit=limit, offset=offset,
    )
    return {"data": {"items": data or [], "total": total}}


@router.get("/{workflow_id}")
async def get_workflow_endpoint(
    workflow_id: str,
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    wf = await get_workflow(conn, workflow_id)
    if not wf:
        raise HTTPException(status_code=404, detail="Workflow không tồn tại")
    return {"data": wf}


@router.post("/{workflow_id}/action")
async def action_endpoint(
    workflow_id: str,
    body: WorkflowActionRequest,
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    try:
        updated = await execute_action(
            conn,
            workflow_id=workflow_id,
            action=body.action,
            acted_by=token_data.user_id,
            role=token_data.role,
            comment=body.comment,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"data": updated}


# --- Thin action aliases (FE calls /approve /reject /escalate directly) --------
async def _run_action(
    workflow_id: str, action: str, comment: str | None,
    token_data: TokenData, conn: asyncpg.Connection,
):
    try:
        updated = await execute_action(
            conn,
            workflow_id=workflow_id,
            action=action,
            acted_by=token_data.user_id,
            role=token_data.role,
            comment=comment,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"data": updated}


@router.post("/{workflow_id}/approve")
async def approve_endpoint(
    workflow_id: str,
    body: WorkflowCommentRequest,
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    return await _run_action(workflow_id, "approve", body.comment, token_data, conn)


@router.post("/{workflow_id}/reject")
async def reject_endpoint(
    workflow_id: str,
    body: WorkflowCommentRequest,
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    return await _run_action(workflow_id, "reject", body.comment, token_data, conn)


@router.post("/{workflow_id}/escalate")
async def escalate_endpoint(
    workflow_id: str,
    body: WorkflowCommentRequest,
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    return await _run_action(workflow_id, "escalate", body.comment, token_data, conn)


@router.get("/approval-log")
async def approval_log_endpoint(
    entity_type: str | None = Query(None, description="Lọc theo loại thực thể, e.g. purchase_order"),
    action: str | None = Query(None, description="Lọc theo hành động: approve | reject | cancel"),
    actor_id: str | None = Query(None, description="Lọc theo người thực hiện"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """
    Audit log toàn bộ quyết định phê duyệt/từ chối.
    Trả về: ai đã duyệt/từ chối, khi nào, thực thể nào, lý do.
    """
    conditions = ["wh.action IN ('approve', 'reject', 'cancel')"]
    params: list = []
    idx = 1

    if entity_type:
        conditions.append(f"wi.ref_type = ${idx}")
        params.append(entity_type)
        idx += 1

    if action:
        conditions.append(f"wh.action = ${idx}")
        params.append(action)
        idx += 1

    if actor_id:
        conditions.append(f"wh.actor_id = ${idx}::uuid")
        params.append(actor_id)
        idx += 1

    # Staff can only see logs for workflows they created
    if token_data.role == "staff":
        conditions.append(f"wi.created_by = ${idx}::uuid")
        params.append(token_data.user_id)
        idx += 1

    where = " AND ".join(conditions)

    total = await conn.fetchval(
        f"""
        SELECT COUNT(*)
        FROM workflow_history wh
        JOIN workflow_instances wi ON wi.id = wh.instance_id
        WHERE {where}
        """,
        *params,
    )

    params.extend([limit, offset])
    rows = await conn.fetch(
        f"""
        SELECT
            wh.id,
            wh.instance_id,
            wh.from_status,
            wh.to_status,
            wh.action,
            wh.comment,
            wh.created_at           AS acted_at,
            u.id                    AS actor_id,
            u.full_name             AS actor_name,
            u.role                  AS actor_role,
            wi.ref_type,
            wi.ref_id,
            wi.title                AS workflow_title,
            wi.amount,
            creator.full_name       AS creator_name
        FROM workflow_history wh
        JOIN workflow_instances wi ON wi.id = wh.instance_id
        LEFT JOIN users u   ON u.id = wh.actor_id
        LEFT JOIN users creator ON creator.id = wi.created_by
        WHERE {where}
        ORDER BY wh.created_at DESC
        LIMIT ${idx} OFFSET ${idx + 1}
        """,
        *params,
    )

    return {
        "data": [dict(r) for r in rows],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.get("/{workflow_id}/history")
async def history_endpoint(
    workflow_id: str,
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    rows = await get_history(conn, workflow_id)
    return {"data": rows, "total": len(rows)}
