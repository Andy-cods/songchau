"""Notifications API — list, mark read, mark all read, delete, link compute."""

import json

from fastapi import APIRouter, Depends, HTTPException, Query
import asyncpg

from app.core.database import get_db
from app.core.rbac import require_role
from app.core.security import TokenData

router = APIRouter()

_NOTIF_ROLES = ("staff", "manager", "admin", "procurement", "warehouse", "accountant", "sales", "director")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _compute_notification_link(
    notif_type: str | None,
    ref_type: str | None,
    ref_id: int | None,
    metadata: dict | None = None,
) -> str:
    """Compute UI URL từ notification type + ref. Mặc định trả /notifications nếu
    không xác định được. Thang 2026-05-29: cho phép frontend click thông báo đi
    thẳng tới trang liên quan thay vì luôn về /notifications."""
    t = (notif_type or "").lower()
    rt = (ref_type or "").lower()
    rid = ref_id
    meta = metadata or {}

    if t.startswith("workflow_"):
        # /approvals đã thành redirect-stub về /workflows (11/07); /approvals/{rid}
        # không có trang → 404. Trỏ thẳng /workflows.
        return "/workflows"
    # Đợt 6 — procurement (đấu thầu NCC). All 5 types deep-link to the bidding
    # batch page; ref_id carries the batch_id (set by dispatch_procurement_event).
    if t in ("procurement_award", "procurement_quote", "procurement_contract",
             "procurement_po", "procurement_delivery"):
        return f"/vendor-bidding/{rid}" if rid else "/vendor-bidding"
    if t == "po_received":
        return f"/purchase-orders/{rid}" if rid else "/purchase-orders"
    if rt == "user_pet":
        # Pet tiến hóa/level-up (pet_service.award_exp) — mượn type
        # bqms_rfq_new (tránh ALTER TYPE enum) nhưng ref_type='user_pet'.
        # Fix 2026-07-13: trước đây rơi xuống nhánh bqms_rfq_new bên dưới
        # → đưa user tới /bqms thay vì trang pet. Check TRƯỚC nhánh đó.
        return "/profile"
    if t == "bqms_rfq_new":
        # The /bqms page only consumes `?focus_rfq=<rfq_number>` (the string RFQ
        # number, e.g. QT26071059) — it does NOT resolve a numeric ref_id. So
        # build the deep link from metadata.rfq_number; fall back to the list.
        rfq_number = meta.get("rfq_number")
        if rfq_number:
            return f"/bqms?focus_rfq={rfq_number}"
        return "/bqms"
    if t == "stock_alert":
        return f"/inventory?product_id={rid}" if rid else "/inventory"
    if t == "deadline_reminder":
        return "/tasks"  # không có trang /tasks/[id] → deep-link theo id sẽ 404
    if rt == "task_assignments":
        return "/tasks"  # fallback /{ref_type}/{rid} ra /task_assignments/{id} = 404
    if t == "report_ready":
        return f"/reports/{rid}" if rid else "/reports/daily"
    if rt and rid:
        return f"/{rt}/{rid}"
    return "/notifications"


def _enrich(row: dict) -> dict:
    """Inject `link` + alias `message`=`body` để frontend render đồng nhất."""
    out = dict(row)
    # metadata is a JSONB column; asyncpg returns it as a JSON string. Parse it
    # so link computation (e.g. bqms_rfq_new → ?focus_rfq=<rfq_number>) can read
    # fields out of it.
    raw_meta = out.get("metadata")
    meta: dict = {}
    if isinstance(raw_meta, dict):
        meta = raw_meta
    elif isinstance(raw_meta, str) and raw_meta:
        try:
            parsed = json.loads(raw_meta)
            if isinstance(parsed, dict):
                meta = parsed
        except (ValueError, TypeError):
            meta = {}
    out["link"] = _compute_notification_link(
        out.get("type"), out.get("ref_type"), out.get("ref_id"), meta
    )
    out["message"] = out.get("body")
    return out


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("")
async def list_notifications(
    is_read: bool | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    token_data: TokenData = Depends(require_role(*_NOTIF_ROLES)),
    conn: asyncpg.Connection = Depends(get_db),
):
    conditions = ["n.recipient_id = $1::uuid"]
    params: list = [token_data.user_id]
    idx = 2

    if is_read is not None:
        conditions.append(f"n.is_read = ${idx}")
        params.append(is_read)
        idx += 1

    where = " AND ".join(conditions)

    total = await conn.fetchval(
        f"SELECT COUNT(*) FROM notifications n WHERE {where}", *params
    )

    unread_count = await conn.fetchval(
        "SELECT COUNT(*) FROM notifications WHERE recipient_id = $1::uuid AND is_read = false",
        token_data.user_id,
    )

    params.extend([limit, offset])
    rows = await conn.fetch(
        f"""
        SELECT n.*
        FROM notifications n
        WHERE {where}
        ORDER BY n.created_at DESC
        LIMIT ${idx} OFFSET ${idx + 1}
        """,
        *params,
    )
    return {
        "data": [_enrich(r) for r in rows],
        "total": total,
        "unread_count": unread_count,
    }


@router.put("/{notification_id}/read")
async def mark_read(
    notification_id: str,
    token_data: TokenData = Depends(require_role(*_NOTIF_ROLES)),
    conn: asyncpg.Connection = Depends(get_db),
):
    row = await conn.fetchrow(
        """
        UPDATE notifications
        SET is_read = true, read_at = NOW()
        WHERE id = $1 AND recipient_id = $2::uuid
        RETURNING id, is_read
        """,
        notification_id,
        token_data.user_id,
    )
    if not row:
        raise HTTPException(
            status_code=404, detail="Thông báo không tồn tại hoặc không thuộc về bạn"
        )
    return {"data": dict(row), "message": "Đã đánh dấu đã đọc"}


@router.put("/read-all")
async def mark_all_read(
    token_data: TokenData = Depends(require_role(*_NOTIF_ROLES)),
    conn: asyncpg.Connection = Depends(get_db),
):
    result = await conn.execute(
        """
        UPDATE notifications
        SET is_read = true, read_at = NOW()
        WHERE recipient_id = $1::uuid AND is_read = false
        """,
        token_data.user_id,
    )
    # result is like "UPDATE N"
    count = int(result.split()[-1]) if result else 0
    return {"data": {"updated": count}, "message": f"Đã đánh dấu {count} thông báo đã đọc"}


# Thang 2026-05-29: DELETE endpoints để xoá / dọn dẹp thông báo.

@router.delete("/{notification_id}")
async def delete_notification(
    notification_id: str,
    token_data: TokenData = Depends(require_role(*_NOTIF_ROLES)),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Xoá hẳn 1 notification (hard delete). Chỉ xoá được nếu là của chính user."""
    row = await conn.fetchrow(
        "DELETE FROM notifications WHERE id = $1 AND recipient_id = $2::uuid RETURNING id",
        notification_id,
        token_data.user_id,
    )
    if not row:
        raise HTTPException(
            status_code=404, detail="Thông báo không tồn tại hoặc không thuộc về bạn"
        )
    return {"data": {"id": str(row["id"])}, "message": "Đã xoá thông báo"}


@router.delete("/read")
async def delete_all_read(
    token_data: TokenData = Depends(require_role(*_NOTIF_ROLES)),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Xoá tất cả notification đã đọc của user — dọn inbox gọn."""
    result = await conn.execute(
        "DELETE FROM notifications WHERE recipient_id = $1::uuid AND is_read = true",
        token_data.user_id,
    )
    count = int(result.split()[-1]) if result else 0
    return {"data": {"deleted": count}, "message": f"Đã xoá {count} thông báo đã đọc"}
