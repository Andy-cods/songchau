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

        # 2. Detect re-push mode (Thang 2026-05-22): nếu push trước đó đã
        # 'saved_temp' rồi user click "Đẩy lên SEC" lần nữa → infer ý định
        # là GHI ĐÈ Samsung data (ảnh cũ + PDF cũ + giá cũ → thay bằng mới).
        # Đọc status TRƯỚC KHI set 'running' để bắt được 'saved_temp' cũ.
        prev_status = None
        async with pool.acquire() as c:
            prev_status = await c.fetchval(
                "SELECT bqms_push_status FROM bqms_rfq WHERE id=$1", rfq_id,
            )
        is_repush = (prev_status == "saved_temp")
        if is_repush:
            logger.info(
                "RE-PUSH detected for rfq_id=%d (prev_status=saved_temp) → "
                "override mode enabled (replace Samsung image + PDF + values)",
                rfq_id,
            )
        # Inject flag vào payload để pusher đọc được — prefix `_` đánh dấu
        # đây là metadata nội bộ, không phải user-input.
        payload = dict(payload)  # copy to avoid mutating caller's dict
        payload["_is_repush"] = is_repush

        # 3. Mark running + reset progress — separate conn, NO transaction.
        # Thang 2026-06-22: set bqms_push_round_active = the live round so the
        # popup labels V2/V3 correctly + dedup ranks the running row by the
        # round actually being pushed (bqms_pushed_round only flips on success).
        # Seed the 8-step checklist (step_index=0, total_steps=8).
        async with pool.acquire() as c:
            await c.execute(
                """UPDATE bqms_rfq SET bqms_push_status='running',
                   bqms_push_error=NULL,
                   bqms_push_progress_pct=0,
                   bqms_push_progress_step='Bắt đầu...',
                   bqms_push_round_active=$2,
                   bqms_push_step_index=0,
                   bqms_push_total_steps=8,
                   bqms_push_started_at=NOW(),
                   bqms_push_heartbeat_at=NOW()
                   WHERE id=$1""",
                rfq_id, int(payload.get("round", 1)),
            )

        # 3. Progress callback — separate pool conn each time, KHÔNG transaction.
        # Thang 2026-06-22: accept optional step_index (1..8) + step_key from the
        # canonical 8-step pusher so the checklist persists. Stays tolerant if the
        # pusher (or nested nav helpers) call it with only (pct, step).
        async def _progress_cb(pct: int, step: str, step_index=None, step_key=None):
            try:
                async with pool.acquire() as pc:
                    if step_index is not None or step_key is not None:
                        await pc.execute(
                            """UPDATE bqms_rfq SET
                               bqms_push_progress_pct=$1,
                               bqms_push_progress_step=$2,
                               bqms_push_step_index=COALESCE($3, bqms_push_step_index),
                               bqms_push_step_key=COALESCE($4, bqms_push_step_key),
                               bqms_push_heartbeat_at=NOW()
                               WHERE id=$5""",
                            int(pct), step[:500],
                            int(step_index) if step_index is not None else None,
                            step_key[:64] if isinstance(step_key, str) else None,
                            rfq_id,
                        )
                    else:
                        await pc.execute(
                            """UPDATE bqms_rfq SET
                               bqms_push_progress_pct=$1,
                               bqms_push_progress_step=$2,
                               bqms_push_heartbeat_at=NOW()
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


async def _push_single(pool, pusher, rfq_id: int, payload: dict, user_id: str | None) -> dict[str, Any]:
    """Đẩy 1 RFQ — dùng cho MẺ (batch). KHÁC `_run_push`: KHÔNG tự tạo pool, KHÔNG
    tự acquire `samsung_session_lock` (caller giữ 1 lần cho CẢ MẺ → tái dùng phiên
    Samsung/đăng nhập, không bị scraper chen giữa các mã). Tự acquire per-rfq
    advisory_lock + set DB status + notif. KHÔNG raise (trả result dict) để 1 mã lỗi
    không làm dừng cả mẻ. Logic per-RFQ giữ y hệt `_run_push` (re-push detect →
    running → progress → push_one_rfq → final → notif)."""
    lock_conn = await pool.acquire()
    result: dict[str, Any] = {"status": "failed", "error": "unknown"}
    try:
        locked = await lock_conn.fetchval(
            "SELECT pg_try_advisory_lock(hashtext('bqms_push'), $1)", rfq_id)
        if not locked:
            result = {"status": "failed", "error": f"QT đang được đẩy bởi job khác (rfq_id={rfq_id})"}
            _update_status(rfq_id, "failed", error=result["error"])
            return result

        async with pool.acquire() as c:
            prev_status = await c.fetchval("SELECT bqms_push_status FROM bqms_rfq WHERE id=$1", rfq_id)
        payload = dict(payload)
        payload["_is_repush"] = (prev_status == "saved_temp")

        async with pool.acquire() as c:
            await c.execute(
                """UPDATE bqms_rfq SET bqms_push_status='running', bqms_push_error=NULL,
                   bqms_push_progress_pct=0, bqms_push_progress_step='Bắt đầu...',
                   bqms_push_round_active=$2, bqms_push_step_index=0, bqms_push_total_steps=8,
                   bqms_push_started_at=NOW(), bqms_push_heartbeat_at=NOW() WHERE id=$1""",
                rfq_id, int(payload.get("round", 1)))

        async def _progress_cb(pct, step, step_index=None, step_key=None):
            try:
                async with pool.acquire() as pc:
                    if step_index is not None or step_key is not None:
                        await pc.execute(
                            """UPDATE bqms_rfq SET bqms_push_progress_pct=$1, bqms_push_progress_step=$2,
                               bqms_push_step_index=COALESCE($3, bqms_push_step_index),
                               bqms_push_step_key=COALESCE($4, bqms_push_step_key),
                               bqms_push_heartbeat_at=NOW() WHERE id=$5""",
                            int(pct), step[:500],
                            int(step_index) if step_index is not None else None,
                            step_key[:64] if isinstance(step_key, str) else None, rfq_id)
                    else:
                        await pc.execute(
                            "UPDATE bqms_rfq SET bqms_push_progress_pct=$1, bqms_push_progress_step=$2, "
                            "bqms_push_heartbeat_at=NOW() WHERE id=$3",
                            int(pct), step[:500], rfq_id)
            except Exception as exc:
                logger.warning("progress update failed: %s", exc)

        try:
            result = await pusher.push_one_rfq(payload, progress_cb=_progress_cb)
        except Exception as exc:
            logger.exception("push_one_rfq raised rfq_id=%d", rfq_id)
            result = {"status": "failed", "error": str(exc)[:1000], "screenshot_path": None}

        async with pool.acquire() as c:
            if result.get("status") == "saved_temp":
                await c.execute(
                    """UPDATE bqms_rfq SET bqms_push_status='saved_temp', bqms_pushed_at=NOW(),
                       bqms_pushed_round=$1, bqms_push_screenshot_path=$2, bqms_push_error=NULL,
                       bqms_push_progress_pct=100, bqms_push_progress_step='✓ Hoàn tất' WHERE id=$3""",
                    payload.get("round", 1), result.get("screenshot_path"), rfq_id)
            else:
                await c.execute(
                    """UPDATE bqms_rfq SET bqms_push_status='failed', bqms_push_error=$1,
                       bqms_push_screenshot_path=$2, bqms_push_progress_step=$3 WHERE id=$4""",
                    result.get("error", "Unknown error")[:1000], result.get("screenshot_path"),
                    f"LỖI: {result.get('error', 'Unknown')[:400]}", rfq_id)
            if user_id:
                rfq_row = await c.fetchrow("SELECT rfq_number FROM bqms_rfq WHERE id=$1", rfq_id)
                rfq_no = rfq_row["rfq_number"] if rfq_row else f"#{rfq_id}"
                if result.get("status") == "saved_temp":
                    title = f"✓ QT {rfq_no} đã save temp lên SEC-BQMS"
                    body = "Vào sec-bqms.com xem lại + nhấn Submit cuối để gửi chính thức"
                else:
                    title = f"✗ QT {rfq_no} push lên SEC thất bại"
                    body = result.get("error", "Unknown")[:200]
                try:
                    await c.execute(
                        """INSERT INTO notifications (recipient_id, type, title, body, ref_type, ref_id, metadata)
                           VALUES ($1::uuid, 'bqms_rfq_new', $2, $3, 'bqms_rfq', $4, $5::jsonb)""",
                        user_id, title, body, rfq_id,
                        json.dumps({"link": f"/bqms?rfq_id={rfq_id}", "push_status": result.get("status"), "rfq_number": rfq_no}))
                except Exception as exc:
                    logger.warning("Insert notification failed: %s", exc)
        return result
    except Exception as exc:
        logger.exception("_push_single FATAL rfq_id=%d", rfq_id)
        _update_status(rfq_id, "failed", error=str(exc)[:1000])
        return {"status": "failed", "error": str(exc)[:500]}
    finally:
        try:
            await lock_conn.execute("SELECT pg_advisory_unlock(hashtext('bqms_push'), $1)", rfq_id)
        except Exception:
            pass
        await pool.release(lock_conn)


@app.task(name="bqms_submit_batch", queue="bqms_push")
async def bqms_submit_batch_task(
    rfqs: list[dict[str, Any]], user_id: str | None = None, timestamp: int = 0,
) -> dict[str, Any]:
    """ĐẨY NHIỀU RFQ THEO THỨ TỰ trong 1 phiên Samsung (Thang 2026-06-29).

    Giữ `samsung_session_lock` ĐÚNG 1 LẦN cho cả mẻ → 1 lần đăng nhập, đẩy lần lượt
    `rfqs` theo thứ tự, scraper không chen được giữa các mã. Mỗi RFQ độc lập qua
    `_push_single` (KHÔNG tự giữ session lock): 1 mã lỗi KHÔNG dừng mẻ. KHÔNG retry
    (tránh chạy lại mã đã thành công). Wall-clock guard 25 phút để không giữ phiên
    quá lâu (scraper 60s sẽ skip & tự lành; nhường lại sau khi mẻ xong)."""
    import asyncpg
    import time as _time
    from app.services.bqms_quote_pusher import get_pusher
    from app.services.samsung_session_lock import samsung_session_lock

    db_url = (
        str(settings.DATABASE_URL)
        .replace("+asyncpg", "")
        .replace("postgresql+asyncpg", "postgresql")
    )
    pool = await asyncpg.create_pool(db_url, min_size=2, max_size=6)
    summary: dict[str, Any] = {"ok": [], "failed": []}
    t0 = _time.monotonic()
    logger.info("bqms_submit_batch START n=%d user=%s", len(rfqs or []), user_id)
    try:
        pusher = get_pusher()
        async with samsung_session_lock(pool, who=f"batch:{len(rfqs or [])}rfq", timeout_seconds=900):
            for r in (rfqs or []):
                rid = int(r["rfq_id"])
                if _time.monotonic() - t0 > 1500:  # 25 phút
                    _update_status(rid, "failed", error="Mẻ đẩy quá 25 phút — bỏ qua mã này, vui lòng đẩy lại sau")
                    summary["failed"].append(rid)
                    continue
                res = await _push_single(pool, pusher, rid, r["payload"], user_id)
                (summary["ok"] if res.get("status") == "saved_temp" else summary["failed"]).append(rid)
    except Exception:
        logger.exception("bqms_submit_batch FATAL")
    finally:
        await pool.close()
    logger.info("bqms_submit_batch DONE ok=%d failed=%d", len(summary["ok"]), len(summary["failed"]))
    return summary


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
