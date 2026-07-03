"""Event-driven notifications — emit DB notifications on business events.

Usage:
  - dispatch_new_po(po_numbers: list)            called after BQMS sync inserts
  - dispatch_delivery_status_change(delivery_id, new_status, user_id)
                                                   called on delivery status update

All functions are best-effort: failures are logged but never raise.
"""

from __future__ import annotations

import logging
from typing import Iterable

import asyncpg

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Recipient resolution
# ---------------------------------------------------------------------------

async def _recipients_by_roles(conn: asyncpg.Connection, roles: Iterable[str]) -> list[str]:
    """Return user_ids for active users with any of the given roles."""
    rows = await conn.fetch(
        "SELECT id FROM users WHERE role = ANY($1::role_enum[]) AND is_active = true AND deleted_at IS NULL",
        list(roles),
    )
    return [str(r["id"]) for r in rows]


# ---------------------------------------------------------------------------
# New PO event
# ---------------------------------------------------------------------------

async def dispatch_new_po(
    conn: asyncpg.Connection,
    po_numbers: list[str],
) -> int:
    """Insert `po_received` notification for each new PO to the handler team.

    Recipients: admin + manager + procurement (they all need to see new POs).
    Returns the count of notifications inserted.
    """
    if not po_numbers:
        return 0

    try:
        recipients = await _recipients_by_roles(conn, ["admin", "manager", "procurement"])
        if not recipients:
            return 0

        # Fetch PO details for better notification body
        pos = await conn.fetch(
            """
            SELECT p.id, p.po_number, p.bqms_code, p.amount, p.currency,
                   p.preferred_delivery_date, p.company, p.order_qty
            FROM bqms_samsung_po p
            WHERE p.po_number = ANY($1::text[])
            """,
            po_numbers,
        )

        inserted = 0
        for po in pos:
            title = f"PO mới từ Samsung: {po['po_number']}"
            body_lines = [
                f"Mã: {po['bqms_code'] or '—'}",
                f"Số lượng: {po['order_qty'] or 0}",
            ]
            if po["amount"] and float(po["amount"]) > 0:
                body_lines.append(f"Giá trị: {po['amount']} {po['currency'] or ''}")
            if po["preferred_delivery_date"]:
                body_lines.append(f"Giao hàng dự kiến: {po['preferred_delivery_date']}")
            body = "\n".join(body_lines)

            for uid in recipients:
                await conn.execute(
                    """
                    INSERT INTO notifications
                      (recipient_id, type, title, body, ref_type, ref_id, metadata)
                    VALUES ($1::uuid, 'po_received', $2, $3, 'bqms_samsung_po', $4,
                      $5::jsonb)
                    """,
                    uid, title, body, po["id"],
                    f'{{"po_number":"{po["po_number"]}","bqms_code":"{po["bqms_code"] or ""}"}}',
                )
                inserted += 1

        logger.info("event_notifications: dispatched %d po_received notifications for %d POs",
                    inserted, len(po_numbers))
        return inserted
    except Exception as exc:
        logger.warning("dispatch_new_po failed: %s", exc)
        return 0


# ---------------------------------------------------------------------------
# Delivery status change event
# ---------------------------------------------------------------------------

# Status transitions that should page someone
_ALERT_STATUSES = {
    "cancelled",
    "pending_too_long",
    "customs_clearance",
    "in_transit",
}

_FAILURE_KEYWORDS = ("error", "fail", "loi", "huy", "cancel")


async def dispatch_delivery_status_change(
    conn: asyncpg.Connection,
    delivery_id: int,
    new_status: str,
    actor_user_id: str | None = None,
) -> int:
    """Notify relevant staff when delivery hits a notable status.

    Emits stock_alert notification type (closest match in the existing enum)
    for delivery problems. Recipients: manager + warehouse + admin.
    """
    try:
        delivery = await conn.fetchrow(
            """
            SELECT d.id, d.po_number, d.bqms_code, d.quantity, d.delivery_status,
                   d.delivery_date, d.actual_delivered_at
            FROM bqms_deliveries d
            WHERE d.id = $1
            """,
            delivery_id,
        )
        if not delivery:
            return 0

        status_lower = (new_status or "").lower()
        is_alert = new_status in _ALERT_STATUSES or any(k in status_lower for k in _FAILURE_KEYWORDS)

        # Skip "normal" transitions to keep the inbox clean
        if not is_alert and new_status not in ("da_giao", "delivered", "completed", "hoan_tat"):
            return 0

        recipients = await _recipients_by_roles(conn, ["admin", "manager", "warehouse"])
        if not recipients:
            return 0

        if is_alert:
            title = f"⚠️ Giao hàng cần xử lý: {delivery['po_number']}"
            notif_type = "stock_alert"
        else:
            title = f"Đã giao hàng: {delivery['po_number']}"
            notif_type = "po_received"  # re-use enum slot for "delivery completed"

        body = (
            f"Mã: {delivery['bqms_code'] or '—'}\n"
            f"Số lượng: {delivery['quantity'] or 0}\n"
            f"Trạng thái mới: {new_status}"
        )

        inserted = 0
        for uid in recipients:
            if actor_user_id and str(uid) == str(actor_user_id):
                # don't notify the person who caused the change
                continue
            await conn.execute(
                """
                INSERT INTO notifications
                  (recipient_id, type, title, body, ref_type, ref_id, metadata)
                VALUES ($1::uuid, $2::notification_type, $3, $4, 'bqms_delivery', $5, $6::jsonb)
                """,
                uid, notif_type, title, body, delivery_id,
                f'{{"new_status":"{new_status}","po_number":"{delivery["po_number"]}"}}',
            )
            inserted += 1

        logger.info("event_notifications: delivery %s → %s (%d notifications)",
                    delivery_id, new_status, inserted)
        return inserted
    except Exception as exc:
        logger.warning("dispatch_delivery_status_change failed: %s", exc)
        return 0


# ---------------------------------------------------------------------------
# Convenience — fire-and-forget helper for sync-context callers
# ---------------------------------------------------------------------------

def dispatch_new_po_sync(po_numbers: list[str]) -> None:
    """Sync wrapper for bqms_sync task (runs under procrastinate sync worker)."""
    if not po_numbers:
        return
    import asyncio
    from app.core.database import db_pool

    async def _run():
        await db_pool.init()  # idempotent
        async with db_pool.acquire() as conn:
            await dispatch_new_po(conn, po_numbers)

    try:
        asyncio.run(_run())
    except Exception as exc:
        logger.warning("dispatch_new_po_sync failed: %s", exc)


# ---------------------------------------------------------------------------
# V1 → V2 / V3 round bump event (per Thang 2026-05-12)
# ---------------------------------------------------------------------------

async def dispatch_rfq_version_bump(
    conn: asyncpg.Connection,
    rfq_id: str,
    rfq_number: str,
    bqms_code: str | None,
    old_version: int,
    new_version: int,
    assigned_to: str | None = None,
    person_in_charge_name: str | None = None,
) -> int:
    """Notify when a Samsung RFQ jumps from V1 → V2 or V2 → V3 (etc.).

    Used by the bidding scraper when re-scraping detects the RFQ name now
    has "/ 2 th" or "/ 3 th" suffix while the local row was still v1/v2.
    Rule (Thang): only the Detail Version field is updated — other fields
    keep their existing values — and the assigned PIC must get pinged.

    Recipients (in priority order):
      1. `assigned_to` user_id if present (column added in Phase 2)
      2. All users matching `person_in_charge_name` by full_name (best effort)
      3. Fallback: all managers + procurement role

    Returns count of notifications inserted.
    """
    if new_version <= old_version:
        return 0

    try:
        recipients: list[str] = []

        # Path 1: explicit assignee
        if assigned_to:
            row = await conn.fetchrow(
                "SELECT id FROM users WHERE id = $1::uuid AND is_active = true",
                assigned_to,
            )
            if row:
                recipients.append(str(row["id"]))

        # Path 2: match by full_name
        if not recipients and person_in_charge_name:
            rows = await conn.fetch(
                """
                SELECT id FROM users
                WHERE LOWER(full_name) = LOWER($1) AND is_active = true
                """,
                person_in_charge_name.strip(),
            )
            recipients.extend(str(r["id"]) for r in rows)

        # Path 3: fallback to manager + procurement team
        if not recipients:
            recipients = await _recipients_by_roles(
                conn, ["admin", "manager", "procurement"]
            )

        if not recipients:
            return 0

        title = f"RFQ {rfq_number} đã lên V{new_version}"
        body_lines = [
            f"Mã: {bqms_code or '—'}",
            f"Vòng cũ: V{old_version} → Vòng mới: V{new_version}",
            "Samsung đã cập nhật lại RFQ này — kiểm tra báo giá lại.",
        ]
        body = "\n".join(body_lines)

        # Use bqms_rfq_new type (no version-bump enum value — closest match)
        meta = (
            f'{{"rfq_number":"{rfq_number}",'
            f'"bqms_code":"{bqms_code or ""}",'
            f'"old_version":{old_version},'
            f'"new_version":{new_version}}}'
        )

        # Populate ref_id with the RFQ id so the notification deep-links to the
        # specific record (frontend uses backend _compute_notification_link →
        # /bqms?focus=<rfq_id>). Coerce to int when possible; otherwise leave NULL.
        ref_id: int | None = None
        if rfq_id is not None:
            try:
                ref_id = int(rfq_id)
            except (TypeError, ValueError):
                ref_id = None

        inserted = 0
        for uid in recipients:
            await conn.execute(
                """
                INSERT INTO notifications
                  (recipient_id, type, title, body, ref_type, ref_id, metadata)
                VALUES ($1::uuid, 'bqms_rfq_new', $2, $3, 'bqms_rfq', $4, $5::jsonb)
                """,
                uid, title, body, ref_id, meta,
            )
            inserted += 1

        logger.info(
            "event_notifications: dispatched %d version-bump notifications for RFQ %s (v%d→v%d)",
            inserted, rfq_number, old_version, new_version,
        )
        return inserted
    except Exception as exc:
        logger.warning("dispatch_rfq_version_bump failed for %s: %s", rfq_number, exc)
        return 0
