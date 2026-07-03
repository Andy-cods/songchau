"""Unified Orders API — Phase 3.

Read-only endpoints over the ``v_unified_orders`` view (created in
``migrations/phase3_chain_activation.sql``) that fuses the two order flows
(sourcing/ERP orders + Samsung BQMS) with their PO, delivery, revenue-chain
and accounts-receivable (công nợ) snapshots.

These endpoints are SAFE: they only SELECT from the view. No writes, no
behavior change. Surfaced on the unified dashboard.
"""

from __future__ import annotations

from datetime import date

import asyncpg
from fastapi import APIRouter, Depends, Query

from app.core.database import get_db
from app.core.rbac import require_role, TokenData

router = APIRouter()


@router.get("/unified")
async def list_unified_orders(
    status: str | None = Query(None, description="Filter by order_status"),
    ar_state: str | None = Query(None, description="Filter công nợ: none|open|overdue|paid"),
    source_type: str | None = Query(None, description="Filter by source_type"),
    customer_id: int | None = Query(None),
    search: str | None = Query(None, description="Match order_ref / customer / PO / Samsung PO"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    token_data: TokenData = Depends(
        require_role("sales", "accountant", "manager", "admin")
    ),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Paginated, filterable list from v_unified_orders."""
    conditions: list[str] = ["1=1"]
    params: list = []
    idx = 1

    if status:
        conditions.append(f"order_status = ${idx}")
        params.append(status)
        idx += 1
    if ar_state:
        conditions.append(f"ar_state = ${idx}")
        params.append(ar_state)
        idx += 1
    if source_type:
        conditions.append(f"source_type = ${idx}")
        params.append(source_type)
        idx += 1
    if customer_id:
        conditions.append(f"customer_id = ${idx}")
        params.append(customer_id)
        idx += 1
    if search:
        conditions.append(
            f"(order_ref ILIKE ${idx} OR customer_name ILIKE ${idx} "
            f"OR COALESCE(po_number,'') ILIKE ${idx} "
            f"OR COALESCE(samsung_po_number,'') ILIKE ${idx})"
        )
        params.append(f"%{search}%")
        idx += 1

    where = " AND ".join(conditions)

    total = await conn.fetchval(
        f"SELECT COUNT(*) FROM v_unified_orders WHERE {where}", *params
    )

    params.extend([limit, offset])
    rows = await conn.fetch(
        f"""
        SELECT *
          FROM v_unified_orders
         WHERE {where}
         ORDER BY order_date DESC NULLS LAST, order_id DESC
         LIMIT ${idx} OFFSET ${idx + 1}
        """,
        *params,
    )
    return {"data": [dict(r) for r in rows], "total": total or 0}
