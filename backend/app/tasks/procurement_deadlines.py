"""
Procurement Deadline Tick — P3 SCHEDULER (Thang 2026-06-22).

A Procrastinate periodic task that sweeps the vendor-bidding pipeline every
5 minutes and drives two time-based transitions that no human action triggers:

  (A) AUTO-CLOSE
      For each batch status='published' AND bid_deadline <= NOW():
        - flip status → 'evaluating' (+ evaluating_at = NOW()), mirroring the
          manual PATCH /batches/{id}/evaluating endpoint
        - append procurement_audit_log action='deadline_auto_close'
          (actor_id NULL == system actor)
        - mark that batch's still-open invitations (status IN
          ('invited','viewed')) missed_deadline = true.

  (B) REMINDERS
      For each batch status='published' whose bid_deadline falls within the
      next N hours (N = app_config 'procurement_deadline_reminder_hours',
      default 24):
        - for invitations status IN ('invited','viewed') AND
          reminder_sent_at IS NULL:
            * INSERT a vendor-scoped notification (recipient_vendor_id set,
              recipient_id = the vendor's own user account as FK placeholder —
              exactly the convention in services/procurement_notifications.py)
            * enqueue the reminder email by DEFERRING the existing
              send_email_notification task, reusing the login-invitation HTML
              builder (_build_login_invitation_email) — DRY, no duplicate email
              transport here
            * SET reminder_sent_at = NOW()  ← makes the reminder idempotent;
              a row is reminded at most once per (batch, invitation).

  (C) SUMMARY
      Log + return a summary dict.

Idempotency / safety
--------------------
- The WHOLE sweep runs under a Postgres advisory lock (pg_try_advisory_lock on
  hashtext('procurement_deadline_tick')) so two overlapping ticks (or a tick on
  two scheduler replicas) never double-process. If the lock is busy we skip
  this run quietly — the next tick (5 min) picks up.
- AUTO-CLOSE only matches status='published', so a batch already moved to
  'evaluating' is never touched again.
- REMINDERS gate on reminder_sent_at IS NULL, so each invitation is reminded
  exactly once even across overlapping windows.
- Email is best-effort: we SET reminder_sent_at and INSERT the in-app
  notification in the same committed transaction, then defer the email. If the
  worker dies before the defer, the in-app notification still exists and the
  reminder is not re-sent (idempotent by design — we never spam).
- queue='notifications' (the queue sc-scheduler / the notifications worker
  runs), same as check_deadline_reminders.

DB access is a SYNC psycopg2 connection (SYNC_DSN) so it runs safely inside the
Procrastinate worker process, identical to fx_rates_sync / notifications tasks.
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from typing import Any

import psycopg2
import psycopg2.extras

from app.core.procrastinate_app import app, SYNC_DSN

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

LOCK_KEY = "procurement_deadline_tick"
DEFAULT_REMINDER_HOURS = 24
REMINDER_HOURS_CONFIG_KEY = "procurement_deadline_reminder_hours"

# Invitation statuses that are still "open" (vendor hasn't quoted / declined).
_OPEN_INVITE_STATUSES = ("invited", "viewed")

# --- #17 Delivery-due alerts (INTERNAL-ONLY) -------------------------------
# Sweep open POs whose requested_delivery_date is within N days (due-soon) or
# already past (overdue) and notify the INTERNAL procurement team ONCE per PO.
DEFAULT_DELIVERY_ALERT_DAYS = 3
DELIVERY_ALERT_DAYS_KEY = "procurement_delivery_due_alert_days"      # C1: ngưỡng N ngày
DELIVERY_ENABLED_KEY = "procurement_delivery_due_alert_enabled"     # master-switch
DELIVERY_FLOOR_DATE_KEY = "procurement_delivery_due_floor_date"     # sàn ngày (chống bão lần đầu)
# PO statuses that mean "chưa giao xong" (still expecting delivery).
_OPEN_PO_STATUSES = ("open", "partially_delivered")
# INTERNAL recipients (vendor scope is NEVER notified — recipient_vendor_id=NULL).
_INTERNAL_ROLES = ("admin", "manager", "procurement")


# ---------------------------------------------------------------------------
# Periodic task — every 5 minutes
# ---------------------------------------------------------------------------

@app.periodic(cron="*/5 * * * *")
@app.task(
    name="procurement_deadline_tick",
    queue="notifications",
    queueing_lock="procurement_deadline_tick",
)
def procurement_deadline_tick(timestamp: int = 0) -> dict[str, Any]:
    """Sweep published batches: auto-close past deadline + send pre-deadline reminders."""
    started_at = datetime.now(timezone.utc)
    t0 = time.monotonic()
    logger.info("procurement_deadline_tick: start (utc=%s)", started_at.isoformat())

    summary: dict[str, Any] = {
        "auto_closed_batches":   0,
        "missed_invitations":    0,
        "reminders_sent":        0,
        "reminder_emails_queued": 0,
        "delivery_alerts_sent":  0,
        "skipped_locked":        False,
        "errors":                [],
        "started_at":            started_at.isoformat(),
    }

    conn = psycopg2.connect(SYNC_DSN)
    try:
        conn.autocommit = False
        # ---- Advisory lock: serialize the whole sweep (non-blocking) ----
        with conn.cursor() as cur:
            cur.execute("SELECT pg_try_advisory_lock(hashtext(%s))", (LOCK_KEY,))
            got_lock = bool(cur.fetchone()[0])
        if not got_lock:
            logger.info("procurement_deadline_tick: lock busy — skipping this run")
            summary["skipped_locked"] = True
            conn.rollback()
            return summary

        try:
            reminder_hours = _read_reminder_hours(conn)
            summary["reminder_hours"] = reminder_hours

            # (A) AUTO-CLOSE — commit on its own so a later reminder error
            #     can't undo a legitimate close.
            closed, missed = _auto_close_past_deadline(conn)
            conn.commit()
            summary["auto_closed_batches"] = closed
            summary["missed_invitations"] = missed

            # (B) REMINDERS — returns deferred-email payloads to fire AFTER commit
            #     so an email defer failure never rolls back reminder_sent_at.
            sent, email_jobs = _send_reminders(conn, reminder_hours)
            conn.commit()
            summary["reminders_sent"] = sent

            queued = _defer_reminder_emails(email_jobs)
            summary["reminder_emails_queued"] = queued

            # (B2) #17 DELIVERY-DUE ALERTS — INTERNAL-ONLY. Master-switch gated so
            #      the feature can deploy "im lặng" (enabled=false) and be turned on
            #      later WITHOUT a code deploy. Own commit so it can't undo (A)/(B).
            if _config_bool(conn, DELIVERY_ENABLED_KEY, True):
                alert_days = _config_int(
                    conn, DELIVERY_ALERT_DAYS_KEY, DEFAULT_DELIVERY_ALERT_DAYS
                )
                floor_date = _config_date(conn, DELIVERY_FLOOR_DATE_KEY)
                delivery_alerts = _send_delivery_due_alerts(conn, alert_days, floor_date)
                conn.commit()
                summary["delivery_alerts_sent"] = delivery_alerts
                summary["delivery_alert_days"] = alert_days

        finally:
            # If the sweep raised mid-transaction the txn is aborted and the
            # unlock query would itself error — roll back first so the cursor is
            # usable. (The session-level lock is also freed on conn.close(), but
            # release it explicitly + preserve the real exception for the except.)
            try:
                conn.rollback()
            except Exception:  # noqa: BLE001
                pass
            try:
                with conn.cursor() as cur:
                    cur.execute("SELECT pg_advisory_unlock(hashtext(%s))", (LOCK_KEY,))
                conn.commit()
            except Exception:  # noqa: BLE001
                logger.warning(
                    "procurement_deadline_tick: advisory unlock failed "
                    "(lock is released on connection close)"
                )

    except Exception as exc:  # noqa: BLE001 — best-effort sweep, log + report
        conn.rollback()
        logger.exception("procurement_deadline_tick: failed: %s", exc)
        summary["errors"].append(str(exc))
    finally:
        conn.close()

    summary["duration_s"] = round(time.monotonic() - t0, 2)
    logger.info(
        "procurement_deadline_tick: done auto_closed=%d missed=%d reminders=%d "
        "emails=%d delivery_alerts=%d skipped_locked=%s errors=%d in %.2fs",
        summary["auto_closed_batches"], summary["missed_invitations"],
        summary["reminders_sent"], summary["reminder_emails_queued"],
        summary["delivery_alerts_sent"],
        summary["skipped_locked"], len(summary["errors"]), summary["duration_s"],
    )
    return summary


# ---------------------------------------------------------------------------
# (A) AUTO-CLOSE
# ---------------------------------------------------------------------------

def _auto_close_past_deadline(conn) -> tuple[int, int]:
    """Flip published batches past bid_deadline → evaluating + audit + mark misses.

    Returns (batches_closed, invitations_marked_missed). Caller owns the commit.
    """
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        # Lock the rows we are about to transition so a concurrent manual
        # award/evaluating PATCH and this sweep can't race on the same batch.
        cur.execute(
            """
            SELECT id, batch_code
            FROM procurement_rfq_batches
            WHERE status = 'published'
              AND bid_deadline IS NOT NULL
              AND bid_deadline <= NOW()
            ORDER BY id
            FOR UPDATE SKIP LOCKED
            """
        )
        batches = cur.fetchall()

    closed = 0
    missed_total = 0
    for b in batches:
        batch_id = b["id"]
        with conn.cursor() as cur:
            # Transition. The status guard in WHERE makes this a no-op if some
            # other path already moved it; rowcount tells us if WE closed it.
            cur.execute(
                """
                UPDATE procurement_rfq_batches
                   SET status = 'evaluating', evaluating_at = NOW()
                 WHERE id = %s AND status = 'published'
                """,
                (batch_id,),
            )
            if cur.rowcount == 0:
                continue
            closed += 1

            # Audit: actor_id NULL == system. Mirrors api/v1/procurement._audit
            # column order; detail carries batch_code + reason for the timeline.
            cur.execute(
                """
                INSERT INTO procurement_audit_log
                    (entity_type, entity_id, action, from_status, to_status,
                     actor_id, actor_vendor_id, detail, ip)
                VALUES ('batch', %s, 'deadline_auto_close', 'published', 'evaluating',
                        NULL, NULL, %s::jsonb, NULL)
                """,
                (
                    batch_id,
                    psycopg2.extras.Json(
                        {
                            "batch_code": b["batch_code"],
                            "reason": "bid_deadline reached",
                            "by": "system:procurement_deadline_tick",
                        }
                    ),
                ),
            )

            # Mark still-open invitations as having missed the deadline.
            cur.execute(
                """
                UPDATE procurement_rfq_invitations
                   SET missed_deadline = true
                 WHERE batch_id = %s
                   AND status = ANY(%s)
                   AND missed_deadline IS DISTINCT FROM true
                """,
                (batch_id, list(_OPEN_INVITE_STATUSES)),
            )
            batch_missed = cur.rowcount
            missed_total += batch_missed

        logger.info(
            "procurement_deadline_tick: auto-closed batch #%s (%s), %d invitations missed",
            batch_id, b["batch_code"], batch_missed,
        )

    return closed, missed_total


# ---------------------------------------------------------------------------
# (B) REMINDERS
# ---------------------------------------------------------------------------

def _send_reminders(conn, reminder_hours: int) -> tuple[int, list[dict[str, Any]]]:
    """Insert vendor notifications + stamp reminder_sent_at for upcoming deadlines.

    Returns (reminders_sent, email_jobs). email_jobs is a list of payloads to
    `send_email_notification.defer(...)` AFTER the caller commits — so a defer
    failure can never roll back the reminder_sent_at stamp (no duplicate spam).
    Caller owns the commit.
    """
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        # Open batches whose deadline is in the (NOW, NOW + N h) window, joined
        # to their still-open, not-yet-reminded invitations + the vendor email.
        # FOR UPDATE on the invitation row prevents two ticks reminding twice.
        cur.execute(
            """
            SELECT
                inv.id              AS invitation_id,
                inv.vendor_id       AS vendor_id,
                va.user_id          AS vendor_user_id,
                va.company_name     AS company_name,
                va.contact_name     AS contact_name,
                u.email             AS email,
                b.id                AS batch_id,
                b.batch_code        AS batch_code,
                b.title             AS batch_title,
                b.item_count        AS item_count,
                b.bid_deadline      AS bid_deadline
            FROM procurement_rfq_invitations inv
            JOIN procurement_rfq_batches b ON b.id = inv.batch_id
            JOIN vendor_accounts va        ON va.id = inv.vendor_id
            LEFT JOIN users u              ON u.id = va.user_id
            WHERE b.status = 'published'
              AND b.bid_deadline IS NOT NULL
              AND b.bid_deadline > NOW()
              AND b.bid_deadline <= NOW() + (%s || ' hours')::interval
              AND inv.status = ANY(%s)
              AND inv.reminder_sent_at IS NULL
            ORDER BY inv.id
            FOR UPDATE OF inv SKIP LOCKED
            """,
            (str(reminder_hours), list(_OPEN_INVITE_STATUSES)),
        )
        rows = cur.fetchall()

    sent = 0
    email_jobs: list[dict[str, Any]] = []
    for r in rows:
        invitation_id = r["invitation_id"]
        vendor_id = r["vendor_id"]
        vendor_user_id = r["vendor_user_id"]
        batch_id = r["batch_id"]
        deadline = r["bid_deadline"]

        title = f"Sắp hết hạn báo giá — phiên #{r['batch_code']}"
        message = (
            f"Phiên đấu thầu \"{r['batch_title']}\" sẽ đóng lúc {deadline}. "
            "Quý đơn vị vui lòng đăng nhập cổng NCC để gửi báo giá trước hạn."
        )

        with conn.cursor() as cur:
            # In-app vendor-scoped notification. recipient_id = vendor's own user
            # account (FK placeholder; recipient_id is NOT NULL on the base
            # table) and recipient_vendor_id = vendor_accounts.id — the vendor
            # feed scopes by recipient_vendor_id, so this never reaches an admin
            # inbox. Same convention as services/procurement_notifications.py.
            if vendor_user_id is not None:
                cur.execute(
                    """
                    INSERT INTO notifications
                        (recipient_id, recipient_vendor_id, type, title, body,
                         ref_type, ref_id, metadata)
                    VALUES (%s::uuid, %s, 'procurement_quote', %s, %s,
                            'batch', %s, %s::jsonb)
                    """,
                    (
                        str(vendor_user_id), int(vendor_id), title, message,
                        batch_id,
                        psycopg2.extras.Json(
                            {
                                "batch_id": batch_id,
                                "batch_code": r["batch_code"],
                                "kind": "deadline_reminder",
                                "bid_deadline": deadline.isoformat() if deadline else None,
                            }
                        ),
                    ),
                )
            else:
                logger.warning(
                    "procurement_deadline_tick: vendor_id=%s has no user_id — "
                    "skipping in-app reminder (still stamping reminder_sent_at)",
                    vendor_id,
                )

            # Stamp reminder_sent_at — idempotency gate (only if still null).
            cur.execute(
                """
                UPDATE procurement_rfq_invitations
                   SET reminder_sent_at = NOW()
                 WHERE id = %s AND reminder_sent_at IS NULL
                """,
                (invitation_id,),
            )
            if cur.rowcount == 0:
                # Lost the race / already reminded — skip this row entirely.
                continue

        sent += 1

        # Queue the email (deferred AFTER commit). Reuse the login-invitation
        # HTML builder so the message style matches the original invite.
        email = (r["email"] or "").strip().lower()
        if email and "@" in email:
            email_jobs.append(
                {
                    "email": email,
                    "batch_id": batch_id,
                    "batch_code": r["batch_code"],
                    "batch_title": r["batch_title"],
                    "invitee_name": r["contact_name"] or r["company_name"] or email,
                    "item_count": r["item_count"] or 0,
                }
            )

    return sent, email_jobs


def _defer_reminder_emails(email_jobs: list[dict[str, Any]]) -> int:
    """Enqueue one send_email_notification job per reminder. Best-effort.

    Runs AFTER the reminder transaction has committed; reuses the existing
    notification email task (queue='notifications') and the login-invitation
    HTML builder. Never raises — a defer failure leaves the in-app notification
    + reminder_sent_at intact (we simply don't re-send to avoid spam).
    """
    # Thang 30/06: ĐÃ TẮT email nhắc hạn cho NCC — admin tự gửi link đăng nhập.
    # Thông báo TRONG CỔNG + reminder_sent_at + auto-close vẫn chạy (ở _send_reminders);
    # chỉ bỏ phần defer email. Trả 0 ngay để không enqueue job email nào.
    if email_jobs:
        logger.info("reminder emails disabled — skip %d email job(s)", len(email_jobs))
    return 0

    # (unreachable) — giữ lại để tham khảo nếu cần bật lại email sau này.
    # Imported lazily to avoid a hard import cycle at task-registration time.
    from app.api.v1.procurement import _build_login_invitation_email, _vendor_portal_base
    from app.tasks.notifications import send_email_notification

    base = _vendor_portal_base()
    queued = 0
    for job in email_jobs:
        try:
            login_url = f"{base}/login?next=/batches/{job['batch_id']}"
            subject = (
                f"[Song Châu] Sắp hết hạn báo giá phiên #{job['batch_code']} "
                f"— {job['batch_title']}"
            )
            body_html = _build_login_invitation_email(
                batch_code=job["batch_code"],
                batch_title=job["batch_title"],
                invitee_name=job["invitee_name"],
                login_url=login_url,
                item_count=job["item_count"],
            )
            send_email_notification.defer(
                recipient_email=job["email"],
                subject=subject,
                body=body_html,
            )
            queued += 1
        except Exception as exc:  # noqa: BLE001 — best-effort email
            logger.warning(
                "procurement_deadline_tick: defer reminder email to %s failed: %s",
                job.get("email"), exc,
            )

    return queued


# ---------------------------------------------------------------------------
# (B2) #17 DELIVERY-DUE ALERTS — INTERNAL-ONLY
# ---------------------------------------------------------------------------

def _send_delivery_due_alerts(conn, alert_days: int, floor_date) -> int:
    """Notify the INTERNAL procurement team about POs due-soon / overdue, ONCE per PO.

    INTERNAL-ONLY (ràng buộc bảo mật cứng):
      * recipient_vendor_id = NULL on EVERY insert -> never reaches a vendor feed
        (vendor feed scopes by recipient_vendor_id; admin feed by recipient_id).
      * recipients are ACTIVE admin/manager/procurement users only.
      * metadata carries NO price / ranking / competitor name.

    Idempotency (C2 — KHÔNG spam):
      * gate on procurement_pos.delivery_reminder_sent_at IS NULL + FOR UPDATE
        SKIP LOCKED so two overlapping ticks never double-notify;
      * after fan-out we stamp delivery_reminder_sent_at = NOW() guarded by
        `AND delivery_reminder_sent_at IS NULL` -> rowcount 0 == lost race -> skip.

    Window: requested_delivery_date <= CURRENT_DATE + alert_days (covers overdue,
    which are <= today). `floor_date` (app_config sàn ngày) suppresses a first-run
    storm of long-overdue legacy POs: a PO whose due date is BEFORE the floor is
    skipped. Caller OWNS the commit.
    """
    # Recipients: active internal users. Empty -> nothing to notify (return early).
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id
            FROM users
            WHERE role = ANY(%s::role_enum[])
              AND is_active = true
              AND deleted_at IS NULL
            """,
            (list(_INTERNAL_ROLES),),
        )
        user_ids = [r[0] for r in cur.fetchall()]
    if not user_ids:
        logger.info("[DELIVERY_DUE] no internal recipients (admin/manager/procurement) — skip")
        return 0

    # Due / overdue open POs not yet reminded. floor_date (may be None) bounds the
    # lower edge so we don't notify ancient overdue POs on the very first enable.
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(
            """
            SELECT
                p.id                       AS po_id,
                p.po_no                    AS po_no,
                p.batch_id                 AS batch_id,
                p.vendor_name              AS vendor_name,
                p.requested_delivery_date  AS req_date,
                (p.requested_delivery_date - CURRENT_DATE)::int AS days_remaining
            FROM procurement_pos p
            WHERE p.status = ANY(%s)
              AND p.requested_delivery_date IS NOT NULL
              AND p.requested_delivery_date <= CURRENT_DATE + (%s || ' days')::interval
              AND (%s::date IS NULL OR p.requested_delivery_date >= %s::date)
              AND p.delivery_reminder_sent_at IS NULL
            ORDER BY p.id
            FOR UPDATE OF p SKIP LOCKED
            """,
            (list(_OPEN_PO_STATUSES), str(int(alert_days)), floor_date, floor_date),
        )
        pos = cur.fetchall()

    sent = 0
    for po in pos:
        po_id = po["po_id"]
        days_remaining = po["days_remaining"]
        req_date = po["req_date"]
        # Severity: overdue if the due date is in the past, else due-soon.
        overdue = days_remaining is not None and days_remaining < 0
        severity = "overdue" if overdue else "due_soon"
        date_str = req_date.isoformat() if req_date else "—"

        if overdue:
            title = f"Quá hạn giao — PO {po['po_no']}"
            body = (
                f"Đơn hàng {po['po_no']} ({po['vendor_name']}) đã QUÁ HẠN giao "
                f"{abs(days_remaining)} ngày (hạn {date_str}). Vui lòng kiểm tra tiến độ."
            )
        else:
            title = f"Sắp đến hạn giao — PO {po['po_no']}"
            body = (
                f"Đơn hàng {po['po_no']} ({po['vendor_name']}) sắp tới hạn giao "
                f"sau {days_remaining} ngày (hạn {date_str})."
            )

        metadata = psycopg2.extras.Json(
            {
                "kind": "delivery_due",
                "severity": severity,
                "po_id": po_id,
                "po_no": po["po_no"],
                "batch_id": po["batch_id"],
                "days_remaining": days_remaining,
                "requested_delivery_date": date_str,
            }
        )

        # Stamp the gate FIRST (idempotency). If another tick already grabbed it
        # the rowcount is 0 -> skip without notifying (no duplicate spam).
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE procurement_pos
                   SET delivery_reminder_sent_at = NOW()
                 WHERE id = %s AND delivery_reminder_sent_at IS NULL
                """,
                (po_id,),
            )
            if cur.rowcount == 0:
                continue

            # Fan-out ONE internal notification per recipient. recipient_vendor_id
            # is ALWAYS NULL (INTERNAL-ONLY). ref_type='batch', ref_id=batch_id so
            # the deep-link opens the vendor-bidding batch (NULL ref_id is fine —
            # FE falls back to the cockpit). type='procurement_po' (enum exists).
            for uid in user_ids:
                cur.execute(
                    """
                    INSERT INTO notifications
                        (recipient_id, recipient_vendor_id, type, title, body,
                         ref_type, ref_id, metadata)
                    VALUES (%s::uuid, NULL, 'procurement_po', %s, %s,
                            'batch', %s, %s::jsonb)
                    """,
                    (str(uid), title, body, po["batch_id"], metadata),
                )

        sent += 1
        logger.info(
            "[DELIVERY_DUE] po=%s severity=%s days=%s recipients=%d",
            po["po_no"], severity, days_remaining, len(user_ids),
        )

    logger.info("[DELIVERY_DUE] sent=%d alert_days=%d", sent, alert_days)
    return sent


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _config_raw(conn, key: str) -> str | None:
    """Read a raw app_config value as text (JSONB ::text). None if absent/error."""
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT value::text FROM app_config WHERE key = %s", (key,))
            row = cur.fetchone()
        if not row or row[0] is None:
            return None
        return str(row[0]).strip().strip('"')
    except Exception as exc:  # noqa: BLE001 — config is optional
        logger.warning("procurement_deadline_tick: could not read app_config %s: %s", key, exc)
        return None


def _config_int(conn, key: str, default: int) -> int:
    """Read an int app_config value (stored as bare JSON number/string). Fail-safe."""
    raw = _config_raw(conn, key)
    if raw is None:
        return default
    try:
        val = int(float(raw))
        return val if val >= 0 else default
    except (TypeError, ValueError):
        return default


def _config_bool(conn, key: str, default: bool) -> bool:
    """Read a bool app_config value ('true'/'false'/1/0). Fail-safe to default."""
    raw = _config_raw(conn, key)
    if raw is None:
        return default
    low = raw.lower()
    if low in ("true", "1", "yes", "on"):
        return True
    if low in ("false", "0", "no", "off"):
        return False
    return default


def _config_date(conn, key: str):
    """Read a 'YYYY-MM-DD' app_config value -> datetime.date, else None (no floor)."""
    raw = _config_raw(conn, key)
    if not raw:
        return None
    try:
        from datetime import date as _date
        return _date.fromisoformat(raw[:10])
    except (TypeError, ValueError):
        return None


def _read_reminder_hours(conn) -> int:
    """Read app_config 'procurement_deadline_reminder_hours' (default 24).

    Value may be stored as a bare JSON number, a JSON string, or plain text —
    parse defensively. Fail-safe to the default on any problem.
    """
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT value::text FROM app_config WHERE key = %s",
                (REMINDER_HOURS_CONFIG_KEY,),
            )
            row = cur.fetchone()
        if not row or row[0] is None:
            return DEFAULT_REMINDER_HOURS
        raw = str(row[0]).strip().strip('"')
        hours = int(float(raw))
        return hours if hours > 0 else DEFAULT_REMINDER_HOURS
    except Exception as exc:  # noqa: BLE001 — config is optional
        logger.warning(
            "procurement_deadline_tick: could not read %s, using default %dh: %s",
            REMINDER_HOURS_CONFIG_KEY, DEFAULT_REMINDER_HOURS, exc,
        )
        return DEFAULT_REMINDER_HOURS
