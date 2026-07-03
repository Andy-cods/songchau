"""IMV API — generic list + KPI for all 5 entity types + sync trigger."""

from __future__ import annotations

import asyncio
import logging
import threading
from typing import Any, Optional

import asyncpg
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query

from app.core.database import get_db
from app.core.rbac import require_role
from app.core.security import TokenData

logger = logging.getLogger(__name__)
router = APIRouter()


# ─── Entity registry for read endpoints ─────────────────────

ENTITY_TABLES = {
    'rfq': {
        'table': 'imv_rfq',
        'select': '*',
        'order': 'request_date DESC NULLS LAST, due_date ASC NULLS LAST, id DESC',
        'search_cols': ['rfq_number', 'item_code', 'product_name'],
    },
    'orders': {
        'table': 'imv_orders',
        'select': '*',
        'order': 'order_date DESC NULLS LAST, delivery_due ASC NULLS LAST, id DESC',
        'search_cols': ['po_number', 'po_internal_number', 'item_code', 'product_name'],
    },
    'deliveries': {
        'table': 'imv_deliveries',
        'select': '*',
        'order': 'shipped_date DESC NULLS LAST, due_date DESC NULLS LAST, id DESC',
        'search_cols': ['shipment_id', 'po_number', 'item_code', 'product_name'],
    },
    'payments': {
        'table': 'imv_payments',
        'select': '*',
        'order': 'invoice_date DESC NULLS LAST, id DESC',
        'search_cols': ['invoice_id', 'po_no', 'item_code', 'product_name'],
    },
    'contracts': {
        'table': 'imv_contracts',
        'select': '*',
        'order': 'contract_date DESC NULLS LAST, id DESC',
        'search_cols': ['contract_id', 'item_code', 'product_name'],
    },
    'rejections': {
        'table': 'imv_rejections',
        'select': '*',
        'order': 'rejection_date DESC NULLS LAST, id DESC',
        'search_cols': ['rejection_id', 'shipment_id', 'item_code'],
    },
}


@router.get('/stats')
async def imv_stats(
    months: int = Query(12, ge=1, le=36, description="Window theo tháng cho gần đây"),
    token_data: TokenData = Depends(
        require_role('staff', 'manager', 'admin', 'procurement', 'sales', 'accountant', 'director')
    ),
    conn: asyncpg.Connection = Depends(get_db),
) -> dict[str, Any]:
    """IMV KPI dashboard: giá trị PO + số báo giá + qty.

    Thang 2026-05-23: trả KPI cho IMV dashboard:
    - Tổng giá trị PO (imv_orders.amount) tất cả + trong window
    - Số RFQ tổng + đã báo giá (offered_qty > 0 hoặc flow_status quoted)
    - Tổng qty đã hỏi + đã chào
    """
    # PO value
    po_row = await conn.fetchrow(
        """
        SELECT
            COUNT(*)::int AS po_count,
            COALESCE(SUM(amount), 0)::numeric AS total_value,
            COALESCE(SUM(CASE WHEN order_date >= NOW() - ($1 || ' months')::interval THEN amount END), 0)::numeric AS value_in_window,
            COUNT(*) FILTER (WHERE order_date >= NOW() - ($1 || ' months')::interval)::int AS po_count_in_window
        FROM imv_orders
        """,
        str(months),
    )

    # RFQ + quote stats
    rfq_row = await conn.fetchrow(
        """
        SELECT
            COUNT(*)::int AS total_rfq,
            COUNT(*) FILTER (WHERE offered_qty IS NOT NULL AND offered_qty > 0)::int AS quoted_rfq,
            COUNT(*) FILTER (WHERE flow_status::text ILIKE '%quoted%' OR flow_status::text ILIKE '%won%' OR flow_status::text ILIKE '%accepted%')::int AS flow_quoted,
            COALESCE(SUM(quantity), 0)::numeric AS total_qty_requested,
            COALESCE(SUM(offered_qty), 0)::numeric AS total_qty_quoted,
            COUNT(*) FILTER (WHERE request_date >= NOW() - ($1 || ' months')::interval)::int AS rfq_in_window,
            COUNT(*) FILTER (WHERE request_date >= NOW() - ($1 || ' months')::interval AND offered_qty IS NOT NULL AND offered_qty > 0)::int AS quoted_in_window
        FROM imv_rfq
        """,
        str(months),
    )

    # Top customers by PO value
    top_customers = await conn.fetch(
        """
        SELECT
            COALESCE(NULLIF(BTRIM(customer_name), ''), 'Không rõ') AS customer_name,
            COUNT(*)::int AS po_count,
            COALESCE(SUM(amount), 0)::numeric AS total_value
        FROM imv_orders
        GROUP BY 1
        ORDER BY total_value DESC NULLS LAST
        LIMIT 5
        """,
    )

    # Monthly trend (12M)
    trend = await conn.fetch(
        """
        SELECT
            TO_CHAR(DATE_TRUNC('month', request_date), 'YYYY-MM') AS month_key,
            COUNT(*)::int AS rfq_count,
            COUNT(*) FILTER (WHERE offered_qty > 0)::int AS quoted_count,
            COALESCE(SUM(quantity), 0)::numeric AS qty_requested
        FROM imv_rfq
        WHERE request_date >= NOW() - ($1 || ' months')::interval
        GROUP BY 1
        ORDER BY 1
        """,
        str(months),
    )

    def _f(v: Any) -> float | None:
        if v is None:
            return None
        try:
            return float(v)
        except (TypeError, ValueError):
            return None

    po_dict = dict(po_row or {})
    rfq_dict = dict(rfq_row or {})
    total_rfq = rfq_dict.get('total_rfq', 0) or 0
    quoted_rfq = rfq_dict.get('quoted_rfq', 0) or 0
    quote_rate = (quoted_rfq / total_rfq * 100) if total_rfq else 0

    return {
        "data": {
            "window_months": months,
            "po": {
                "total_count": po_dict.get('po_count', 0),
                "total_value_vnd": _f(po_dict.get('total_value')),
                "value_in_window_vnd": _f(po_dict.get('value_in_window')),
                "count_in_window": po_dict.get('po_count_in_window', 0),
            },
            "rfq": {
                "total": total_rfq,
                "quoted_by_offered_qty": quoted_rfq,
                "quoted_by_status": rfq_dict.get('flow_quoted', 0),
                "quote_rate_pct": round(quote_rate, 1),
                "total_qty_requested": _f(rfq_dict.get('total_qty_requested')),
                "total_qty_quoted": _f(rfq_dict.get('total_qty_quoted')),
                "rfq_in_window": rfq_dict.get('rfq_in_window', 0),
                "quoted_in_window": rfq_dict.get('quoted_in_window', 0),
            },
            "top_customers": [
                {
                    "customer_name": r["customer_name"],
                    "po_count": r["po_count"],
                    "total_value_vnd": _f(r["total_value"]),
                }
                for r in top_customers
            ],
            "monthly_trend": [
                {
                    "month_key": r["month_key"],
                    "rfq_count": r["rfq_count"],
                    "quoted_count": r["quoted_count"],
                    "qty_requested": _f(r["qty_requested"]),
                }
                for r in trend
            ],
        }
    }


@router.get('/{entity}/list')
async def list_entity(
    entity: str,
    q: Optional[str] = Query(None),
    customer: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    token_data: TokenData = Depends(
        require_role('staff', 'manager', 'admin', 'procurement', 'sales', 'accountant')
    ),
    conn: asyncpg.Connection = Depends(get_db),
) -> dict[str, Any]:
    """Generic paginated list for any IMV entity."""
    spec = ENTITY_TABLES.get(entity)
    if not spec:
        raise HTTPException(404, f'Unknown entity: {entity}. Use one of: {list(ENTITY_TABLES.keys())}')

    where = ['1=1']
    params: list = []
    idx = 1
    if q:
        clauses = ' OR '.join(f'{c} ILIKE ${idx}' for c in spec['search_cols'])
        where.append(f'({clauses})')
        params.append(f'%{q}%')
        idx += 1
    if customer:
        where.append(f"COALESCE(customer_name,'') ILIKE ${idx}")
        params.append(f'%{customer}%')
        idx += 1

    sql_where = ' AND '.join(where)

    total = await conn.fetchval(
        f"SELECT COUNT(*) FROM {spec['table']} WHERE {sql_where}", *params
    )
    rows = await conn.fetch(
        f"SELECT {spec['select']} FROM {spec['table']} WHERE {sql_where} "
        f"ORDER BY {spec['order']} LIMIT ${idx} OFFSET ${idx + 1}",
        *params, limit, offset,
    )
    return {
        'data': {
            'items': [dict(r) for r in rows],
            'total': total,
            'limit': limit,
            'offset': offset,
        }
    }


@router.get('/rfq')
async def list_rfq_compat(
    q: Optional[str] = Query(None),
    customer: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    token_data: TokenData = Depends(
        require_role('staff', 'manager', 'admin', 'procurement', 'sales', 'accountant')
    ),
    conn: asyncpg.Connection = Depends(get_db),
) -> dict[str, Any]:
    """Backward-compat alias for /rfq (keeps old frontend working)."""
    return await list_entity.__wrapped__('rfq', q, customer, limit, offset, token_data, conn) if hasattr(list_entity, '__wrapped__') else await list_entity(entity='rfq', q=q, customer=customer, limit=limit, offset=offset, token_data=token_data, conn=conn)


@router.get('/kpi')
async def kpi(
    token_data: TokenData = Depends(
        require_role('staff', 'manager', 'admin', 'procurement', 'sales', 'accountant')
    ),
    conn: asyncpg.Connection = Depends(get_db),
) -> dict[str, Any]:
    """Aggregate KPI across all 5 entities."""
    rfq_row = await conn.fetchrow(
        """
        SELECT COUNT(*) AS total,
               COUNT(*) FILTER (WHERE due_date >= CURRENT_DATE) AS open_rfq,
               COUNT(*) FILTER (WHERE due_date < CURRENT_DATE) AS overdue,
               COUNT(*) FILTER (WHERE due_date = CURRENT_DATE) AS due_today,
               COUNT(DISTINCT customer_name) AS customers,
               COUNT(DISTINCT handler_login) AS handlers,
               MAX(last_seen_at) AS last_sync
        FROM imv_rfq
        """
    )
    counts = {}
    for entity, spec in ENTITY_TABLES.items():
        counts[entity] = await conn.fetchval(f"SELECT COUNT(*) FROM {spec['table']}")

    last_sync_per_entity = {}
    rows = await conn.fetch(
        "SELECT DISTINCT ON (entity_type) entity_type, status, total_records, "
        "new_records, updated_records, started_at, finished_at, duration_seconds, error_message "
        "FROM imv_sync_log ORDER BY entity_type, started_at DESC"
    )
    for r in rows:
        last_sync_per_entity[r['entity_type']] = dict(r)

    last_sync_overall = await conn.fetchrow(
        "SELECT status, total_records, new_records, updated_records, error_message, "
        "started_at, finished_at, duration_seconds "
        "FROM imv_sync_log ORDER BY started_at DESC LIMIT 1"
    )

    return {
        'kpi': dict(rfq_row) if rfq_row else {},
        'counts': counts,
        'last_sync_per_entity': last_sync_per_entity,
        'last_sync': dict(last_sync_overall) if last_sync_overall else None,
    }


@router.post('/sync')
async def trigger_sync(
    background_tasks: BackgroundTasks,
    entities: Optional[str] = Query(None, description='Comma-separated entity list (default: all)'),
    token_data: TokenData = Depends(require_role('admin', 'manager', 'procurement')),
    conn: asyncpg.Connection = Depends(get_db),
) -> dict[str, Any]:
    """Trigger sync — runs Playwright in a thread, syncs all (or specified) entities."""

    # Reject if any entity is currently syncing
    running = await conn.fetchval(
        "SELECT id FROM imv_sync_log WHERE status = 'running' "
        "AND started_at > NOW() - INTERVAL '15 minutes' LIMIT 1"
    )
    if running:
        raise HTTPException(409, f'Sync IMV đang chạy (job #{running}). Vui lòng đợi.')

    target = None
    if entities:
        target = [e.strip() for e in entities.split(',') if e.strip()]

    logger.info('imv /sync triggered: entities=%s by user=%s', target or 'all', token_data.user_id)

    def _thread_sync(target_entities):
        import asyncio as _aio
        import time as _time
        from app.etl.imv_playwright import fetch_all_imv_grids
        from app.tasks.imv_sync import _sync_entity

        try:
            loop = _aio.new_event_loop()
            try:
                all_data = loop.run_until_complete(fetch_all_imv_grids(entities=target_entities))
            finally:
                loop.close()

            for ent, rows in all_data.items():
                try:
                    _sync_entity(ent, rows)
                except Exception as exc:
                    logger.exception('imv: per-entity sync %s failed: %s', ent, exc)
        except Exception as exc:
            logger.exception('imv: thread sync failed: %s', exc)

    threading.Thread(target=_thread_sync, args=(target,), daemon=True).start()

    return {
        'message': f'Đã bắt đầu sync IMV (entities={target or "all"})',
        'entities': target or list(ENTITY_TABLES.keys()),
    }


@router.get('/sync-history')
async def sync_history(
    entity: Optional[str] = Query(None),
    limit: int = Query(20, ge=1, le=100),
    token_data: TokenData = Depends(
        require_role('staff', 'manager', 'admin', 'procurement', 'sales')
    ),
    conn: asyncpg.Connection = Depends(get_db),
) -> dict[str, Any]:
    where = '1=1'
    params: list = []
    if entity:
        where = 'entity_type = $1'
        params.append(entity)
    rows = await conn.fetch(
        f"SELECT id, status, entity_type, total_records, new_records, updated_records, "
        f"error_message, started_at, finished_at, duration_seconds "
        f"FROM imv_sync_log WHERE {where} "
        f"ORDER BY started_at DESC LIMIT ${len(params)+1}",
        *params, limit,
    )
    return {'data': [dict(r) for r in rows]}
