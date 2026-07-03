"""
Notification Tasks.

send_email_notification
    Deliver an email via Microsoft Graph API (send mail on behalf of a
    shared mailbox).  The M365 credentials come from app.core.config.settings.

check_deadline_reminders
    Runs hourly.  Finds workflows whose deadline is within the next 24 hours
    (or already past), creates in-app notifications, and dispatches email
    reminders by enqueuing send_email_notification tasks.

All DB access uses a sync psycopg2 connection so it runs safely inside a
Procrastinate worker process.

---------------------------------------------------------------------------
RANH GIỚI 2 HỆ NOTIFICATION (W3-08, 2026-07-04) — đọc trước khi thêm loại
thông báo mới, để tránh tạo trùng cho cùng 1 sự kiện.
---------------------------------------------------------------------------
Cả 2 hệ ghi vào CÙNG bảng `notifications` nhưng có trigger khác nhau:

  HỆ A — "canh giờ" (cron/periodic, module này + các file cùng nhóm):
    - app/tasks/notifications.py           (file này) — deadline workflow
      chung (payment_request/leave...), chạy hourly.
    - app/tasks/procurement_deadlines.py   — deadline riêng đấu thầu NCC
      (hạn báo giá NCC sắp hết, PO sắp/quá hạn giao hàng).
    - app/tasks/bqms_push_watchdog.py      — job đẩy báo giá Samsung bị treo.
    Đặc điểm: KHÔNG gắn với 1 hành động user cụ thể — tự truy vấn "cái gì đã
    đến hạn" theo lịch, có điều kiện chống lặp riêng (time window / cờ
    reminder_sent_at) để không nhắc lại nhiều lần cho cùng 1 deadline.

  HỆ B — "theo sự kiện nghiệp vụ" (event-driven, gọi ngay sau 1 hành động):
    - app/services/event_notifications.py       — PO mới từ Samsung, đổi
      trạng thái giao hàng, RFQ nhảy vòng V1→V2/V3.
    - app/services/procurement_notifications.py — 15+ sự kiện đấu thầu NCC
      (award, quote submit/decline/withdraw, contract, PO, delivery, Q&A...).
    - app/services/workflow_engine.py::_notify  — workflow đổi trạng thái
      (duyệt/từ chối/đóng) trong advance_workflow().
    - app/services/bqms_service.py              — báo giá BQMS cần Manager
      duyệt.
    - INSERT rải rác ngay trong router sau khi ghi DB thành công: leave.py,
      payment_requests.py, sourcing.py, task_assignments.py,
      batch_operations.py, users.py, vendor/profile.py.
    Đặc điểm: gọi NGAY sau 1 hành động (tạo/duyệt/từ chối/đổi trạng thái),
    không định kỳ, không cần chống lặp theo thời gian (mỗi hành động = 1 lần).

  Router đọc/quản lý (không tạo notification, chỉ CRUD cho người dùng cuối):
    - app/api/v1/notifications.py       — inbox chính (list/read/mark-read).
    - app/api/v1/smart_notifications.py — /preferences (bật/tắt theo loại) +
      admin gửi thông báo thủ công. FE /notifications/settings hiện CHƯA nối
      vào /preferences (gọi nhầm sang notifications.py) — biết vấn đề, chưa
      sửa ở đợt này (ngoài phạm vi W3-08, xem module-readiness.ts key
      'notifications').

  QUY TẮC khi thêm loại thông báo mới: nếu sự kiện có mốc "đến hạn" cần nhắc
  lặp lại theo thời gian → thêm vào Hệ A (cron), có điều kiện chống lặp rõ
  ràng. Nếu sự kiện là kết quả trực tiếp của 1 hành động user → thêm vào Hệ B
  (gọi ngay sau khi ghi DB), KHÔNG thêm cron riêng cho việc này (tránh trùng).

  Rủi ro đã biết (chưa phải bug đang chạy, chỉ là bẫy cho tương lai):
  app/services/workflow_engine.py::check_timeouts() định nghĩa loại
  'workflow_timeout' giống ý tưởng "canh giờ" của module này, nhưng KHÔNG có
  cron/scheduler nào gọi nó hiện tại (xác nhận qua grep toàn repo). Nếu sau
  này có người nối nó vào scheduler, cần kiểm tra không bị trùng với
  check_deadline_reminders() bên dưới trước khi bật.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

import psycopg2
import psycopg2.extras

from app.core.procrastinate_app import app, SYNC_DSN

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# send_email_notification
# ---------------------------------------------------------------------------

@app.task(name="send_email_notification", queue="notifications")
def send_email_notification(
    recipient_email: str,
    subject: str,
    body: str,
    *,
    content_type: str = "HTML",
) -> dict[str, Any]:
    """
    Send an email via Microsoft Graph API.

    Parameters
    ----------
    recipient_email : Destination email address.
    subject         : Email subject line.
    body            : Email body (HTML by default).
    content_type    : 'HTML' or 'Text'.

    Returns a result dict with 'sent' bool and optional 'error' string.
    """
    from app.core.config import settings

    logger.info("send_email_notification: to=%s subject=%r", recipient_email, subject[:60])

    # ------------------------------------------------------------------
    # Guard: skip if M365 credentials are not configured
    # ------------------------------------------------------------------
    if not all([settings.M365_TENANT_ID, settings.M365_CLIENT_ID, settings.M365_CLIENT_SECRET]):
        logger.warning(
            "send_email_notification: M365 credentials not configured — "
            "skipping email to %s",
            recipient_email,
        )
        return {
            "sent":  False,
            "error": "M365 credentials not configured",
            "to":    recipient_email,
        }

    # ------------------------------------------------------------------
    # Acquire an access token via MSAL client-credentials flow
    # ------------------------------------------------------------------
    try:
        import msal

        authority = f"https://login.microsoftonline.com/{settings.M365_TENANT_ID}"
        msal_app  = msal.ConfidentialClientApplication(
            settings.M365_CLIENT_ID,
            authority=authority,
            client_credential=settings.M365_CLIENT_SECRET,
        )
        token_result = msal_app.acquire_token_for_client(
            scopes=["https://graph.microsoft.com/.default"]
        )

        if "access_token" not in token_result:
            raise RuntimeError(
                f"MSAL token error: {token_result.get('error_description', token_result)}"
            )

        access_token = token_result["access_token"]

    except Exception as exc:
        logger.error("send_email_notification: token acquisition failed: %s", exc)
        return {"sent": False, "error": str(exc), "to": recipient_email}

    # ------------------------------------------------------------------
    # Send the message via Microsoft Graph /sendMail endpoint
    # ------------------------------------------------------------------
    try:
        import httpx

        # Use a shared mailbox or the app's own mailbox.
        # The sender UPN should ideally come from settings; default to a
        # placeholder that must be overridden in production.
        sender_upn = getattr(settings, "M365_SENDER_UPN", "erp@songchau.com.vn")

        graph_url = (
            f"https://graph.microsoft.com/v1.0/users/{sender_upn}/sendMail"
        )
        payload = {
            "message": {
                "subject": subject,
                "body": {
                    "contentType": content_type,
                    "content":     body,
                },
                "toRecipients": [
                    {"emailAddress": {"address": recipient_email}}
                ],
            },
            "saveToSentItems": True,
        }
        headers = {
            "Authorization": f"Bearer {access_token}",
            "Content-Type":  "application/json",
        }

        with httpx.Client(timeout=30) as client:
            resp = client.post(graph_url, json=payload, headers=headers)

        if resp.status_code == 202:
            logger.info("send_email_notification: sent to %s", recipient_email)
            return {"sent": True, "to": recipient_email}
        else:
            error_text = resp.text[:300]
            logger.warning(
                "send_email_notification: Graph API returned %d: %s",
                resp.status_code, error_text,
            )
            return {
                "sent":  False,
                "error": f"HTTP {resp.status_code}: {error_text}",
                "to":    recipient_email,
            }

    except Exception as exc:
        logger.error("send_email_notification: send failed: %s", exc)
        return {"sent": False, "error": str(exc), "to": recipient_email}


# ---------------------------------------------------------------------------
# check_deadline_reminders
# ---------------------------------------------------------------------------

@app.periodic(cron="0 * * * *")   # every hour on the hour
@app.task(name="check_deadline_reminders", queue="notifications")
def check_deadline_reminders(timestamp: int = 0) -> dict[str, Any]:  # type: ignore[misc]
    """
    Find workflows approaching or past their deadline and send reminders.

    Logic
    -----
    - Workflows with deadline BETWEEN now AND now+24h → "upcoming" reminder.
    - Workflows with deadline < now and still in a pending state → "overdue".
    - A notification row is inserted only if one has NOT been sent in the
      last 24 hours for the same workflow + reminder_type combination.
    - An email is dispatched for each affected approver.

    Returns a dict with counts of notifications created.
    """
    now     = datetime.now(timezone.utc)
    horizon = now + timedelta(hours=24)

    logger.info("check_deadline_reminders: running (utc=%s)", now.isoformat())

    upcoming_count = 0
    overdue_count  = 0

    conn = psycopg2.connect(SYNC_DSN)
    try:
        with conn:
            upcoming_count = _process_upcoming(conn, now, horizon)
            overdue_count  = _process_overdue(conn, now)
    finally:
        conn.close()

    result = {
        "upcoming_reminders": upcoming_count,
        "overdue_reminders":  overdue_count,
        "checked_at":         now.isoformat(),
    }
    logger.info(
        "check_deadline_reminders: upcoming=%d overdue=%d",
        upcoming_count, overdue_count,
    )
    return result


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _process_upcoming(
    conn: psycopg2.extensions.connection,
    now: datetime,
    horizon: datetime,
) -> int:
    """Create 'upcoming deadline' notifications and enqueue emails."""
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """
            SELECT
                wi.id::text          AS workflow_id,
                wi.title,
                wi.current_status,
                wi.deadline,
                wi.created_by::text  AS created_by,
                u.email              AS creator_email,
                u.full_name          AS creator_name
            FROM workflow_instances wi
            LEFT JOIN users u ON u.id = wi.created_by
            WHERE wi.deadline BETWEEN %s AND %s
              AND wi.current_status IN ('pending_l1', 'pending_l2')
              AND NOT EXISTS (
                  SELECT 1 FROM notifications n2
                  WHERE n2.metadata->>'link' = '/workflows/' || wi.id::text
                    AND n2.type = 'deadline_upcoming'
                    AND n2.created_at >= NOW() - INTERVAL '24 hours'
              )
            """,
            (now, horizon),
        )
        rows = cur.fetchall()

    for row in rows:
        _insert_notification(
            conn,
            recipient_id=row["created_by"],
            notif_type="deadline_upcoming",
            title="Sắp hết hạn phê duyệt",
            body=(
                f'Yêu cầu "{row["title"] or row["workflow_id"]}" '
                f'sẽ hết hạn lúc {row["deadline"]}.'
            ),
            link=f"/workflows/{row['workflow_id']}",
        )

        # Also notify approvers based on current state
        _notify_approvers(
            conn,
            workflow_id=row["workflow_id"],
            current_state=row["current_status"],
            title="Sắp hết hạn phê duyệt",
            body=(
                f'Yêu cầu "{row["title"] or row["workflow_id"]}" '
                f'của {row["creator_name"]} sẽ hết hạn lúc {row["deadline"]}.'
            ),
            link=f"/workflows/{row['workflow_id']}",
            notif_type="deadline_upcoming",
        )

        # Enqueue email to creator
        if row.get("creator_email"):
            send_email_notification.defer(
                recipient_email=row["creator_email"],
                subject="[ERP Song Châu] Sắp hết hạn phê duyệt",
                body=_build_deadline_email_body(row, "upcoming"),
            )

    return len(rows)


def _process_overdue(
    conn: psycopg2.extensions.connection,
    now: datetime,
) -> int:
    """Create 'overdue' notifications for workflows past their deadline."""
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """
            SELECT
                wi.id::text          AS workflow_id,
                wi.title,
                wi.current_status,
                wi.deadline,
                wi.created_by::text  AS created_by,
                u.email              AS creator_email,
                u.full_name          AS creator_name
            FROM workflow_instances wi
            LEFT JOIN users u ON u.id = wi.created_by
            WHERE wi.deadline < %s
              AND wi.current_status IN ('pending_l1', 'pending_l2')
              AND NOT EXISTS (
                  SELECT 1 FROM notifications n2
                  WHERE n2.metadata->>'link' = '/workflows/' || wi.id::text
                    AND n2.type = 'deadline_overdue'
                    AND n2.created_at >= NOW() - INTERVAL '24 hours'
              )
            """,
            (now,),
        )
        rows = cur.fetchall()

    for row in rows:
        _insert_notification(
            conn,
            recipient_id=row["created_by"],
            notif_type="deadline_overdue",
            title="Quá hạn phê duyệt",
            body=(
                f'Yêu cầu "{row["title"] or row["workflow_id"]}" '
                f'đã quá hạn từ {row["deadline"]}.'
            ),
            link=f"/workflows/{row['workflow_id']}",
        )

        _notify_approvers(
            conn,
            workflow_id=row["workflow_id"],
            current_state=row["current_status"],
            title="Quá hạn phê duyệt",
            body=(
                f'Yêu cầu "{row["title"] or row["workflow_id"]}" '
                f'của {row["creator_name"]} đã quá hạn từ {row["deadline"]}.'
            ),
            link=f"/workflows/{row['workflow_id']}",
            notif_type="deadline_overdue",
        )

        if row.get("creator_email"):
            send_email_notification.defer(
                recipient_email=row["creator_email"],
                subject="[ERP Song Châu] Quá hạn phê duyệt",
                body=_build_deadline_email_body(row, "overdue"),
            )

    return len(rows)


def _insert_notification(
    conn: psycopg2.extensions.connection,
    *,
    recipient_id: str,
    notif_type: str,
    title: str,
    body: str,
    link: str,
) -> None:
    """Insert a single notifications row (does not commit — caller owns tx)."""
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO notifications (recipient_id, type, title, body, ref_type, metadata)
            VALUES (%s::uuid, %s, %s, %s, 'workflow', jsonb_build_object('link', %s))
            """,
            (recipient_id, notif_type, title, body, link),
        )


def _notify_approvers(
    conn: psycopg2.extensions.connection,
    *,
    workflow_id: str,
    current_state: str,
    title: str,
    body: str,
    link: str,
    notif_type: str,
) -> None:
    """Insert notifications for all active approvers eligible for this state."""
    if current_state == "pending_l1":
        role_filter = "u.role IN ('manager', 'admin')"
    elif current_state == "pending_l2":
        role_filter = "u.role = 'admin'"
    else:
        return

    with conn.cursor() as cur:
        cur.execute(
            f"""
            INSERT INTO notifications (recipient_id, type, title, body, ref_type, metadata)
            SELECT u.id, %s, %s, %s, 'workflow', jsonb_build_object('link', %s)
            FROM users u
            WHERE {role_filter}
              AND u.is_active = true
              AND NOT EXISTS (
                  SELECT 1 FROM notifications n2
                  WHERE n2.recipient_id = u.id
                    AND n2.metadata->>'link' = %s
                    AND n2.type = %s
                    AND n2.created_at >= NOW() - INTERVAL '24 hours'
              )
            """,
            (notif_type, title, body, link, link, notif_type),
        )


def _build_deadline_email_body(row: dict[str, Any], kind: str) -> str:
    """Build a simple HTML email body for deadline reminders."""
    from app.core.config import settings as _settings

    label    = "sắp hết hạn" if kind == "upcoming" else "đã quá hạn"
    base_url = _settings.APP_URL.rstrip("/")
    wf_url   = f"{base_url}/workflows/{row['workflow_id']}"
    title    = row.get("title") or row["workflow_id"]

    return (
        "<p>Kính gửi,</p>"
        "<p>"
        f"Yêu cầu phê duyệt <strong>{title}</strong> "
        f"hiện đang ở trạng thái <code>{row['current_status']}</code> "
        f"và <strong>{label}</strong> kể từ {row['deadline']}."
        "</p>"
        "<p>"
        f'Vui lòng truy cập <a href="{wf_url}">hệ thống ERP Song Châu</a> để xử lý.'
        "</p>"
        "<p>Trân trọng,<br/>Hệ thống ERP Song Châu</p>"
    )
