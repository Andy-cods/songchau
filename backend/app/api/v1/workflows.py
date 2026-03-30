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
    return {"data": data, "total": total}


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
    return {"data": data, "total": total}


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


@router.get("/{workflow_id}/history")
async def history_endpoint(
    workflow_id: str,
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    rows = await get_history(conn, workflow_id)
    return {"data": rows, "total": len(rows)}
