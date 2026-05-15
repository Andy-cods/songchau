"""BQMS Quote Batch Worker — Option B background queue.

Frontend trigger: POST /api/v1/bqms/vendor-staging/quote-batch with N staging_ids
                  → API enqueues N `quote_one_rfq_task` tasks.
Worker (sc-worker container) consumes them one-by-one. Each task:
  1. Mark batch_item.status='running'
  2. Re-implement the /quote logic inline (login → download → extract items
     → merge fresh_detail into staging.raw_json → UPSERT bqms_rfq → mark
     staging.status='approved')
  3. Mark batch_item.status='done' (or 'error') with counters

The batch's parent counters re-aggregate via DB trigger fn_recount_quote_batch.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from datetime import datetime, timezone
from typing import Any

import psycopg2
import psycopg2.extras

from app.core.config import settings
from app.core.procrastinate_app import app, SYNC_DSN

logger = logging.getLogger(__name__)


@app.task(name="bqms_quote_one_rfq", queue="bqms_quote")
def quote_one_rfq_task(
    batch_item_id: int,
    staging_id: int,
    user_id: int | None = None,
    timestamp: int = 0,
) -> dict[str, Any]:
    """Process ONE staging row through the full /quote pipeline.
    Wrapped by sc-worker — invoked once per RFQ in a batch.
    Returns a slim summary; the rich per-row state lives in
    bqms_quote_batch_items (updated as we go).
    """
    started_at = datetime.now(timezone.utc)
    t0 = time.monotonic()
    logger.info(
        "quote_one_rfq_task: batch_item=%d staging=%d start",
        batch_item_id, staging_id,
    )

    _mark_item(batch_item_id, status="running", started_at=started_at)

    summary: dict[str, Any] = {"staging_id": staging_id}
    try:
        summary = asyncio.run(_quote_one(staging_id, user_id))
        _mark_item(
            batch_item_id,
            status="done",
            completed_at=datetime.now(timezone.utc),
            items_count=summary.get("items_count"),
            files_count=summary.get("files_count"),
            images_count=summary.get("images_count"),
            upserts_count=summary.get("upserts_count"),
            classification=summary.get("classification"),
        )
    except Exception as exc:
        logger.exception(
            "quote_one_rfq_task: batch_item=%d staging=%d FAILED",
            batch_item_id, staging_id,
        )
        _mark_item(
            batch_item_id,
            status="error",
            completed_at=datetime.now(timezone.utc),
            error_message=str(exc)[:500],
        )
        summary["error"] = str(exc)[:500]
    finally:
        summary["duration_seconds"] = round(time.monotonic() - t0, 2)
        logger.info(
            "quote_one_rfq_task: batch_item=%d staging=%d done %.1fs",
            batch_item_id, staging_id, summary["duration_seconds"],
        )

    return summary


# ---------------------------------------------------------------------------
# Async pipeline — same shape as bqms.py /quote endpoint, but WITHOUT the
# HTTP threading hack (we are already on a worker thread).
# ---------------------------------------------------------------------------

async def _quote_one(staging_id: int, user_id: int | None) -> dict[str, Any]:
    from app.etl.bqms_bidding_scraper import (
        upsert_bqms_rfq_for_one_staging_row,
        download_files_for_rfq,
    )
    import asyncpg

    db_url = (
        str(settings.DATABASE_URL)
        .replace("+asyncpg", "")
        .replace("postgresql+asyncpg", "postgresql")
    )
    pool = await asyncpg.create_pool(db_url, min_size=1, max_size=3)
    from app.services.samsung_session_lock import samsung_session_lock
    try:
        async with pool.acquire() as c:
            row = await c.fetchrow(
                "SELECT id, module, rfq_number, status, raw_json "
                "FROM bqms_vendor_portal_staging WHERE id = $1",
                staging_id,
            )
        if not row:
            raise RuntimeError(f"staging #{staging_id} not found")
        if row["module"] != "bidding":
            raise RuntimeError(f"module='{row['module']}' — quote chỉ áp dụng cho 'bidding'")
        if row["status"] not in ("pending_review", "approved"):
            raise RuntimeError(f"row đang ở status='{row['status']}'")
        rfq_number = (row["rfq_number"] or "").strip()
        if not rfq_number:
            raise RuntimeError(f"row #{staging_id} thiếu rfq_number")

        raw = row["raw_json"]
        if not isinstance(raw, dict):
            raw = json.loads(raw or "{}")
        had_detail_items = bool((raw.get("_detail") or {}).get("items"))

        # 1) Download (also drills detail freshly: items + attachments + images)
        # Hold samsung_session_lock for the Samsung-touching part only — DB ops
        # outside the lock so progress UI stays responsive.
        async with samsung_session_lock(pool, who=f"quote_batch:staging={staging_id}", timeout_seconds=600):
            dl = await download_files_for_rfq(rfq_number, raw, db_pool=pool)

        # 2) Merge fresh detail back into staging.raw_json
        fresh_detail = (dl or {}).get("fresh_detail") or {}
        if fresh_detail.get("items") or had_detail_items:
            if fresh_detail.get("items"):
                raw["_detail"] = fresh_detail
            async with pool.acquire() as c:
                await c.execute(
                    "UPDATE bqms_vendor_portal_staging "
                    "SET raw_json = $1::jsonb WHERE id = $2",
                    json.dumps(raw, ensure_ascii=False, default=str),
                    staging_id,
                )

        # 3) UPSERT bqms_rfq
        upserts = await upsert_bqms_rfq_for_one_staging_row(pool, raw)

        # 4) Mark approved
        async with pool.acquire() as c:
            await c.execute(
                "UPDATE bqms_vendor_portal_staging "
                "SET status='approved', reviewed_by=$1, reviewed_at=NOW() "
                "WHERE id=$2 AND status IN ('pending_review','approved')",
                user_id, staging_id,
            )

        return {
            "staging_id": staging_id,
            "rfq_number": rfq_number,
            "items_count": fresh_detail.get("items_count")
                or len(fresh_detail.get("items") or []),
            "files_count": (dl or {}).get("downloaded_count") or 0,
            "images_count": (dl or {}).get("images_extracted") or 0,
            "upserts_count": upserts,
            "classification": fresh_detail.get("classification"),
        }
    finally:
        await pool.close()


# ---------------------------------------------------------------------------
# Sync DB helpers (psycopg2 — Procrastinate worker is sync)
# ---------------------------------------------------------------------------

def _mark_item(
    batch_item_id: int,
    status: str | None = None,
    started_at: datetime | None = None,
    completed_at: datetime | None = None,
    items_count: int | None = None,
    files_count: int | None = None,
    images_count: int | None = None,
    upserts_count: int | None = None,
    classification: str | None = None,
    error_message: str | None = None,
) -> None:
    sets: list[str] = []
    args: list[Any] = []
    if status is not None:
        sets.append("status = %s"); args.append(status)
    if started_at is not None:
        sets.append("started_at = %s"); args.append(started_at)
    if completed_at is not None:
        sets.append("completed_at = %s"); args.append(completed_at)
    if items_count is not None:
        sets.append("items_count = %s"); args.append(items_count)
    if files_count is not None:
        sets.append("files_count = %s"); args.append(files_count)
    if images_count is not None:
        sets.append("images_count = %s"); args.append(images_count)
    if upserts_count is not None:
        sets.append("upserts_count = %s"); args.append(upserts_count)
    if classification is not None:
        sets.append("classification = %s"); args.append(classification)
    if error_message is not None:
        sets.append("error_message = %s"); args.append(error_message)
    if not sets:
        return
    args.append(batch_item_id)
    sql = f"UPDATE bqms_quote_batch_items SET {', '.join(sets)} WHERE id = %s"
    conn = psycopg2.connect(SYNC_DSN)
    try:
        with conn, conn.cursor() as cur:
            cur.execute(sql, args)
    except Exception as exc:
        logger.warning("_mark_item(%d) failed: %s", batch_item_id, exc)
    finally:
        conn.close()
