"""
Batch Operations API (M25) — Song Châu ERP

Perform bulk updates, soft deletes, and task assignments in a single request,
dramatically reducing round-trips for managers and admins.

Endpoints:
  POST /batch-update  — Update a field across multiple records
  POST /batch-delete  — Soft delete multiple records (admin only)
  POST /batch-assign  — Assign multiple tasks to a user
"""

from __future__ import annotations

import logging
from typing import Any, Optional

import asyncpg
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator

from app.core.database import get_db
from app.core.rbac import require_role
from app.core.security import TokenData

logger = logging.getLogger(__name__)

router = APIRouter()

# ---------------------------------------------------------------------------
# Whitelist configuration for batch operations
# ---------------------------------------------------------------------------

# table → { field → allowed_values (None = any value accepted) }
BATCH_UPDATE_CONFIG: dict[str, dict[str, Optional[set]]] = {
    "purchase_orders": {
        "status": {"draft", "submitted", "pending_approval", "approved", "rejected",
                   "ordered", "partial", "received", "cancelled"},
    },
    "task_assignments": {
        "status": {"pending", "in_progress", "completed", "cancelled", "overdue"},
        "priority": {1, 2, 3, 4},
    },
    "notifications": {
        "is_read": {True, False},
    },
    "inventory": {
        "min_stock": None,  # any numeric value
    },
}

# Tables that support soft delete (must have is_deleted or is_active column)
SOFT_DELETE_CONFIG: dict[str, str] = {
    # table_name → column to set false/true
    "notifications":     "is_read",      # mark as read acts as soft-delete for notifications
    "task_assignments":  "status",       # set status='cancelled'
    "documents":         None,           # hard delete handled elsewhere
    "help_articles":     "is_published", # unpublish
}

MAX_BATCH_SIZE = 500


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class BatchUpdateRequest(BaseModel):
    table: str
    ids: list[int]
    field: str
    value: Any

    @field_validator("ids")
    @classmethod
    def validate_ids(cls, v: list[int]) -> list[int]:
        if not v:
            raise ValueError("Danh sách IDs không được rỗng")
        if len(v) > MAX_BATCH_SIZE:
            raise ValueError(f"Tối đa {MAX_BATCH_SIZE} bản ghi mỗi lần")
        return v


class BatchDeleteRequest(BaseModel):
    table: str
    ids: list[int]

    @field_validator("ids")
    @classmethod
    def validate_ids(cls, v: list[int]) -> list[int]:
        if not v:
            raise ValueError("Danh sách IDs không được rỗng")
        if len(v) > MAX_BATCH_SIZE:
            raise ValueError(f"Tối đa {MAX_BATCH_SIZE} bản ghi mỗi lần")
        return v


class BatchAssignRequest(BaseModel):
    task_ids: list[int]
    assigned_to: str  # UUID

    @field_validator("task_ids")
    @classmethod
    def validate_task_ids(cls, v: list[int]) -> list[int]:
        if not v:
            raise ValueError("Danh sách task_ids không được rỗng")
        if len(v) > MAX_BATCH_SIZE:
            raise ValueError(f"Tối đa {MAX_BATCH_SIZE} nhiệm vụ mỗi lần")
        return v


# ---------------------------------------------------------------------------
# Helper: safely quote identifier
# ---------------------------------------------------------------------------

def _safe_identifier(name: str) -> str:
    """Allow only alphanumeric and underscore characters in identifiers."""
    if not name.replace("_", "").isalnum():
        raise HTTPException(
            status_code=400,
            detail=f"Tên không hợp lệ: '{name}'. Chỉ chấp nhận ký tự chữ, số và dấu gạch dưới.",
        )
    return name


# ---------------------------------------------------------------------------
# POST /batch-update
# ---------------------------------------------------------------------------

@router.post("/batch-update")
async def batch_update(
    body: BatchUpdateRequest,
    token_data: TokenData = Depends(require_role("manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    # Validate table
    if body.table not in BATCH_UPDATE_CONFIG:
        raise HTTPException(
            status_code=400,
            detail=f"Bảng không được hỗ trợ. Chấp nhận: {', '.join(sorted(BATCH_UPDATE_CONFIG.keys()))}",
        )

    table_config = BATCH_UPDATE_CONFIG[body.table]

    # Validate field
    if body.field not in table_config:
        raise HTTPException(
            status_code=400,
            detail=f"Trường '{body.field}' không được hỗ trợ cho bảng '{body.table}'. "
                   f"Chấp nhận: {', '.join(sorted(table_config.keys()))}",
        )

    # Validate value against allowed set (if restricted)
    allowed_values = table_config[body.field]
    if allowed_values is not None and body.value not in allowed_values:
        raise HTTPException(
            status_code=400,
            detail=f"Giá trị '{body.value}' không hợp lệ cho trường '{body.field}'. "
                   f"Chấp nhận: {sorted(str(v) for v in allowed_values)}",
        )

    table_name = _safe_identifier(body.table)
    field_name = _safe_identifier(body.field)

    # Additional type cast for specific fields
    cast_suffix = ""
    if body.field == "is_read":
        cast_suffix = "::boolean"
    elif body.field == "min_stock":
        try:
            body.value = float(body.value)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="min_stock phải là số")

    try:
        result = await conn.execute(
            f"""
            UPDATE {table_name}
            SET {field_name} = $1{cast_suffix},
                updated_at  = NOW()
            WHERE id = ANY($2::bigint[])
            """,
            body.value,
            body.ids,
        )
    except Exception as exc:
        logger.error("Batch update failed [%s.%s]: %s", body.table, body.field, exc)
        raise HTTPException(status_code=500, detail=f"Lỗi cập nhật hàng loạt: {exc}")

    # Parse "UPDATE N" result string
    updated_count = int(result.split()[-1]) if result else 0

    return {
        "data": {
            "table": body.table,
            "field": body.field,
            "value": body.value,
            "ids_requested": len(body.ids),
            "rows_updated": updated_count,
        },
        "message": f"Đã cập nhật {updated_count}/{len(body.ids)} bản ghi trong '{body.table}'",
    }


# ---------------------------------------------------------------------------
# POST /batch-delete — Soft delete (admin only)
# ---------------------------------------------------------------------------

@router.post("/batch-delete")
async def batch_delete(
    body: BatchDeleteRequest,
    token_data: TokenData = Depends(require_role("admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    # Supported soft-delete tables
    SUPPORTED = {
        "notifications": {
            "sql": "UPDATE notifications SET is_read = true, updated_at = NOW() WHERE id = ANY($1::bigint[])",
            "label": "thông báo (đánh dấu đã đọc)",
        },
        "task_assignments": {
            "sql": "UPDATE task_assignments SET status = 'cancelled', updated_at = NOW() WHERE id = ANY($1::bigint[])",
            "label": "nhiệm vụ (huỷ)",
        },
        "help_articles": {
            "sql": "UPDATE help_articles SET is_published = false, updated_at = NOW() WHERE id = ANY($1::bigint[])",
            "label": "bài viết hướng dẫn (ẩn)",
        },
    }

    if body.table not in SUPPORTED:
        raise HTTPException(
            status_code=400,
            detail=f"Bảng không được hỗ trợ xoá hàng loạt. Chấp nhận: {', '.join(sorted(SUPPORTED.keys()))}",
        )

    config = SUPPORTED[body.table]

    try:
        result = await conn.execute(config["sql"], body.ids)
    except Exception as exc:
        logger.error("Batch delete failed [%s]: %s", body.table, exc)
        raise HTTPException(status_code=500, detail=f"Lỗi xoá hàng loạt: {exc}")

    updated_count = int(result.split()[-1]) if result else 0

    return {
        "data": {
            "table": body.table,
            "ids_requested": len(body.ids),
            "rows_affected": updated_count,
        },
        "message": f"Đã {config['label']} {updated_count}/{len(body.ids)} bản ghi",
    }


# ---------------------------------------------------------------------------
# POST /batch-assign — Assign multiple tasks to a user
# ---------------------------------------------------------------------------

@router.post("/batch-assign")
async def batch_assign(
    body: BatchAssignRequest,
    token_data: TokenData = Depends(require_role("manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    # Validate target user
    assignee = await conn.fetchrow(
        "SELECT id, full_name, email FROM users WHERE id = $1::uuid AND is_active = true",
        body.assigned_to,
    )
    if not assignee:
        raise HTTPException(
            status_code=404,
            detail="Người được giao không tồn tại hoặc không còn hoạt động",
        )

    # Verify tasks exist and are not already completed/cancelled
    existing = await conn.fetch(
        """
        SELECT id FROM task_assignments
        WHERE id = ANY($1::bigint[])
          AND status NOT IN ('completed', 'cancelled')
        """,
        body.task_ids,
    )
    valid_ids = [r["id"] for r in existing]

    if not valid_ids:
        raise HTTPException(
            status_code=400,
            detail="Không có nhiệm vụ hợp lệ để giao (tất cả đã hoàn thành hoặc huỷ)",
        )

    try:
        async with conn.transaction():
            result = await conn.execute(
                """
                UPDATE task_assignments
                SET assigned_to = $1::uuid,
                    assigned_by = $2::uuid,
                    updated_at  = NOW()
                WHERE id = ANY($3::bigint[])
                """,
                body.assigned_to,
                token_data.user_id,
                valid_ids,
            )

            # Bulk notify the assignee
            await conn.execute(
                """
                INSERT INTO notifications (recipient_id, type, title, body, ref_type, ref_id)
                SELECT $1::uuid, 'task_assigned',
                       'Nhiệm vụ được giao lại',
                       $2,
                       'task_assignments',
                       id
                FROM task_assignments
                WHERE id = ANY($3::bigint[])
                """,
                body.assigned_to,
                f"Bạn được giao {len(valid_ids)} nhiệm vụ mới bởi {token_data.email}",
                valid_ids,
            )
    except Exception as exc:
        logger.error("Batch assign failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"Lỗi giao nhiệm vụ hàng loạt: {exc}")

    updated_count = int(result.split()[-1]) if result else 0
    skipped = len(body.task_ids) - len(valid_ids)

    return {
        "data": {
            "assigned_to": body.assigned_to,
            "assigned_to_name": assignee["full_name"],
            "task_ids_requested": len(body.task_ids),
            "tasks_assigned": updated_count,
            "tasks_skipped": skipped,
        },
        "message": (
            f"Đã giao {updated_count} nhiệm vụ cho {assignee['full_name']}"
            + (f" ({skipped} bỏ qua do đã hoàn thành/huỷ)" if skipped else "")
        ),
    }
