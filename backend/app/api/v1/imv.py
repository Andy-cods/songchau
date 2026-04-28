"""IMV API — list RFQs + manual sync trigger + status."""

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


@router.get('/rfq')
async def list_rfq(
    q: Optional[str] = Query(None, description='Search across rfq_number / item_code / product_name'),
    status: Optional[str] = Query(None),
    customer: Optional[str] = Query(None),
    handler: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    token_data: TokenData = Depends(
        require_role('staff', 'manager', 'admin', 'procurement', 'sales')
    ),
    conn: asyncpg.Connection = Depends(get_db),
) -> dict[str, Any]:
    """Paginated RFQ list from imv_rfq."""
    where = ['1=1']
    params: list = []
    idx = 1
    if q:
        where.append(f'(rfq_number ILIKE ${idx} OR item_code ILIKE ${idx} OR product_name ILIKE ${idx})')
        params.append(f'%{q}%')
        idx += 1
    if status:
        where.append(f'flow_status = ${idx}')
        params.append(status)
        idx += 1
    if customer:
        where.append(f'customer_name ILIKE ${idx}')
        params.append(f'%{customer}%')
        idx += 1
    if handler:
        where.append(f'(handler_login ILIKE ${idx} OR handler_name ILIKE ${idx})')
        params.append(f'%{handler}%')
        idx += 1

    sql_where = ' AND '.join(where)

    total = await conn.fetchval(
        f'SELECT COUNT(*) FROM imv_rfq WHERE {sql_where}', *params
    )

    rows = await conn.fetch(
        f"""
        SELECT id, rfq_number, status_text, handler_name, handler_login,
               customer_name, customer_facility, customer_item_code,
               item_code, product_name, model, spec, maker,
               unit, quantity, offered_qty,
               request_date, due_date, due_time,
               doc_type, flow_status, request_id,
               last_seen_at
        FROM imv_rfq WHERE {sql_where}
        ORDER BY request_date DESC NULLS LAST, due_date ASC NULLS LAST, id DESC
        LIMIT ${idx} OFFSET ${idx + 1}
        """,
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


@router.get('/kpi')
async def kpi(
    token_data: TokenData = Depends(
        require_role('staff', 'manager', 'admin', 'procurement', 'sales')
    ),
    conn: asyncpg.Connection = Depends(get_db),
) -> dict[str, Any]:
    row = await conn.fetchrow(
        """
        SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE due_date >= CURRENT_DATE) AS open_rfq,
          COUNT(*) FILTER (WHERE due_date < CURRENT_DATE) AS overdue,
          COUNT(*) FILTER (WHERE due_date = CURRENT_DATE) AS due_today,
          COUNT(DISTINCT customer_name) AS customers,
          COUNT(DISTINCT handler_login) AS handlers,
          MAX(last_seen_at) AS last_sync
        FROM imv_rfq
        """,
    )
    last_sync_log = await conn.fetchrow(
        "SELECT status, total_records, new_records, updated_records, error_message, "
        "started_at, finished_at, duration_seconds "
        "FROM imv_sync_log ORDER BY started_at DESC LIMIT 1"
    )
    return {
        'kpi': dict(row) if row else {},
        'last_sync': dict(last_sync_log) if last_sync_log else None,
    }


@router.post('/sync')
async def trigger_sync(
    background_tasks: BackgroundTasks,
    token_data: TokenData = Depends(require_role('admin', 'manager', 'procurement')),
    conn: asyncpg.Connection = Depends(get_db),
) -> dict[str, Any]:
    """Manual sync trigger — runs Playwright fetch in a dedicated thread.

    Mirrors bqms /sync pattern: Playwright needs its own asyncio loop, so we
    spawn a thread that runs the fetch + upsert + sync_log update.
    """
    # Reject if a sync is already running
    running = await conn.fetchval(
        "SELECT id FROM imv_sync_log WHERE status = 'running' "
        "AND started_at > NOW() - INTERVAL '15 minutes' "
        "ORDER BY started_at DESC LIMIT 1"
    )
    if running:
        raise HTTPException(409, f'Sync IMV đang chạy (job #{running}). Vui lòng đợi.')

    sync_id = await conn.fetchval(
        "INSERT INTO imv_sync_log (status) VALUES ('running') RETURNING id"
    )
    logger.info('imv /sync triggered: job_id=%s by user=%s', sync_id, token_data.user_id)

    def _thread_sync(sid: int):
        import asyncio as _aio
        import time as _time
        import psycopg2

        async def _do():
            from app.etl.imv_playwright import fetch_imv_rfqs
            return await fetch_imv_rfqs(rows_per_page=200, max_pages=10)

        from app.core.procrastinate_app import SYNC_DSN
        from app.tasks.imv_sync import _upsert_rfqs, _update_sync_log

        result = {
            'status': 'running',
            'total_records': 0,
            'new_records': 0,
            'updated_records': 0,
            'duration_seconds': 0.0,
        }
        t0 = _time.monotonic()

        try:
            loop = _aio.new_event_loop()
            try:
                rows = loop.run_until_complete(_do())
            finally:
                loop.close()
            result['total_records'] = len(rows)
            new_count, upd_count = _upsert_rfqs(rows)
            result['new_records'] = new_count
            result['updated_records'] = upd_count
            result['status'] = 'success'
        except Exception as exc:
            logger.exception('imv /sync failed: %s', exc)
            result['status'] = 'error'
            result['error_message'] = str(exc)[:500]
        finally:
            result['duration_seconds'] = round(_time.monotonic() - t0, 2)
            try:
                _update_sync_log(sid, result)
            except Exception as exc2:
                logger.error('imv sync_log update failed: %s', exc2)

    threading.Thread(target=_thread_sync, args=(sync_id,), daemon=True).start()

    return {
        'message': 'Đã bắt đầu sync IMV (chạy nền)',
        'job_id': sync_id,
    }


@router.get('/sync-history')
async def sync_history(
    limit: int = Query(20, ge=1, le=100),
    token_data: TokenData = Depends(
        require_role('staff', 'manager', 'admin', 'procurement', 'sales')
    ),
    conn: asyncpg.Connection = Depends(get_db),
) -> dict[str, Any]:
    rows = await conn.fetch(
        "SELECT id, status, total_records, new_records, updated_records, "
        "error_message, started_at, finished_at, duration_seconds "
        "FROM imv_sync_log ORDER BY started_at DESC LIMIT $1",
        limit,
    )
    return {'data': [dict(r) for r in rows]}
