"""IMV nightly sync — fetches all 6 entity types in one Playwright session."""

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


# ─── INSERT specs per entity ──────────────────────────────────

UPSERT_SPECS = {
    'rfq': {
        'table': 'imv_rfq',
        'cols': [
            'rfq_number', 'status_text', 'handler_name', 'handler_login',
            'customer_name', 'customer_facility', 'customer_item_code',
            'item_code', 'product_name', 'model', 'spec', 'maker',
            'unit', 'quantity', 'offered_qty',
            'request_date', 'due_date', 'due_time',
            'doc_type', 'flow_status', 'request_id',
            'item_code_internal', 'requester_id', 'raw_xml',
        ],
        'conflict': '(rfq_number, item_code)',
        'update_cols': ['status_text', 'flow_status', 'handler_name',
                        'due_date', 'due_time', 'offered_qty'],
    },
    'orders': {
        'table': 'imv_orders',
        'cols': [
            'status_text', 'order_type', 'order_date', 'delivery_due',
            'po_number', 'handler_name', 'handler_login', 'requester_name',
            'customer_name', 'customer_facility',
            'item_code', 'product_name', 'spec', 'model', 'maker',
            'unit', 'origin_country', 'tax_label',
            'quantity', 'currency', 'unit_price', 'amount',
            'delivery_address', 'order_method',
            'po_internal_number', 'raw_xml',
        ],
        'conflict': '(po_internal_number, item_code)',
        'update_cols': ['status_text', 'delivery_due', 'quantity',
                        'unit_price', 'amount', 'handler_name'],
    },
    'deliveries': {
        'table': 'imv_deliveries',
        'cols': [
            'delivery_type', 'ship_to', 'order_no_internal',
            'item_code', 'product_name', 'spec',
            'due_date', 'shipped_date', 'confirmed_date',
            'quantity', 'confirmed_qty', 'origin_country', 'unit',
            'customer_name', 'customer_facility', 'customer_dept',
            'po_number', 'delivery_address',
            'status', 'stage', 'stage2',
            'shipment_id', 'supplier_name', 'raw_xml',
        ],
        'conflict': '(shipment_id, item_code)',
        'update_cols': ['shipped_date', 'confirmed_date', 'confirmed_qty',
                        'status', 'stage', 'stage2'],
    },
    'payments': {
        'table': 'imv_payments',
        'cols': [
            'payment_target', 'paying_entity', 'payment_method',
            'invoice_id', 'invoice_date',
            'order_no', 'po_no', 'amount_id', 'shipment_id',
            'item_code', 'product_name', 'model',
            'quantity', 'unit', 'currency',
            'unit_price', 'total_amount', 'tax_label',
            'customer_code', 'customer_name', 'customer_dept',
            'payment_type', 'raw_xml',
        ],
        'conflict': '(invoice_id, item_code)',
        'update_cols': ['invoice_date', 'total_amount', 'payment_type',
                        'paying_entity'],
    },
    'contracts': {
        'table': 'imv_contracts',
        'cols': [
            'contract_id', 'contract_date', 'customer_name', 'customer_facility',
            'item_code', 'product_name', 'quantity', 'unit',
            'unit_price', 'total_amount', 'currency',
            'status_text', 'rfq_number', 'raw_xml',
        ],
        'conflict': '(contract_id, item_code)',
        'update_cols': ['status_text', 'total_amount'],
    },
    'rejections': {
        'table': 'imv_rejections',
        'cols': [
            'rejection_id', 'rejection_date', 'shipment_id',
            'customer_name', 'item_code', 'product_name',
            'quantity', 'reason', 'status_text', 'raw_xml',
        ],
        'conflict': '(rejection_id, item_code)',
        'update_cols': ['status_text', 'reason'],
    },
}


# ─── Cron ─────────────────────────────────────────────────────

@app.periodic(cron='50 23 * * *')
@app.task(name='imv_nightly_sync', queue='imv')
def imv_nightly_sync(timestamp: int = 0) -> dict[str, Any]:
    """Sync all IMV entities once per night."""
    started_at = datetime.now(timezone.utc)
    logger.info('imv_nightly_sync: starting (utc=%s)', started_at.isoformat())

    summary: dict[str, Any] = {}
    t0 = time.monotonic()

    try:
        from app.etl.imv_playwright import fetch_all_imv_grids
        all_data = asyncio.run(fetch_all_imv_grids())

        for entity, rows in all_data.items():
            entity_summary = _sync_entity(entity, rows)
            summary[entity] = entity_summary
    except Exception as exc:
        logger.exception('imv_nightly_sync top-level error: %s', exc)
        summary['_error'] = str(exc)[:500]

    summary['duration_seconds'] = round(time.monotonic() - t0, 2)
    logger.info('imv_nightly_sync done in %ss: %s', summary['duration_seconds'], summary)
    return summary


def _sync_entity(entity: str, rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Upsert rows for a single entity + write a sync_log row."""
    sync_id = _create_sync_log(entity)
    result = {
        'status': 'running',
        'total_records': len(rows),
        'new_records': 0,
        'updated_records': 0,
        'duration_seconds': 0.0,
    }
    t0 = time.monotonic()
    try:
        new_count, upd_count = _upsert_rows(entity, rows)
        result['new_records'] = new_count
        result['updated_records'] = upd_count
        result['status'] = 'success'
    except Exception as exc:
        logger.exception('imv: entity %s upsert failed: %s', entity, exc)
        result['status'] = 'error'
        result['error_message'] = str(exc)[:500]
    finally:
        result['duration_seconds'] = round(time.monotonic() - t0, 2)
        _update_sync_log(sync_id, result, entity_type=entity)
    return result


# ─── DB helpers ───────────────────────────────────────────────


def _create_sync_log(entity: str = 'rfq') -> int:
    conn = psycopg2.connect(SYNC_DSN)
    try:
        with conn, conn.cursor() as cur:
            cur.execute(
                "INSERT INTO imv_sync_log (status, entity_type) VALUES ('running', %s) RETURNING id",
                (entity,),
            )
            return cur.fetchone()[0]
    finally:
        conn.close()


def _update_sync_log(log_id: int, result: dict[str, Any], entity_type: str = 'rfq') -> None:
    conn = psycopg2.connect(SYNC_DSN)
    try:
        with conn, conn.cursor() as cur:
            cur.execute(
                """
                UPDATE imv_sync_log SET
                  status = %s, total_records = %s,
                  new_records = %s, updated_records = %s,
                  error_message = %s, duration_seconds = %s,
                  entity_type = %s, finished_at = NOW()
                WHERE id = %s
                """,
                (
                    result['status'],
                    result.get('total_records', 0),
                    result.get('new_records', 0),
                    result.get('updated_records', 0),
                    result.get('error_message'),
                    result.get('duration_seconds', 0),
                    entity_type,
                    log_id,
                ),
            )
    finally:
        conn.close()


def _upsert_rows(entity: str, rows: list[dict[str, Any]]) -> tuple[int, int]:
    if not rows:
        return 0, 0
    spec = UPSERT_SPECS.get(entity)
    if not spec:
        raise ValueError(f'unknown entity {entity}')

    cols = spec['cols']
    table = spec['table']
    conflict = spec['conflict']
    update_cols = spec['update_cols']

    placeholders = ', '.join(f'%({c})s' for c in cols)
    col_list = ', '.join(cols)
    update_set = ', '.join(f'{c} = EXCLUDED.{c}' for c in update_cols)
    if update_set:
        update_set += ', last_seen_at = NOW(), updated_at = NOW()'
    else:
        update_set = 'last_seen_at = NOW(), updated_at = NOW()'

    sql = (
        f"INSERT INTO {table} ({col_list}) VALUES ({placeholders}) "
        f"ON CONFLICT {conflict} DO UPDATE SET {update_set} "
        "RETURNING (xmax = 0) AS is_insert"
    )

    new_count = 0
    upd_count = 0
    conn = psycopg2.connect(SYNC_DSN)
    try:
        with conn, conn.cursor() as cur:
            for row in rows:
                # Provide defaults for missing keys to keep psycopg2 happy
                record = {c: row.get(c) for c in cols}
                try:
                    cur.execute(sql, record)
                    fetched = cur.fetchone()
                    if fetched and fetched[0]:
                        new_count += 1
                    else:
                        upd_count += 1
                except Exception as exc:
                    logger.warning('imv: row upsert failed for %s: %s', entity, exc)
    finally:
        conn.close()

    return new_count, upd_count


# ─── Backward compat: keep old _upsert_rfqs name for the API thread sync ──

def _upsert_rfqs(rows: list[dict[str, Any]]) -> tuple[int, int]:
    return _upsert_rows('rfq', rows)
