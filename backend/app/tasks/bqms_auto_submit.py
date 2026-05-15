"""BQMS Auto-Submit Procrastinate task (Thang 2026-05-14).

Async wrapper cho BqmsQuotePusher. Mỗi job:
1. pg_advisory_xact_lock(rfq_id) — chặn cùng QT bị 2 job concurrent
2. UPDATE bqms_rfq status='running'
3. await pusher.push_one_rfq(payload)
4. UPDATE bqms_rfq status='saved_temp' hoặc 'failed' + screenshot path
5. Insert notification cho user

Queue 'bqms_push' chạy concurrency=1 → serial, tránh Samsung session conflict.
"""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Any

import psycopg2
import psycopg2.extras

from app.core.config import settings
from app.core.procrastinate_app import app, SYNC_DSN

logger = logging.getLogger(__name__)


@app.task(name="bqms_submit_quote", queue="bqms_push", retry={"max_attempts": 2, "wait": 30})
async def bqms_submit_quote_task(
    rfq_id: int,
    payload: dict[str, Any],
    user_id: str | None = None,
    timestamp: int = 0,
) -> dict[str, Any]:
    """ASYNC task — Procrastinate worker tự await với loop của nó.

    FIX (Thang 2026-05-15): trước đây dùng sync `def` + `asyncio.run()` → mỗi
    call tạo+đóng event loop mới → Playwright subprocess attached vào loop cũ
    → "RuntimeError: Event loop is closed" ở lần call sau (singleton bị orphan).
    Đổi thành `async def` để worker reuse 1 loop xuyên jobs → singleton Playwright
    sống ngon.
    """
    started_at = datetime.now(timezone.utc)
    logger.info("bqms_submit_quote_task START rfq_id=%d user=%s", rfq_id, user_id)
    try:
        result = await _run_push(rfq_id, payload, user_id)
    except Exception as exc:
        logger.exception("bqms_submit_quote_task FATAL: rfq_id=%d", rfq_id)
        _update_status(rfq_id, "failed", error=str(exc)[:1000])
        raise
    duration = (datetime.now(timezone.utc) - started_at).total_seconds()
    logger.info(
        "bqms_submit_quote_task DONE rfq_id=%d status=%s in %.1fs",
        rfq_id, result.get("status"), duration,
    )
    return result


async def _run_push(rfq_id: int, payload: dict, user_id: str | None) -> dict[str, Any]:
    """Async core — acquire advisory_lock + invoke pusher + update DB.

    FIX (Thang 2026-05-15): TUYỆT ĐỐI KHÔNG hold transaction trong lúc Playwright
    chạy. Lý do: UPDATE status='running' trong transaction → giữ RowExclusiveLock
    trên bqms_rfq.id → progress_cb từ pool khác bị block (pg_locks: ShareLock
    NOT granted). Refactor: dùng session-level advisory_lock (non-xact) trên
    connection riêng, các UPDATE khác chạy trên connection độc lập KHÔNG trong
    transaction → callback freely write progress.
    """
    import asyncpg
    from app.services.bqms_quote_pusher import get_pusher

    db_url = (
        str(settings.DATABASE_URL)
        .replace("+asyncpg", "")
        .replace("postgresql+asyncpg", "postgresql")
    )
    pool = await asyncpg.create_pool(db_url, min_size=2, max_size=4)
    lock_conn = None
    result: dict[str, Any] = {"status": "failed", "error": "unknown"}
    try:
        # 1. Acquire session-level advisory_lock (non-xact) — chỉ release khi
        # close connection (crash safe) hoặc explicit unlock.
        lock_conn = await pool.acquire()
        locked = await lock_conn.fetchval(
            "SELECT pg_try_advisory_lock(hashtext('bqms_push'), $1)",
            rfq_id,
        )
        if not locked:
            raise RuntimeError(
                f"QT này đang được đẩy bởi job khác (rfq_id={rfq_id})"
            )

        # 2. Mark running + reset progress — separate conn, NO transaction
        async with pool.acquire() as c:
            await c.execute(
                """UPDATE bqms_rfq SET bqms_push_status='running',
                   bqms_push_error=NULL,
                   bqms_push_progress_pct=0,
                   bqms_push_progress_step='Bắt đầu...',
                   bqms_push_started_at=NOW()
                   WHERE id=$1""",
                rfq_id,
            )

        # 3. Progress callback — separate pool conn each time, KHÔNG transaction
        async def _progress_cb(pct: int, step: str):
            try:
                async with pool.acquire() as pc:
                    await pc.execute(
                        """UPDATE bqms_rfq SET
                           bqms_push_progress_pct=$1,
                           bqms_push_progress_step=$2
                           WHERE id=$3""",
                        int(pct), step[:500], rfq_id,
                    )
            except Exception as exc:
                logger.warning("progress update failed: %s", exc)

        # 4. Run Playwright push under global Samsung session lock.
        # Push is user-triggered → MUST wait, not skip. Timeout 15 min covers
        # any single push run (~2 min) + queue wait if scraper is running.
        from app.services.samsung_session_lock import samsung_session_lock
        pusher = get_pusher()
        async with samsung_session_lock(pool, who=f"push:rfq_id={rfq_id}", timeout_seconds=900):
            result = await pusher.push_one_rfq(payload, progress_cb=_progress_cb)

        # 5. Final status update
        async with pool.acquire() as c:
            if result.get("status") == "saved_temp":
                await c.execute(
                    """
                    UPDATE bqms_rfq SET
                        bqms_push_status='saved_temp',
                        bqms_pushed_at=NOW(),
                        bqms_pushed_round=$1,
                        bqms_push_screenshot_path=$2,
                        bqms_push_error=NULL,
                        bqms_push_progress_pct=100,
                        bqms_push_progress_step='✓ Hoàn tất'
                    WHERE id=$3
                    """,
                    payload.get("round", 1),
                    result.get("screenshot_path"),
                    rfq_id,
                )
            else:
                await c.execute(
                    """
                    UPDATE bqms_rfq SET
                        bqms_push_status='failed',
                        bqms_push_error=$1,
                        bqms_push_screenshot_path=$2,
                        bqms_push_progress_step=$3
                    WHERE id=$4
                    """,
                    result.get("error", "Unknown error")[:1000],
                    result.get("screenshot_path"),
                    f"LỖI: {result.get('error', 'Unknown')[:400]}",
                    rfq_id,
                )

            # 6. Notification
            if user_id:
                rfq_row = await c.fetchrow(
                    "SELECT rfq_number FROM bqms_rfq WHERE id=$1", rfq_id,
                )
                rfq_no = rfq_row["rfq_number"] if rfq_row else f"#{rfq_id}"
                if result.get("status") == "saved_temp":
                    title = f"✓ QT {rfq_no} đã save temp lên SEC-BQMS"
                    body = "Vào sec-bqms.com xem lại + nhấn Submit cuối để gửi chính thức"
                else:
                    title = f"✗ QT {rfq_no} push lên SEC thất bại"
                    body = result.get("error", "Unknown")[:200]
                try:
                    # Schema (Thang 2026-05-15): notifications dùng recipient_id
                    # (uuid FK users) + type (enum notification_type) + ref_type
                    # + ref_id + metadata. Enum chưa có 'bqms_push' value → tái
                    # sử dụng 'bqms_rfq_new' (BQMS-related notification).
                    await c.execute(
                        """
                        INSERT INTO notifications
                            (recipient_id, type, title, body, ref_type, ref_id, metadata)
                        VALUES ($1::uuid, 'bqms_rfq_new', $2, $3, 'bqms_rfq', $4, $5::jsonb)
                        """,
                        user_id, title, body, rfq_id,
                        json.dumps({
                            "link": f"/bqms?rfq_id={rfq_id}",
                            "push_status": result.get("status"),
                            "rfq_number": rfq_no,
                        }),
                    )
                except Exception as exc:
                    logger.warning("Insert notification failed: %s", exc)

        return result
    finally:
        # Release advisory_lock + return connection
        if lock_conn is not None:
            try:
                await lock_conn.execute(
                    "SELECT pg_advisory_unlock(hashtext('bqms_push'), $1)",
                    rfq_id,
                )
            except Exception:
                pass
            await pool.release(lock_conn)
        await pool.close()


def _update_status(rfq_id: int, status: str, error: str | None = None):
    """Sync helper để update status từ exception handler."""
    with psycopg2.connect(SYNC_DSN) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """UPDATE bqms_rfq SET bqms_push_status=%s, bqms_push_error=%s
                   WHERE id=%s""",
                (status, error, rfq_id),
            )
        conn.commit()
