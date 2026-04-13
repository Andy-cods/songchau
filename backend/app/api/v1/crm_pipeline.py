"""CRM Pipeline Kanban API — quản lý chu kỳ chăm sóc KH."""

from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import Any

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.database import get_db
from app.core.rbac import require_role
from app.core.security import TokenData
from app.services.crm_mapping_service import get_customer_match_context, non_empty_aliases

logger = logging.getLogger(__name__)
router = APIRouter()

STAGES = ["new", "nurturing", "active", "delivering", "aftercare"]
STAGE_LABELS = {
    "new": "Mới tiếp nhận",
    "nurturing": "Đang chăm sóc",
    "active": "Có RFQ/PO mới",
    "delivering": "Đang giao hàng",
    "aftercare": "Theo dõi sau bán",
}


# ---------------------------------------------------------------------------
# Board — get all cards grouped by stage
# ---------------------------------------------------------------------------

@router.get("/board")
async def get_board(
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Lấy toàn bộ board Kanban — cards nhóm theo stage."""
    rows = await conn.fetch("""
        SELECT * FROM crm_pipeline_cards
        WHERE is_archived = false
        ORDER BY
            CASE priority
                WHEN 'urgent' THEN 0
                WHEN 'high' THEN 1
                WHEN 'normal' THEN 2
                WHEN 'low' THEN 3
            END,
            moved_at DESC
    """)

    board = {}
    for stage in STAGES:
        board[stage] = {
            "label": STAGE_LABELS[stage],
            "cards": [],
        }

    for r in rows:
        d = dict(r)
        stage = d.get("stage", "new")
        if stage in board:
            # Check overdue
            fu = d.get("follow_up_date")
            d["is_overdue"] = fu is not None and fu < date.today()
            board[stage]["cards"].append(d)

    # Counts
    for stage in STAGES:
        board[stage]["count"] = len(board[stage]["cards"])

    return {"data": board, "stages": STAGES, "labels": STAGE_LABELS}


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------

@router.post("/cards")
async def create_card(
    body: dict[str, Any],
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Tạo card mới trên board."""
    title = body.get("title")
    if not title:
        raise HTTPException(400, "Tiêu đề là bắt buộc")

    row = await conn.fetchrow("""
        INSERT INTO crm_pipeline_cards
            (stage, title, description, customer_name, customer_id,
             rfq_number, po_number, bqms_code,
             follow_up_date, follow_up_note, assigned_to, assigned_name,
             priority, source)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        RETURNING *
    """,
        body.get("stage", "new"), title, body.get("description"),
        body.get("customer_name"), body.get("customer_id"),
        body.get("rfq_number"), body.get("po_number"), body.get("bqms_code"),
        body.get("follow_up_date"), body.get("follow_up_note"),
        body.get("assigned_to"), body.get("assigned_name"),
        body.get("priority", "normal"), body.get("source", "manual"),
    )
    return {"data": dict(row), "message": "Đã tạo card"}


@router.patch("/cards/{card_id}/move")
async def move_card(
    card_id: int,
    body: dict[str, Any],
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Kéo card sang stage khác."""
    new_stage = body.get("stage")
    if new_stage not in STAGES:
        raise HTTPException(400, f"Stage không hợp lệ: {new_stage}")

    card = await conn.fetchrow("SELECT id, stage FROM crm_pipeline_cards WHERE id = $1", card_id)
    if not card:
        raise HTTPException(404, "Card không tồn tại")

    old_stage = card["stage"]

    # Auto-set follow-up based on stage transition
    follow_up_date = None
    follow_up_note = None

    if new_stage == "active":
        follow_up_date = date.today() + timedelta(days=3)
        follow_up_note = "Gọi hỏi KH đã xem báo giá chưa"
    elif new_stage == "aftercare":
        follow_up_date = date.today() + timedelta(days=7)
        follow_up_note = "Hỏi KH về chất lượng hàng"

    update_fields = "stage = $2, moved_at = NOW(), updated_at = NOW()"
    params: list = [card_id, new_stage]
    idx = 3

    if follow_up_date:
        update_fields += f", follow_up_date = ${idx}, follow_up_note = ${idx + 1}"
        params.extend([follow_up_date, follow_up_note])
        idx += 2

    row = await conn.fetchrow(
        f"UPDATE crm_pipeline_cards SET {update_fields} WHERE id = $1 RETURNING *",
        *params,
    )

    logger.info("Pipeline card %d moved: %s → %s", card_id, old_stage, new_stage)

    # Real-time sync
    from app.core.concurrency import emit_record_changed
    await emit_record_changed("crm_pipeline_card", card_id, "moved", token_data.user_id,
                              metadata={"from_stage": old_stage, "to_stage": new_stage})

    return {"data": dict(row), "message": f"Đã chuyển sang {STAGE_LABELS.get(new_stage, new_stage)}"}


@router.put("/cards/{card_id}")
async def update_card(
    card_id: int,
    body: dict[str, Any],
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Cập nhật card."""
    allowed = {
        "title", "description", "customer_name", "rfq_number", "po_number",
        "bqms_code", "follow_up_date", "follow_up_note", "assigned_name",
        "priority",
    }
    sets = []
    params: list = []
    idx = 1
    for k, v in body.items():
        if k in allowed:
            sets.append(f"{k} = ${idx}")
            params.append(v)
            idx += 1

    if not sets:
        raise HTTPException(400, "Không có trường nào để cập nhật")

    sets.append("updated_at = NOW()")
    params.append(card_id)
    row = await conn.fetchrow(
        f"UPDATE crm_pipeline_cards SET {', '.join(sets)} WHERE id = ${idx} RETURNING *",
        *params,
    )
    if not row:
        raise HTTPException(404, "Card không tồn tại")
    return {"data": dict(row)}


@router.delete("/cards/{card_id}")
async def archive_card(
    card_id: int,
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Lưu trữ card (soft delete)."""
    await conn.execute(
        "UPDATE crm_pipeline_cards SET is_archived = true, updated_at = NOW() WHERE id = $1",
        card_id,
    )
    return {"message": "Đã lưu trữ"}


# ---------------------------------------------------------------------------
# Auto-generate cards from BQMS data
# ---------------------------------------------------------------------------

@router.post("/generate")
async def generate_cards_from_customers(
    token_data: TokenData = Depends(require_role("manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """T??? ?????ng t???o/c???p nh???t cards cho m???i KH??CH H??NG d???a tr??n data BQMS."""
    customers = await conn.fetch("""
        SELECT id, company_name, short_name, customer_code
        FROM customers WHERE is_active = true AND deleted_at IS NULL
    """)

    created = 0
    updated = 0

    for c in customers:
        cid = c["id"]
        cname = c["company_name"]
        existing = await conn.fetchrow(
            "SELECT id, stage FROM crm_pipeline_cards WHERE customer_id = $1 AND NOT is_archived",
            cid,
        )

        match_context = await get_customer_match_context(conn, cid)
        po_companies = [value.lower() for value in non_empty_aliases(match_context.get("po_companies", []))]
        delivery_types = [value.lower() for value in non_empty_aliases(match_context.get("delivery_types", []))]
        order_customer_names = [value.lower() for value in non_empty_aliases(match_context.get("order_customer_names", []))]

        po_month = await conn.fetchval(
            """
            SELECT COUNT(*)
            FROM bqms_samsung_po
            WHERE CARDINALITY($1::text[]) > 0
              AND LOWER(COALESCE(company, '')) = ANY($1::text[])
              AND po_date >= DATE_TRUNC('month', CURRENT_DATE)
            """,
            po_companies,
        ) or 0

        rfq_pending = await conn.fetchval(
            """
            WITH matched_rfqs AS (
                SELECT DISTINCT sub.rfq_number
                FROM bqms_rfq_submissions sub
                WHERE sub.customer_id = $1
                UNION
                SELECT DISTINCT bo.rfq_number
                FROM bqms_orders bo
                WHERE CARDINALITY($2::text[]) > 0
                  AND LOWER(COALESCE(bo.customer_name, '')) = ANY($2::text[])
            )
            SELECT COUNT(*)
            FROM bqms_rfq rfq
            JOIN matched_rfqs mr ON mr.rfq_number = rfq.rfq_number
            WHERE rfq.result IS NULL OR rfq.result::text = '' OR rfq.result::text = 'pending'
            """,
            cid,
            order_customer_names,
        ) or 0

        delivering = await conn.fetchval(
            """
            SELECT COUNT(*)
            FROM bqms_deliveries
            WHERE CARDINALITY($1::text[]) > 0
              AND LOWER(COALESCE(sev_type, '')) = ANY($1::text[])
              AND delivery_status::text IN ('chua_giao','pending','dang_giao','in_transit')
            """,
            delivery_types,
        ) or 0

        recent_delivered = await conn.fetchval(
            """
            SELECT COUNT(*)
            FROM bqms_deliveries
            WHERE CARDINALITY($1::text[]) > 0
              AND LOWER(COALESCE(sev_type, '')) = ANY($1::text[])
              AND delivery_status::text IN ('da_giao','delivered')
              AND delivery_date >= CURRENT_DATE - INTERVAL '14 days'
            """,
            delivery_types,
        ) or 0

        revenue = await conn.fetchval(
            """
            SELECT COALESCE(SUM(amount), 0)
            FROM bqms_samsung_po
            WHERE CARDINALITY($1::text[]) > 0
              AND LOWER(COALESCE(company, '')) = ANY($1::text[])
            """,
            po_companies,
        ) or 0

        if delivering > 0:
            stage = "delivering"
            desc = f"{delivering} don dang giao"
            fu_date = date.today() + timedelta(days=3)
            fu_note = "Kiem tra tinh trang giao hang"
        elif recent_delivered > 0:
            stage = "aftercare"
            desc = f"{recent_delivered} don giao gan day"
            fu_date = date.today() + timedelta(days=7)
            fu_note = "Hoi KH ve chat luong hang da giao"
        elif po_month > 0 or rfq_pending > 0:
            stage = "active"
            desc = f"{po_month} PO thang nay, {rfq_pending} RFQ dang cho"
            fu_date = date.today() + timedelta(days=3)
            fu_note = "Theo doi RFQ/PO moi"
        elif revenue > 0:
            stage = "nurturing"
            desc = f"Doanh thu: {revenue / 1_000_000:.0f}M - can duy tri lien he"
            fu_date = date.today() + timedelta(days=14)
            fu_note = "Goi hoi tham, gioi thieu san pham moi"
        else:
            stage = "new"
            desc = "Khach hang moi - chua co giao dich"
            fu_date = date.today() + timedelta(days=7)
            fu_note = "Lien he gioi thieu dich vu"

        title = cname

        if existing:
            await conn.execute("""
                UPDATE crm_pipeline_cards SET
                    stage = $1, title = $2, description = $3,
                    follow_up_date = $4, follow_up_note = $5,
                    updated_at = NOW(), moved_at = NOW()
                WHERE id = $6
            """, stage, title, desc, fu_date, fu_note, existing["id"])
            updated += 1
        else:
            await conn.execute("""
                INSERT INTO crm_pipeline_cards
                    (stage, title, description, customer_name, customer_id,
                     follow_up_date, follow_up_note, source)
                VALUES ($1, $2, $3, $4, $5, $6, $7, 'auto_customer')
            """, stage, title, desc, cname, cid, fu_date, fu_note)
            created += 1

    return {
        "message": f"???? x??? l?? {len(customers)} KH: {created} m???i, {updated} c???p nh???t",
        "created": created,
        "updated": updated,
    }


# ---------------------------------------------------------------------------
# Stats
# ---------------------------------------------------------------------------

@router.get("/stats")
async def pipeline_stats(
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Thống kê pipeline."""
    row = await conn.fetchrow("""
        SELECT
            COUNT(*) FILTER (WHERE stage = 'new' AND NOT is_archived)::int AS new_count,
            COUNT(*) FILTER (WHERE stage = 'nurturing' AND NOT is_archived)::int AS nurturing_count,
            COUNT(*) FILTER (WHERE stage = 'active' AND NOT is_archived)::int AS active_count,
            COUNT(*) FILTER (WHERE stage = 'delivering' AND NOT is_archived)::int AS delivering_count,
            COUNT(*) FILTER (WHERE stage = 'aftercare' AND NOT is_archived)::int AS aftercare_count,
            COUNT(*) FILTER (WHERE follow_up_date < CURRENT_DATE AND NOT is_archived)::int AS overdue_count,
            COUNT(*) FILTER (WHERE NOT is_archived)::int AS total_active
        FROM crm_pipeline_cards
    """)
    return {"data": dict(row) if row else {}}
