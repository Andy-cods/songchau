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
                  WHERE n2.link = '/workflows/' || wi.id::text
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
            current_state=row["current_state"],
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
                  WHERE n2.link = '/workflows/' || wi.id::text
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
            current_state=row["current_state"],
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
            INSERT INTO notifications (recipient_id, type, title, body, link)
            VALUES (%s::uuid, %s, %s, %s, %s)
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
            INSERT INTO notifications (recipient_id, type, title, body, link)
            SELECT u.id, %s, %s, %s, %s
            FROM users u
            WHERE {role_filter}
              AND u.is_active = true
              AND NOT EXISTS (
                  SELECT 1 FROM notifications n2
                  WHERE n2.recipient_id = u.id
                    AND n2.link = %s
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
        f"hiện đang ở trạng thái <code>{row['current_state']}</code> "
        f"và <strong>{label}</strong> kể từ {row['deadline']}."
        "</p>"
        "<p>"
        f'Vui lòng truy cập <a href="{wf_url}">hệ thống ERP Song Châu</a> để xử lý.'
        "</p>"
        "<p>Trân trọng,<br/>Hệ thống ERP Song Châu</p>"
    )
