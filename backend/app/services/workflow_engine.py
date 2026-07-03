"""
Workflow Engine — State machine for multi-level purchase approval.

States:
  draft → pending_l1 → approved | rejected | pending_l2 → approved | rejected | cancelled

Rules:
  - amount < 50M VND  → Manager (L1) can approve directly
  - amount >= 50M VND → Manager approves L1, then escalated to Admin (L2)
  - Reject always requires a comment
  - After 3 days without action → auto-notify (checked by cron / background task)
"""

from __future__ import annotations

import asyncpg
import json
from datetime import datetime, timezone, timedelta
from decimal import Decimal
from enum import Enum
from typing import Any
from uuid import UUID

from app.core.config import settings


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

APPROVAL_THRESHOLD = settings.PO_APPROVAL_THRESHOLD  # 50_000_000
TIMEOUT_DAYS = 3


class WFState(str, Enum):
    DRAFT = "draft"
    PENDING_L1 = "pending_l1"
    PENDING_L2 = "pending_l2"
    APPROVED = "approved"
    REJECTED = "rejected"
    CLOSED = "cancelled"


class WFAction(str, Enum):
    SUBMIT = "submit"
    APPROVE = "approve"
    REJECT = "reject"
    CANCEL = "cancel"
    ESCALATE = "escalate"


# Allowed transitions: (current_status, action) → next_state
# For APPROVE from pending_l1, the next state depends on amount (resolved at runtime)
TRANSITIONS: dict[tuple[str, str], str | None] = {
    (WFState.DRAFT, WFAction.SUBMIT): WFState.PENDING_L1,
    (WFState.PENDING_L1, WFAction.APPROVE): None,  # dynamic — see resolve below
    (WFState.PENDING_L1, WFAction.REJECT): WFState.REJECTED,
    (WFState.PENDING_L1, WFAction.CANCEL): WFState.CLOSED,
    (WFState.PENDING_L2, WFAction.APPROVE): WFState.APPROVED,
    (WFState.PENDING_L2, WFAction.REJECT): WFState.REJECTED,
    (WFState.PENDING_L2, WFAction.CANCEL): WFState.CLOSED,
}

# Which roles may execute which actions in which states
ROLE_PERMISSIONS: dict[tuple[str, str], set[str]] = {
    (WFState.DRAFT, WFAction.SUBMIT): {"staff", "manager", "admin"},
    (WFState.PENDING_L1, WFAction.APPROVE): {"manager", "admin"},
    (WFState.PENDING_L1, WFAction.REJECT): {"manager", "admin"},
    (WFState.PENDING_L1, WFAction.CANCEL): {"staff", "manager", "admin"},
    (WFState.PENDING_L2, WFAction.APPROVE): {"admin"},
    (WFState.PENDING_L2, WFAction.REJECT): {"admin"},
    (WFState.PENDING_L2, WFAction.CANCEL): {"admin"},
}


# ---------------------------------------------------------------------------
# Core engine functions
# ---------------------------------------------------------------------------

def resolve_next_state(current: str, action: str, amount: float) -> str:
    """Determine next state, handling the L1 → L2 escalation rule."""
    key = (current, action)
    if key not in TRANSITIONS:
        raise ValueError(f"Chuyển trạng thái không hợp lệ: {current} + {action}")

    static = TRANSITIONS[key]
    if static is not None:
        return static

    # Dynamic: pending_l1 + approve
    if current == WFState.PENDING_L1 and action == WFAction.APPROVE:
        if amount >= APPROVAL_THRESHOLD:
            return WFState.PENDING_L2
        return WFState.APPROVED

    raise ValueError(f"Không thể xác định trạng thái tiếp theo cho {current} + {action}")


def can_act(role: str, current_status: str, action: str) -> bool:
    """Check whether *role* is allowed to perform *action* in *current_status*."""
    allowed = ROLE_PERMISSIONS.get((current_status, action))
    if allowed is None:
        return False
    return role in allowed


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------

async def create_workflow(
    conn: asyncpg.Connection,
    *,
    entity_type: str,
    entity_id: str,
    amount: float,
    created_by: str,
    title: str | None = None,
) -> dict[str, Any]:
    """Insert a new workflow_instances row in DRAFT state.

    Prod schema uses (workflow_type, current_status, ref_type, ref_id, data jsonb)
    rather than the legacy (entity_type, entity_id, state) columns. The caller-facing
    entity_type/entity_id are mapped: purchase_order → workflow_type 'po_approval',
    ref_type = entity_type, ref_id = numeric entity_id (else NULL). The original
    entity_id is preserved in the `data` jsonb payload.
    """
    workflow_type = "po_approval" if entity_type == "purchase_order" else entity_type
    ref_id = int(entity_id) if str(entity_id).isdigit() else None
    wf_title = title or f"Phê duyệt {entity_type} {entity_id}"
    amount_val = Decimal(str(amount)) if amount is not None else None
    data = json.dumps({"entity_type": entity_type, "entity_id": str(entity_id)})

    row = await conn.fetchrow(
        """
        INSERT INTO workflow_instances
            (workflow_type, current_status, title, amount, ref_type, ref_id, created_by, data)
        VALUES ($1::workflow_type, $2::workflow_status, $3, $4, $5, $6, $7::uuid, $8::jsonb)
        RETURNING *
        """,
        workflow_type,
        WFState.DRAFT.value,
        wf_title,
        amount_val,
        entity_type,
        ref_id,
        created_by,
        data,
    )
    return dict(row)


async def get_workflow(conn: asyncpg.Connection, workflow_id: str) -> dict | None:
    # workflow_instances.id is bigint — coerce the (str) path param before binding.
    try:
        wf_id = int(workflow_id)
    except (TypeError, ValueError):
        return None
    row = await conn.fetchrow(
        "SELECT * FROM workflow_instances WHERE id = $1", wf_id
    )
    return dict(row) if row else None


async def list_workflows(
    conn: asyncpg.Connection,
    *,
    role: str,
    user_id: str,
    status: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[dict], int]:
    """Return workflows visible to the current user/role."""
    conditions = ["1=1"]
    params: list[Any] = []
    idx = 1

    # Role-based visibility
    if role == "staff":
        conditions.append(f"wi.created_by = ${idx}::uuid")
        params.append(user_id)
        idx += 1
    # manager sees own + pending_l1; admin sees everything

    if status:
        conditions.append(f"wi.current_status::text = ${idx}")
        params.append(status)
        idx += 1

    where = " AND ".join(conditions)

    count = await conn.fetchval(
        f"SELECT COUNT(*) FROM workflow_instances wi WHERE {where}",
        *params,
    )

    params.extend([limit, offset])
    rows = await conn.fetch(
        f"""
        SELECT wi.*, u.full_name AS creator_name
        FROM workflow_instances wi
        LEFT JOIN users u ON u.id = wi.created_by
        WHERE {where}
        ORDER BY wi.created_at DESC
        LIMIT ${idx} OFFSET ${idx + 1}
        """,
        *params,
    )
    return [dict(r) for r in rows], count


async def list_pending_for_user(
    conn: asyncpg.Connection,
    *,
    role: str,
    user_id: str,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[dict], int]:
    """Workflows awaiting action from this user based on role."""
    if role == "admin":
        state_filter = "(wi.current_status = 'pending_l1' OR wi.current_status = 'pending_l2')"
    elif role == "manager":
        state_filter = "wi.current_status = 'pending_l1'"
    else:
        # Staff cannot approve, return empty
        return [], 0

    count = await conn.fetchval(
        f"SELECT COUNT(*) FROM workflow_instances wi WHERE {state_filter}"
    )

    rows = await conn.fetch(
        f"""
        SELECT wi.*, u.full_name AS creator_name
        FROM workflow_instances wi
        LEFT JOIN users u ON u.id = wi.created_by
        WHERE {state_filter}
        ORDER BY wi.created_at ASC
        LIMIT $1 OFFSET $2
        """,
        limit,
        offset,
    )
    return [dict(r) for r in rows], count


async def execute_action(
    conn: asyncpg.Connection,
    *,
    workflow_id: str,
    action: str,
    acted_by: str,
    role: str,
    comment: str | None = None,
) -> dict[str, Any]:
    """
    Validate and execute a workflow action.
    Returns the updated workflow dict.
    Raises ValueError on business-rule violations.
    """
    wf = await get_workflow(conn, workflow_id)
    if wf is None:
        raise ValueError("Workflow không tồn tại")

    current = wf["current_status"]

    # Validate action name
    if action not in [a.value for a in WFAction]:
        raise ValueError(f"Hành động không hợp lệ: {action}")

    # Reject must have comment
    if action == WFAction.REJECT and not comment:
        raise ValueError("Từ chối phải có lý do (comment)")

    # Permission check
    if not can_act(role, current, action):
        raise ValueError(
            f"Vai trò '{role}' không được phép thực hiện '{action}' ở trạng thái '{current}'"
        )

    # Resolve next state
    amount = float(wf.get("amount") or 0)
    next_state = resolve_next_state(current, action, amount)

    # Transition inside a transaction
    async with conn.transaction():
        # Update workflow state
        updated = await conn.fetchrow(
            """
            UPDATE workflow_instances
            SET current_status = $1::workflow_status, updated_at = NOW()
            WHERE id = $2
            RETURNING *
            """,
            next_state,
            wf["id"],
        )

        # Record history
        await conn.execute(
            """
            INSERT INTO workflow_history
                (instance_id, from_status, to_status, action, actor_id, comment)
            VALUES ($1, $2::workflow_status, $3::workflow_status, $4, $5::uuid, $6)
            """,
            wf["id"],
            current,
            next_state,
            action,
            acted_by,
            comment,
        )

        # If fully approved, update the source entity (ref_type/ref_id → entity)
        if next_state == WFState.APPROVED and wf.get("ref_type") == "purchase_order":
            await conn.execute(
                "UPDATE purchase_orders SET status = 'approved', approved_at = NOW(), approved_by = $1::uuid WHERE id = $2",
                acted_by,
                wf["ref_id"],
            )
        elif next_state == WFState.REJECTED and wf.get("ref_type") == "purchase_order":
            # po_status enum has no 'rejected' → 'cancelled' is the valid terminal-negative.
            await conn.execute(
                "UPDATE purchase_orders SET status = 'cancelled', cancelled_at = NOW() WHERE id = $1",
                wf["ref_id"],
            )

        # Create notification for the workflow creator
        await _notify(conn, wf, next_state, acted_by, comment)

    return dict(updated)


async def get_history(
    conn: asyncpg.Connection, workflow_id: str
) -> list[dict]:
    # workflow_history.instance_id is bigint (FK → workflow_instances.id).
    try:
        wf_id = int(workflow_id)
    except (TypeError, ValueError):
        return []
    rows = await conn.fetch(
        """
        SELECT wh.*, u.full_name AS actor_name
        FROM workflow_history wh
        LEFT JOIN users u ON u.id = wh.actor_id
        WHERE wh.instance_id = $1
        ORDER BY wh.created_at ASC
        """,
        wf_id,
    )
    return [dict(r) for r in rows]


async def check_timeouts(conn: asyncpg.Connection) -> int:
    """
    Find workflows stuck in pending states for > TIMEOUT_DAYS.
    Creates reminder notifications. Returns count of timed-out items.
    Called by a cron / background task.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=TIMEOUT_DAYS)
    rows = await conn.fetch(
        """
        SELECT * FROM workflow_instances
        WHERE current_status IN ('pending_l1', 'pending_l2')
          AND updated_at < $1
        """,
        cutoff,
    )
    for wf in rows:
        # Notify approvers
        await conn.execute(
            """
            INSERT INTO notifications (recipient_id, type, title, body, ref_type, metadata)
            SELECT u.id, 'workflow_timeout',
                   'Phê duyệt quá hạn',
                   $1,
                   'workflow',
                   jsonb_build_object('link', '/workflows/' || $2::text)
            FROM users u
            WHERE (
                ($3 = 'pending_l1' AND u.role IN ('manager', 'admin'))
                OR ($3 = 'pending_l2' AND u.role = 'admin')
            ) AND u.is_active = true
            """,
            f"Workflow \"{wf['title'] or wf['id']}\" đã chờ hơn {TIMEOUT_DAYS} ngày",
            str(wf["id"]),
            wf["current_status"],
        )
    return len(rows)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

async def _notify(
    conn: asyncpg.Connection,
    wf: dict,
    new_state: str,
    acted_by: str,
    comment: str | None,
) -> None:
    """Create an in-app notification for the workflow creator."""
    state_labels = {
        WFState.PENDING_L1: "đang chờ Manager phê duyệt",
        WFState.PENDING_L2: "đã chuyển lên Admin phê duyệt",
        WFState.APPROVED: "đã được phê duyệt",
        WFState.REJECTED: "đã bị từ chối",
        WFState.CLOSED: "đã bị hủy",
    }
    label = state_labels.get(new_state, new_state)
    title_part = wf.get("title") or wf.get("ref_id") or str(wf["id"])
    body = f'"{title_part}" {label}'
    if comment:
        body += f". Lý do: {comment}"

    # Notify creator (skip if acted_by == creator)
    if str(wf["created_by"]) != str(acted_by):
        await conn.execute(
            """
            INSERT INTO notifications (recipient_id, type, title, body, ref_type, metadata)
            VALUES ($1::uuid, 'workflow_update', $2, $3, 'workflow', jsonb_build_object('link', $4::text))
            """,
            str(wf["created_by"]),
            "Cập nhật phê duyệt",
            body,
            f"/workflows/{wf['id']}",
        )
