"""Watchdog: tự phục hồi push job kẹt do sc-worker OOM (W0-07, Thang 2026-07-03).

Bối cảnh: khi worker bị OOM giữa lúc đẩy 1 QT lên SEC-BQMS, dòng bqms_rfq kẹt ở
bqms_push_status='running' (hoặc 'queued') mãi — không có gì tự dọn → admin phải
sửa tay. Watchdog này quét mỗi ~15' và:

  A. 'running' + heartbeat cũ > 20'  → job đã CHẾT (worker OOM). Live push bump
     heartbeat mỗi bước (~vài giây) nên >20' đứng im = kẹt thật.
  B. 'queued'  + heartbeat cũ > 20' + job Procrastinate nền đã KẾT THÚC/mất
     (failed/cancelled/succeeded/aborted/không còn) → mồ côi. Nếu job nền vẫn
     'todo'/'doing' → đang chờ hợp lệ (vd đứng sau 1 mã trong mẻ) → BỎ QUA.

Với mỗi job kẹt: đánh dấu 'failed' (popup push-queue hiện đỏ, admin re-push bằng
nút cũ — idempotent qua prev_status), tạo notification cho admin, và đẩy 1 bản
ghi vào retry_queue để hiện ở /admin/retry-queue (chống trùng: 1 bản ghi mở/rfq).

THẬN TRỌNG: chỉ đụng dòng heartbeat/started cũ > 20'; job đang chạy hợp lệ (heartbeat
mới) hoặc queued còn job nền sống KHÔNG bị đụng. Re-push tự động KHÔNG làm ở đây —
xem notes trong report (rủi ro double-push cần review kỹ).
"""
from __future__ import annotations

import json
import logging
from typing import Any

import psycopg2
import psycopg2.extras

from app.core.procrastinate_app import app, SYNC_DSN

logger = logging.getLogger(__name__)

STUCK_MINUTES = 20


@app.periodic(cron="*/15 * * * *")  # mỗi 15 phút
@app.task(name="bqms_push_watchdog", queue="default", queueing_lock="bqms_push_watchdog")
def bqms_push_watchdog(timestamp: int = 0) -> dict[str, Any]:
    """Đánh dấu push job kẹt = failed + notif admin + retry_queue. Trả stats."""
    stats = {"running_stuck": 0, "queued_orphan": 0, "notified": 0, "queued_retry": 0, "errors": 0}
    try:
        with psycopg2.connect(SYNC_DSN, connect_timeout=5) as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                # A. 'running' với heartbeat (fallback started_at) cũ > 20'
                cur.execute(
                    """
                    SELECT id, rfq_number,
                           COALESCE(bqms_push_round_active, bqms_pushed_round, 0) AS round,
                           bqms_push_progress_step AS step,
                           EXTRACT(EPOCH FROM (
                               NOW() - COALESCE(bqms_push_heartbeat_at, bqms_push_started_at)
                           )) AS age_sec
                      FROM bqms_rfq
                     WHERE bqms_push_status = 'running'
                       AND COALESCE(bqms_push_heartbeat_at, bqms_push_started_at)
                           < NOW() - make_interval(mins => %s)
                    """,
                    (STUCK_MINUTES,),
                )
                running_stuck = cur.fetchall()

                # B. 'queued' mồ côi: heartbeat cũ > 20' VÀ job nền đã kết thúc/mất.
                #    Job nền còn 'todo'/'doing' = đang chờ hợp lệ → không lấy.
                cur.execute(
                    """
                    SELECT r.id, r.rfq_number,
                           COALESCE(r.bqms_push_round_active, r.bqms_pushed_round, 0) AS round,
                           r.bqms_push_progress_step AS step,
                           EXTRACT(EPOCH FROM (
                               NOW() - COALESCE(r.bqms_push_heartbeat_at, r.bqms_push_started_at)
                           )) AS age_sec
                      FROM bqms_rfq r
                      LEFT JOIN procrastinate_jobs j ON j.id::text = r.bqms_push_job_id
                     WHERE r.bqms_push_status = 'queued'
                       AND COALESCE(r.bqms_push_heartbeat_at, r.bqms_push_started_at) IS NOT NULL
                       AND COALESCE(r.bqms_push_heartbeat_at, r.bqms_push_started_at)
                           < NOW() - make_interval(mins => %s)
                       AND (j.id IS NULL
                            OR j.status::text IN ('failed', 'cancelled', 'succeeded', 'aborted'))
                    """,
                    (STUCK_MINUTES,),
                )
                queued_orphan = cur.fetchall()

                stats["running_stuck"] = len(running_stuck)
                stats["queued_orphan"] = len(queued_orphan)

                # Gộp lại xử lý chung. status_guard đảm bảo UPDATE chỉ ăn nếu dòng
                # VẪN đang kẹt (tránh đua với job vừa hoàn tất giữa 2 query).
                for prev_status, rows in (("running", running_stuck), ("queued", queued_orphan)):
                    for r in rows:
                        # SAVEPOINT mỗi dòng: 1 dòng lỗi KHÔNG poison cả transaction.
                        # (psycopg2 abort toàn bộ txn khi 1 execute lỗi → mọi dòng sau
                        # raise InFailedSqlTransaction. Rollback-to-savepoint cô lập lỗi.)
                        try:
                            cur.execute("SAVEPOINT sp_wd")
                            _handle_stuck(cur, r, prev_status, stats)
                            cur.execute("RELEASE SAVEPOINT sp_wd")
                        except Exception as exc:
                            try:
                                cur.execute("ROLLBACK TO SAVEPOINT sp_wd")
                            except Exception:
                                pass
                            logger.error("push_watchdog handle failed id=%s: %s", r.get("id"), exc)
                            stats["errors"] += 1
                conn.commit()
    except Exception as exc:
        logger.exception("push_watchdog top-level fail")
        stats["errors"] += 1
        stats["db_error"] = str(exc)[:200]

    if any(stats[k] for k in ("running_stuck", "queued_orphan", "errors")):
        logger.warning("bqms_push_watchdog: %s", stats)
    return stats


def _handle_stuck(cur, row: dict, prev_status: str, stats: dict) -> None:
    """Mark 1 dòng failed + notif admin + retry_queue. Chạy trong transaction của caller."""
    rfq_id = row["id"]
    rfq_no = row["rfq_number"] or f"#{rfq_id}"
    age_min = int((row["age_sec"] or 0) // 60)
    err = (
        f"Watchdog: push job kẹt {age_min}' (>{STUCK_MINUTES}') không tiến triển — "
        f"nghi worker OOM. Bước cuối: {row.get('step') or 'không rõ'}. "
        f"Bấm ĐẨY LẠI để re-push (an toàn, không đẩy trùng)."
    )

    # 1. Đánh dấu failed — status_guard: chỉ khi VẪN đang ở prev_status (không đua).
    cur.execute(
        """
        UPDATE bqms_rfq
           SET bqms_push_status = 'failed',
               bqms_push_error = %s,
               bqms_push_progress_step = %s
         WHERE id = %s AND bqms_push_status = %s
        """,
        (err[:1000], f"LỖI: kẹt {age_min}' (watchdog)"[:400], rfq_id, prev_status),
    )
    if cur.rowcount == 0:
        # Dòng đã đổi trạng thái giữa lúc query → job tự hồi, bỏ qua (không notif/không retry).
        logger.info("push_watchdog: rfq_id=%s đã đổi trạng thái, skip", rfq_id)
        return

    logger.warning(
        "push_watchdog killed stuck rfq_id=%s (%s, age %d min) rfq=%s",
        rfq_id, prev_status, age_min, rfq_no,
    )

    # 2. Notification cho admin (reuse enum 'bqms_rfq_new' — tránh ALTER TYPE).
    #    Bắn 1 lần/job vì ngay sau đây status đã thành 'failed' → không tái phát hiện.
    title = f"⚠ QT {rfq_no} — push kẹt được tự phục hồi"
    body = (
        f"Push job kẹt {age_min}' (nghi worker OOM) đã bị đánh dấu FAILED tự động. "
        f"Vào /admin/retry-queue hoặc trang BQMS bấm ĐẨY LẠI."
    )
    meta = json.dumps({
        "link": f"/bqms?rfq_id={rfq_id}",
        "push_status": "failed",
        "rfq_number": rfq_no,
        "watchdog": True,
        "stuck_minutes": age_min,
    })
    cur.execute(
        """
        INSERT INTO notifications (recipient_id, type, title, body, ref_type, ref_id, metadata)
        SELECT id, 'bqms_rfq_new', %s, %s, 'bqms_rfq', %s, %s::jsonb
          FROM users
         WHERE role::text = 'admin' AND COALESCE(is_active, true) = true
        """,
        (title, body, rfq_id, meta),
    )
    stats["notified"] += cur.rowcount or 0

    # 3. retry_queue — bản ghi hiển thị ở /admin/retry-queue. Chống trùng: chỉ chèn
    #    nếu chưa có bản ghi MỞ (pending/retrying) cho đúng rfq_id này.
    job_data = json.dumps({
        "rfq_id": rfq_id,
        "rfq_number": rfq_no,
        "round": row.get("round") or 0,
        "reason": "worker_oom_stuck",
    })
    cur.execute(
        """
        INSERT INTO retry_queue (job_type, job_data, status, last_error, next_retry_at)
        SELECT 'bqms_push', %s::jsonb, 'pending', %s, NOW()
        WHERE NOT EXISTS (
            SELECT 1 FROM retry_queue
             WHERE job_type = 'bqms_push'
               AND status IN ('pending', 'retrying')
               AND (job_data->>'rfq_id') = %s
        )
        """,
        (job_data, err[:1000], str(rfq_id)),
    )
    stats["queued_retry"] += cur.rowcount or 0
