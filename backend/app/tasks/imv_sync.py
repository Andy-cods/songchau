"""IMV nightly sync task — runs every day at 23:50.

Mirrors bqms_sync architecture: Playwright async fetch, then sync DB
upsert via psycopg2.
"""

from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime, timezone
from typing import Any

import psycopg2
import psycopg2.extras

from app.core.procrastinate_app import app, SYNC_DSN

logger = logging.getLogger(__name__)


@app.periodic(cron='50 23 * * *')
@app.task(name='imv_nightly_sync', queue='imv')
def imv_nightly_sync(timestamp: int = 0) -> dict[str, Any]:
    """Sync IMV RFQ list once per night."""
    started_at = datetime.now(timezone.utc)
    logger.info('imv_nightly_sync: starting (utc=%s)', started_at.isoformat())

    sync_id = _create_sync_log()
    result: dict[str, Any] = {
        'total_records': 0,
        'new_records': 0,
        'updated_records': 0,
        'duration_seconds': 0.0,
        'status': 'running',
    }
    t0 = time.monotonic()

    try:
        from app.etl.imv_playwright import fetch_imv_rfqs

        rows = asyncio.run(fetch_imv_rfqs(rows_per_page=200, max_pages=10))
        result['total_records'] = len(rows)

        new_count, updated_count = _upsert_rfqs(rows)
        result['new_records'] = new_count
        result['updated_records'] = updated_count
        result['status'] = 'success'

        logger.info('imv_sync: %d total, %d new, %d updated', len(rows), new_count, updated_count)
    except Exception as exc:
        logger.exception('imv_nightly_sync: error: %s', exc)
        result['status'] = 'error'
        result['error_message'] = str(exc)[:500]
    finally:
        result['duration_seconds'] = round(time.monotonic() - t0, 2)
        _update_sync_log(sync_id, result)

    return result


# ─── DB helpers ───────────────────────────────────────────────


def _create_sync_log() -> int:
    conn = psycopg2.connect(SYNC_DSN)
    try:
        with conn, conn.cursor() as cur:
            cur.execute(
                "INSERT INTO imv_sync_log (status) VALUES ('running') RETURNING id"
            )
            return cur.fetchone()[0]
    finally:
        conn.close()


def _update_sync_log(log_id: int, result: dict[str, Any]) -> None:
    conn = psycopg2.connect(SYNC_DSN)
    try:
        with conn, conn.cursor() as cur:
            cur.execute(
                """
                UPDATE imv_sync_log SET
                  status = %s,
                  total_records = %s,
                  new_records = %s,
                  updated_records = %s,
                  error_message = %s,
                  duration_seconds = %s,
                  finished_at = NOW()
                WHERE id = %s
                """,
                (
                    result['status'],
                    result.get('total_records', 0),
                    result.get('new_records', 0),
                    result.get('updated_records', 0),
                    result.get('error_message'),
                    result.get('duration_seconds', 0),
                    log_id,
                ),
            )
    finally:
        conn.close()


def _upsert_rfqs(rows: list[dict[str, Any]]) -> tuple[int, int]:
    if not rows:
        return 0, 0

    conn = psycopg2.connect(SYNC_DSN)
    new_count = 0
    updated_count = 0
    try:
        with conn, conn.cursor() as cur:
            for r in rows:
                cur.execute(
                    """
                    INSERT INTO imv_rfq (
                      rfq_number, status_text, handler_name, handler_login,
                      customer_name, customer_facility, customer_item_code,
                      item_code, product_name, model, spec, maker,
                      unit, quantity, offered_qty,
                      request_date, due_date, due_time,
                      doc_type, flow_status, request_id,
                      item_code_internal, requester_id, raw_xml
                    ) VALUES (
                      %(rfq_number)s, %(status_text)s, %(handler_name)s, %(handler_login)s,
                      %(customer_name)s, %(customer_facility)s, %(customer_item_code)s,
                      %(item_code)s, %(product_name)s, %(model)s, %(spec)s, %(maker)s,
                      %(unit)s, %(quantity)s, %(offered_qty)s,
                      %(request_date)s, %(due_date)s, %(due_time)s,
                      %(doc_type)s, %(flow_status)s, %(request_id)s,
                      %(item_code_internal)s, %(requester_id)s, %(raw_xml)s
                    )
                    ON CONFLICT (rfq_number, item_code) DO UPDATE SET
                      status_text = EXCLUDED.status_text,
                      flow_status = EXCLUDED.flow_status,
                      handler_name = EXCLUDED.handler_name,
                      due_date = EXCLUDED.due_date,
                      due_time = EXCLUDED.due_time,
                      offered_qty = EXCLUDED.offered_qty,
                      last_seen_at = NOW(),
                      updated_at = NOW()
                    RETURNING (xmax = 0) AS is_insert
                    """,
                    r,
                )
                row = cur.fetchone()
                if row and row[0]:
                    new_count += 1
                else:
                    updated_count += 1
    finally:
        conn.close()

    return new_count, updated_count
