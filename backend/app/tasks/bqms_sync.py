"""
BQMS Nightly Sync Task — runs at 23:30 every day.

Steps
-----
1. Login to Samsung BQMS portal.
2. Fetch all Purchase Orders created / updated in the last 30 days.
3. Upsert new POs into bqms_samsung_po table.
4. Download PDFs for newly inserted POs and store them under FILES_BASE_PATH.
5. Refresh the bqms_kpi materialized view.
6. Emit a bqms_sync_done WebSocket event so the frontend updates live.

Database access uses a dedicated sync psycopg2 connection — NOT the asyncpg
pool — because Procrastinate workers run outside the async event loop.

BQMS HTTP interaction is done with httpx (sync client).  The credentials and
base URL come from app.core.config.settings.
"""

from __future__ import annotations

import logging
import os
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import httpx
import psycopg2
import psycopg2.extras

from app.core.config import settings
from app.core.procrastinate_app import app, SYNC_DSN

logger = logging.getLogger(__name__)

# PDF storage directory (created if it does not exist)
BQMS_PDF_DIR = Path(settings.FILES_BASE_PATH) / "bqms" / "po_pdfs"


# ---------------------------------------------------------------------------
# Periodic task — 23:30 every day
# ---------------------------------------------------------------------------

@app.periodic(cron="30 23 * * *")
@app.task(name="bqms_nightly_sync", queue="bqms")
def bqms_nightly_sync(timestamp: int = 0) -> dict[str, Any]:  # type: ignore[misc]
    """
    Nightly Samsung BQMS synchronisation.

    Returns a result summary dict that is also emitted over WebSocket.
    """
    started_at = datetime.now(timezone.utc)
    logger.info("bqms_nightly_sync: starting (utc=%s)", started_at.isoformat())

    result: dict[str, Any] = {
        "new_pos":          0,
        "pdfs_downloaded":  0,
        "errors":           0,
        "duration_seconds": 0.0,
        "synced_at":        started_at.isoformat(),
    }

    t0 = time.monotonic()

    try:
        # ------------------------------------------------------------------
        # 1. Login to Samsung BQMS
        # ------------------------------------------------------------------
        session_cookie = _bqms_login()

        # ------------------------------------------------------------------
        # 2. Fetch PO list (last 30 days)
        # ------------------------------------------------------------------
        date_from = (started_at - timedelta(days=30)).strftime("%Y-%m-%d")
        po_list = _bqms_fetch_pos(session_cookie, date_from)
        logger.info("bqms_nightly_sync: fetched %d POs from BQMS", len(po_list))

        # ------------------------------------------------------------------
        # 3. Upsert new POs into bqms_samsung_po
        # ------------------------------------------------------------------
        new_po_ids = _upsert_pos(po_list)
        result["new_pos"] = len(new_po_ids)
        logger.info("bqms_nightly_sync: %d new POs upserted", len(new_po_ids))

        # ------------------------------------------------------------------
        # 4. Download PDFs for new POs
        # ------------------------------------------------------------------
        if new_po_ids:
            pdf_count, pdf_errors = _download_pdfs(session_cookie, new_po_ids)
            result["pdfs_downloaded"] = pdf_count
            result["errors"] += pdf_errors

        # ------------------------------------------------------------------
        # 5. Refresh bqms_kpi materialized view
        # ------------------------------------------------------------------
        _refresh_bqms_kpi()
        logger.info("bqms_nightly_sync: bqms_kpi materialized view refreshed")

    except Exception as exc:
        logger.exception("bqms_nightly_sync: unhandled error: %s", exc)
        result["errors"] += 1
        result["error_message"] = str(exc)

    finally:
        result["duration_seconds"] = round(time.monotonic() - t0, 2)
        result["synced_at"] = started_at.isoformat()

    # ------------------------------------------------------------------
    # 6. Emit WebSocket event (best-effort — do not fail the task if
    #    the event loop / Socket.IO server is not running)
    # ------------------------------------------------------------------
    _emit_sync_done(result)

    logger.info(
        "bqms_nightly_sync: finished new_pos=%d pdfs=%d errors=%d duration=%.1fs",
        result["new_pos"], result["pdfs_downloaded"],
        result["errors"], result["duration_seconds"],
    )
    return result


# ---------------------------------------------------------------------------
# BQMS HTTP helpers
# ---------------------------------------------------------------------------

def _bqms_login() -> str:
    """
    Authenticate with Samsung BQMS and return the session cookie string.

    Raises RuntimeError if login fails.
    """
    url = f"{settings.BQMS_BASE_URL}/login"
    payload = {
        "username": settings.BQMS_USERNAME,
        "password": settings.BQMS_PASSWORD,
    }
    with httpx.Client(timeout=30, follow_redirects=True) as client:
        resp = client.post(url, data=payload)

    if resp.status_code not in (200, 302):
        raise RuntimeError(
            f"BQMS login failed: HTTP {resp.status_code} — {resp.text[:200]}"
        )

    # Build a cookie header from the response cookies
    cookie_str = "; ".join(f"{k}={v}" for k, v in resp.cookies.items())
    if not cookie_str:
        raise RuntimeError("BQMS login succeeded but no session cookie returned")

    logger.debug("bqms_login: session cookie obtained")
    return cookie_str


def _bqms_fetch_pos(session_cookie: str, date_from: str) -> list[dict[str, Any]]:
    """
    Fetch POs created/updated since *date_from* (YYYY-MM-DD).

    Returns a list of PO dicts.  The exact structure depends on the BQMS API;
    the fields below match the bqms_samsung_po table columns.
    """
    url = f"{settings.BQMS_BASE_URL}/api/purchase-orders"
    headers = {"Cookie": session_cookie}
    params  = {"from": date_from, "format": "json"}

    with httpx.Client(timeout=60, follow_redirects=True) as client:
        resp = client.get(url, headers=headers, params=params)

    if resp.status_code != 200:
        raise RuntimeError(
            f"BQMS PO fetch failed: HTTP {resp.status_code} — {resp.text[:200]}"
        )

    try:
        data = resp.json()
    except Exception as exc:
        raise RuntimeError(f"BQMS PO response is not valid JSON: {exc}") from exc

    # Normalise: BQMS may return {"data": [...]} or a bare list
    if isinstance(data, dict):
        return data.get("data", data.get("items", []))
    return data if isinstance(data, list) else []


def _upsert_pos(po_list: list[dict[str, Any]]) -> list[str]:
    """
    Upsert the fetched POs into bqms_samsung_po.

    Returns a list of po_number strings that were inserted for the first time
    (not updated), so we know which PDFs to download.
    """
    if not po_list:
        return []

    conn = psycopg2.connect(SYNC_DSN)
    new_ids: list[str] = []

    try:
        with conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            for po in po_list:
                po_number   = po.get("po_number") or po.get("poNumber", "")
                supplier    = po.get("supplier_name") or po.get("supplierName", "")
                total_amount = po.get("total_amount") or po.get("totalAmount") or 0
                po_date     = po.get("po_date") or po.get("poDate")
                status      = po.get("status", "pending")
                raw_data    = psycopg2.extras.Json(po)

                if not po_number:
                    continue

                cur.execute(
                    """
                    INSERT INTO bqms_samsung_po
                        (po_number, supplier_name, total_amount, po_date, status, raw_data, synced_at)
                    VALUES (%s, %s, %s, %s, %s, %s, NOW())
                    ON CONFLICT (po_number) DO UPDATE SET
                        supplier_name = EXCLUDED.supplier_name,
                        total_amount  = EXCLUDED.total_amount,
                        status        = EXCLUDED.status,
                        raw_data      = EXCLUDED.raw_data,
                        synced_at     = NOW()
                    RETURNING (xmax = 0) AS inserted
                    """,
                    (po_number, supplier, total_amount, po_date, status, raw_data),
                )
                row = cur.fetchone()
                if row and row["inserted"]:
                    new_ids.append(po_number)

    finally:
        conn.close()

    return new_ids


def _download_pdfs(
    session_cookie: str, po_numbers: list[str]
) -> tuple[int, int]:
    """
    Download confirmation PDFs for *po_numbers* from BQMS.

    Files are saved to FILES_BASE_PATH/bqms/po_pdfs/<po_number>.pdf.
    Returns (downloaded_count, error_count).
    """
    BQMS_PDF_DIR.mkdir(parents=True, exist_ok=True)
    downloaded = 0
    errors = 0

    headers = {"Cookie": session_cookie}

    with httpx.Client(timeout=60, follow_redirects=True) as client:
        for po_number in po_numbers:
            url  = f"{settings.BQMS_BASE_URL}/api/purchase-orders/{po_number}/pdf"
            dest = BQMS_PDF_DIR / f"{po_number}.pdf"

            try:
                resp = client.get(url, headers=headers)
                if resp.status_code == 200 and resp.content:
                    dest.write_bytes(resp.content)
                    # Record the file path in the database
                    _record_pdf_path(po_number, str(dest))
                    downloaded += 1
                    logger.debug("bqms_pdf: saved %s (%d bytes)", dest.name, len(resp.content))
                else:
                    logger.warning(
                        "bqms_pdf: no PDF for %s (HTTP %d)", po_number, resp.status_code
                    )
                    errors += 1
            except Exception as exc:
                logger.warning("bqms_pdf: error downloading %s: %s", po_number, exc)
                errors += 1

    return downloaded, errors


def _record_pdf_path(po_number: str, file_path: str) -> None:
    """Update the bqms_samsung_po row with the local PDF path."""
    conn = psycopg2.connect(SYNC_DSN)
    try:
        with conn, conn.cursor() as cur:
            cur.execute(
                "UPDATE bqms_samsung_po SET pdf_path = %s WHERE po_number = %s",
                (file_path, po_number),
            )
    finally:
        conn.close()


def _refresh_bqms_kpi() -> None:
    """REFRESH MATERIALIZED VIEW CONCURRENTLY bqms_kpi."""
    conn = psycopg2.connect(SYNC_DSN)
    try:
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute("REFRESH MATERIALIZED VIEW CONCURRENTLY bqms_kpi")
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# WebSocket emit (sync bridge)
# ---------------------------------------------------------------------------

def _emit_sync_done(result: dict[str, Any]) -> None:
    """
    Emit the bqms_sync_done Socket.IO event from a sync context.

    We use asyncio.run() to drive a single coroutine call.  If an event
    loop is already running (e.g. inside pytest-asyncio) this call is
    skipped gracefully.
    """
    import asyncio

    try:
        from app.websocket.handlers import emit_bqms_sync_done
        asyncio.run(emit_bqms_sync_done(result))
    except RuntimeError as exc:
        # Already inside a running event loop — schedule instead
        if "cannot be called from a running event loop" in str(exc):
            logger.debug("_emit_sync_done: skipping (event loop already running)")
        else:
            logger.warning("_emit_sync_done: RuntimeError: %s", exc)
    except Exception as exc:
        logger.warning("_emit_sync_done: failed to emit WebSocket event: %s", exc)
