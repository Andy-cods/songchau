"""
BQMS Nightly Sync Task — runs at 23:30 every day.

Steps
-----
1. Login to Samsung BQMS via 4-step MFA (samsung_bqms_client.py).
2. Fetch all Purchase Orders created/updated in the last 30 days.
3. Upsert new POs into bqms_samsung_po table.
4. Download PDFs for newly inserted POs.
5. Refresh the bqms_kpi materialized view.
6. Log result to etl_sync_log.
7. Emit bqms_sync_done WebSocket event.

Uses asyncio.run() to bridge Procrastinate sync → async SamsungBQMSClient.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import psycopg2
import psycopg2.extras

from app.core.config import settings
from app.core.procrastinate_app import app, SYNC_DSN

logger = logging.getLogger(__name__)

BQMS_PDF_DIR = Path(settings.FILES_BASE_PATH) / "bqms" / "po_pdfs"


def _split_item_spec(s: Any) -> tuple[str | None, str | None]:
    """Split a combined '<ItemName>\\n<Spec>' value into (item_name, spec).

    SPLIT RULE (identical across all three write-paths + the SQL backfill):
      item_name = trim(text BEFORE the first '\\n')
      spec      = trim(text AFTER  the first '\\n')
      If there is NO '\\n', item_name is None and spec is the trimmed input.

    Returns (None, None) for an empty/None input.
    """
    if s is None:
        return None, None
    raw = str(s)
    if "\n" not in raw:
        stripped = raw.strip()
        return None, (stripped or None)
    head, tail = raw.split("\n", 1)
    item_name = head.strip() or None
    spec = tail.strip() or None
    return item_name, spec


# ---------------------------------------------------------------------------
# Periodic task — 23:30 every day
# ---------------------------------------------------------------------------

@app.periodic(cron="30 23 * * *")
@app.task(name="bqms_nightly_sync", queue="bqms")
def bqms_nightly_sync(timestamp: int = 0) -> dict[str, Any]:
    """Nightly Samsung BQMS synchronisation."""
    started_at = datetime.now(timezone.utc)
    logger.info("bqms_nightly_sync: starting (utc=%s)", started_at.isoformat())

    result: dict[str, Any] = {
        "new_pos": 0,
        "updated_pos": 0,
        "pdfs_downloaded": 0,
        "errors": 0,
        "duration_seconds": 0.0,
        "synced_at": started_at.isoformat(),
        "status": "running",
    }

    t0 = time.monotonic()
    sync_id = _create_sync_log("running")

    try:
        date_from = date.today() - timedelta(days=30)
        date_to = date.today()

        # Run the async sync pipeline
        sync_result = asyncio.run(_async_sync_pipeline(date_from, date_to))
        result.update(sync_result)
        result["status"] = "success"

        # Refresh materialized view
        _refresh_bqms_kpi()
        logger.info("bqms_nightly_sync: bqms_kpi refreshed")

    except Exception as exc:
        logger.exception("bqms_nightly_sync: error: %s", exc)
        result["errors"] += 1
        result["error_message"] = str(exc)[:500]
        result["status"] = "error"

    finally:
        result["duration_seconds"] = round(time.monotonic() - t0, 2)

    # Update sync log
    _update_sync_log(sync_id, result)

    # Emit WebSocket event
    _emit_sync_done(result)

    logger.info(
        "bqms_nightly_sync: done new=%d updated=%d pdfs=%d errors=%d %.1fs",
        result["new_pos"], result.get("updated_pos", 0),
        result["pdfs_downloaded"], result["errors"], result["duration_seconds"],
    )
    return result


# ---------------------------------------------------------------------------
# Async sync pipeline — uses the correct SamsungBQMSClient
# ---------------------------------------------------------------------------

async def _async_sync_pipeline(
    date_from: date, date_to: date
) -> dict[str, Any]:
    """
    Async pipeline: Playwright login → extract cookies → httpx API calls.
    Returns partial result dict.
    """
    from app.etl.bqms_playwright import playwright_fetch_pos

    result: dict[str, Any] = {
        "new_pos": 0,
        "updated_pos": 0,
        "pdfs_downloaded": 0,
        "errors": 0,
    }

    # 1+2. Login via Playwright + intercept PO list response
    po_list = await playwright_fetch_pos()
    logger.info("bqms_sync: fetched %d POs from Samsung via Playwright", len(po_list))

    if not po_list:
        return result

    # 3. Upsert POs into database (sync — uses psycopg2)
    new_pos, updated_pos = _upsert_pos(po_list)
    result["new_pos"] = len(new_pos)
    result["updated_pos"] = updated_pos
    logger.info("bqms_sync: %d new, %d updated POs", len(new_pos), updated_pos)

    # 3b. Event-driven notifications for new POs
    if new_pos:
        try:
            from app.services.event_notifications import dispatch_new_po
            from app.core.database import db_pool
            await db_pool.init()
            async with db_pool.acquire() as conn:
                n = await dispatch_new_po(conn, [po_num for po_num, _ in new_pos])
                logger.info("bqms_sync: sent %d new-PO notifications", n)
        except Exception as exc:
            logger.warning("new-PO notification dispatch failed: %s", exc)

    # 4. Bridge: UPSERT tất cả PO → bqms_deliveries (trang Giao Hàng)
    # Chống trùng: po_number + bqms_code
    # Không ghi đè fields user đã sửa (delivery_status, notes, actual_delivered_qty, etc.)
    new_deliveries, updated_deliveries = _bridge_po_to_deliveries(po_list)
    result["deliveries_created"] = new_deliveries
    result["deliveries_updated"] = updated_deliveries
    logger.info("bqms_sync: deliveries %d new, %d updated", new_deliveries, updated_deliveries)

    from app.etl.bqms_playwright import _update_step
    _update_step(6, "done", f"Đã lưu {len(po_list)} PO → Giao Hàng: {new_deliveries} mới, {updated_deliveries} cập nhật")

    return result


# ---------------------------------------------------------------------------
# Database operations (sync psycopg2)
# ---------------------------------------------------------------------------

def _upsert_pos(po_list: list[dict[str, Any]]) -> tuple[list[tuple[str, str]], int]:
    """
    Upsert POs into bqms_samsung_po.

    Returns (new_po_list[(po_number, secure_key)], updated_count).
    Field mapping follows Samsung API response from selectPOAcceptList.do:
      PO_NO, REQ_NO, CIS_CODE, ITEM_CODE, SPECIFICATION, PO_QTY, UNIT_CODE,
      RECEIVER_NAME, PO_CONFIRM_DT, REQ_DELIVERY_DATE, COMPANY_NAME, secureKey, etc.
    """
    if not po_list:
        return [], 0

    conn = psycopg2.connect(SYNC_DSN)
    new_pos: list[tuple[str, str]] = []
    updated = 0

    try:
        with conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            for po in po_list:
                # Samsung API field mapping (from Playwright intercepted response)
                po_number = str(po.get("PO_NO") or po.get("po_number") or "")
                po_seq = str(po.get("PO_SEQ") or po.get("po_seq") or "")
                request_no = str(po.get("REQ_NO") or "")
                vendor_code = str(po.get("SP_CODE") or po.get("vendorCode") or "")
                bqms_code = str(po.get("CIS_CODE") or po.get("ITEM_CODE") or "")
                old_item_code = str(po.get("OLD_ITEM_CODE") or "")
                spec = str(po.get("SPECIFICATION") or "")
                order_qty = po.get("PO_QTY") or po.get("ORDER_QTY") or 0
                unit_price = po.get("UNIT_PRICE") or 0
                amount = po.get("AMOUNT") or 0
                company = str(po.get("COMPANY_NAME") or po.get("COMPANY_CODE") or "")
                secure_key = str(po.get("secureKey") or "")

                # Parse RECEIVER_NAME: "Full Name: mail.prefix"
                receiver = str(po.get("RECEIVER_NAME") or "")
                buyer_name = receiver
                buyer_email = ""
                if ":" in receiver:
                    parts = receiver.split(":", 1)
                    buyer_name = parts[0].strip()
                    buyer_email = parts[1].strip()

                # Parse PO date (unix timestamp ms)
                po_date_raw = po.get("PO_CONFIRM_DT") or po.get("PO_DATE")
                po_date = None
                if isinstance(po_date_raw, (int, float)) and po_date_raw > 1_000_000_000:
                    po_date = datetime.fromtimestamp(po_date_raw / 1000, tz=timezone.utc).date()

                # Parse delivery date (YYYYMMDD string)
                del_date_raw = po.get("REQ_DELIVERY_DATE") or ""
                delivery_date = None
                if isinstance(del_date_raw, str) and len(del_date_raw) >= 8:
                    try:
                        delivery_date = datetime.strptime(del_date_raw[:8], "%Y%m%d").date()
                    except ValueError:
                        pass

                raw_data = psycopg2.extras.Json(po)

                if not po_number:
                    continue

                # Match actual bqms_samsung_po table schema
                cur.execute(
                    """
                    INSERT INTO bqms_samsung_po
                        (po_number, po_seq, request_no, vendor_code,
                         bqms_code, cis_code, old_item_code, specification,
                         order_qty, unit_price, amount,
                         buyer_name, buyer_email, company,
                         po_date, preferred_delivery_date,
                         recipient_name, secure_key, raw_data)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (po_number) DO UPDATE SET
                        bqms_code = EXCLUDED.bqms_code,
                        cis_code = EXCLUDED.cis_code,
                        specification = EXCLUDED.specification,
                        order_qty = EXCLUDED.order_qty,
                        unit_price = EXCLUDED.unit_price,
                        amount = EXCLUDED.amount,
                        buyer_name = EXCLUDED.buyer_name,
                        buyer_email = EXCLUDED.buyer_email,
                        recipient_name = EXCLUDED.recipient_name,
                        secure_key = EXCLUDED.secure_key,
                        raw_data = EXCLUDED.raw_data
                    RETURNING (xmax = 0) AS inserted
                    """,
                    (po_number, po_seq, request_no, vendor_code,
                     bqms_code, bqms_code, old_item_code, spec,
                     order_qty, unit_price, amount,
                     buyer_name, buyer_email, company,
                     po_date, delivery_date,
                     receiver, secure_key, raw_data),
                )
                row = cur.fetchone()
                if row and row["inserted"]:
                    new_pos.append((po_number, secure_key))
                else:
                    updated += 1

    finally:
        conn.close()

    return new_pos, updated


def _bridge_po_to_deliveries(po_list: list[dict[str, Any]]) -> tuple[int, int]:
    """
    UPSERT tất cả PO vào bqms_deliveries (trang Giao Hàng).

    Chống trùng: po_number + bqms_code (unique index).
    Khi trùng: CHỈ update fields từ Samsung (spec, qty, unit_price, amount, recipient).
    KHÔNG ghi đè: delivery_status, delivery_date, actual_delivered_qty,
                   delivery_info, delivery_method, country_origin, notes,
                   total_delivered_value_vnd (do user sửa trên UI).

    Returns: (new_count, updated_count)
    """
    if not po_list:
        return 0, 0

    conn = psycopg2.connect(SYNC_DSN)
    created = 0
    updated = 0

    try:
        with conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            for po in po_list:
                po_number = str(po.get("PO_NO") or "")
                bqms_code = str(po.get("CIS_CODE") or po.get("ITEM_CODE") or "")
                if not po_number or not bqms_code:
                    continue

                item_name, spec = _split_item_spec(po.get("SPECIFICATION"))
                qty = po.get("PO_QTY") or po.get("ORDER_QTY") or 0
                unit = str(po.get("UNIT_CODE") or "EA")
                unit_price = po.get("UNIT_PRICE") or 0
                amount = po.get("AMOUNT") or 0
                quotation_no = str(po.get("REQ_NO") or "")
                shipping_no = str(po.get("PO_SEQ") or "")

                # Parse RECEIVER_NAME: "Full Name: mail.prefix"
                receiver = str(po.get("RECEIVER_NAME") or "")
                recipient_name = receiver
                buyer_email = ""
                if ":" in receiver:
                    parts = receiver.split(":", 1)
                    recipient_name = parts[0].strip()
                    buyer_email = parts[1].strip()

                # PO date (unix ms)
                po_date_raw = po.get("PO_CONFIRM_DT")
                po_date = None
                if isinstance(po_date_raw, (int, float)) and po_date_raw > 1_000_000_000:
                    po_date = datetime.fromtimestamp(po_date_raw / 1000, tz=timezone.utc).date()

                # Delivery date (YYYYMMDD)
                del_raw = str(po.get("REQ_DELIVERY_DATE") or "")
                delivery_date = None
                if len(del_raw) >= 8:
                    try:
                        delivery_date = datetime.strptime(del_raw[:8], "%Y%m%d").date()
                    except ValueError:
                        pass

                sev_type = str(po.get("COMPANY_NAME") or "")

                try:
                    # Chống trùng: check bằng po_number + bqms_code + shipping_no
                    cur.execute(
                        """SELECT id FROM bqms_deliveries
                           WHERE po_number = %s AND bqms_code = %s AND shipping_no = %s
                           LIMIT 1""",
                        (po_number, bqms_code, shipping_no),
                    )
                    existing = cur.fetchone()

                    if existing:
                        # UPDATE chỉ fields từ Samsung — KHÔNG ghi đè fields user sửa
                        cur.execute(
                            """UPDATE bqms_deliveries SET
                                item_name = %s, specification = %s, quantity = %s, unit = %s,
                                unit_price = %s, amount = %s,
                                sev_type = %s, buyer_email = %s, recipient_name = %s,
                                quotation_no = %s, updated_at = NOW()
                            WHERE id = %s""",
                            (item_name, spec, qty, unit, unit_price, amount,
                             sev_type, buyer_email, recipient_name,
                             quotation_no, existing["id"]),
                        )
                        updated += 1
                    else:
                        # INSERT mới
                        cur.execute(
                            """INSERT INTO bqms_deliveries
                                (po_date, po_number, shipping_no, quotation_no, bqms_code,
                                 item_name, specification, quantity, unit, unit_price, amount,
                                 sev_type, buyer_email, recipient_name,
                                 delivery_status, delivery_date, data_source)
                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                                    'chua_giao'::delivery_status, %s, 'samsung_sync')""",
                            (po_date, po_number, shipping_no, quotation_no, bqms_code,
                             item_name, spec, qty, unit, unit_price, amount,
                             sev_type, buyer_email, recipient_name,
                             delivery_date),
                        )
                        created += 1
                except Exception as exc:
                    logger.warning("bridge_po_delivery: %s for PO %s", exc, po_number)

    finally:
        conn.close()

    return created, updated


def _record_pdf_path(po_number: str, file_path: str) -> None:
    """Update bqms_samsung_po with the local PDF path."""
    conn = psycopg2.connect(SYNC_DSN)
    try:
        with conn, conn.cursor() as cur:
            cur.execute(
                "UPDATE bqms_samsung_po SET pdf_path = %s WHERE po_number = %s",
                (file_path, po_number),
            )
    finally:
        conn.close()


def _create_sync_log(status: str) -> int | None:
    """Create etl_sync_log entry, return id."""
    conn = psycopg2.connect(SYNC_DSN)
    try:
        with conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO etl_sync_log (sync_type, status, started_at)
                VALUES ('bqms_po', %s, NOW())
                RETURNING id
                """,
                (status,),
            )
            row = cur.fetchone()
            return row[0] if row else None
    except Exception as exc:
        logger.warning("_create_sync_log: %s", exc)
        return None
    finally:
        conn.close()


def _update_sync_log(sync_id: int | None, result: dict[str, Any]) -> None:
    """Update etl_sync_log with final result."""
    if not sync_id:
        return
    conn = psycopg2.connect(SYNC_DSN)
    try:
        with conn, conn.cursor() as cur:
            cur.execute(
                """
                UPDATE etl_sync_log SET
                    status = %s,
                    completed_at = NOW(),
                    rows_inserted = %s,
                    rows_updated = %s,
                    error_message = %s
                WHERE id = %s
                """,
                (
                    result.get("status", "error"),
                    result.get("new_pos", 0),
                    result.get("updated_pos", 0),
                    result.get("error_message"),
                    sync_id,
                ),
            )
    except Exception as exc:
        logger.warning("_update_sync_log: %s", exc)
    finally:
        conn.close()


def _refresh_bqms_kpi() -> None:
    """REFRESH MATERIALIZED VIEW CONCURRENTLY bqms_kpi."""
    conn = psycopg2.connect(SYNC_DSN)
    try:
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute("REFRESH MATERIALIZED VIEW CONCURRENTLY bqms_kpi")
    except Exception as exc:
        logger.warning("_refresh_bqms_kpi: %s (view may not exist yet)", exc)
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# WebSocket emit (sync bridge)
# ---------------------------------------------------------------------------

def _emit_sync_done(result: dict[str, Any]) -> None:
    """Emit bqms_sync_done Socket.IO event from sync context."""
    try:
        from app.websocket.handlers import emit_bqms_sync_done
        asyncio.run(emit_bqms_sync_done(result))
    except RuntimeError as exc:
        if "cannot be called from a running event loop" in str(exc):
            logger.debug("_emit_sync_done: skipping (event loop already running)")
        else:
            logger.warning("_emit_sync_done: %s", exc)
    except Exception as exc:
        logger.warning("_emit_sync_done: failed: %s", exc)
