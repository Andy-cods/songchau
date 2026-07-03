"""Procurement event notifications — fan-out DB notifications on bidding events.

Đợt 6 (Thang 2026-06-19). Mirrors the pattern of `event_notifications.py`:
recipient resolution by role + best-effort INSERT-per-recipient, the WHOLE body
wrapped in try/except that LOGS and NEVER raises (a notification failure must
never roll back / break the procurement business write that called it).

Single entry point:
    await dispatch_procurement_event(
        conn, entity_type, entity_id, action,
        actor_id=..., awarded_vendor_id=..., detail={...},
    )

Recipients:
  * INTERNAL — every active admin + manager + procurement user, EXCLUDING the
    actor (`actor_id`) who triggered the event. These rows use the existing
    `recipient_id` (users.id, UUID) column; `recipient_vendor_id` IS NULL.
  * VENDOR (NCC-lite) — if `awarded_vendor_id` is given, ONE extra row addressed
    to that vendor via the new `recipient_vendor_id` column (vendor_accounts.id,
    BIGINT, added in procurement_v2_004). `recipient_id` is NOT NULL on the base
    table, so the vendor row also carries `recipient_id = vendor_accounts.user_id`
    (the vendor's own user account) purely to satisfy the FK — the vendor feed
    (`/api/vendor/notifications`) scopes EXCLUSIVELY by `recipient_vendor_id`, so
    this never leaks into any admin inbox.

Notification `type` (a real `notification_type` enum, 5 procurement values added
in procurement_v2_004) is derived from (entity_type, action) — see `_NOTIF_TYPE`.

`ref_type` = entity_type; `ref_id` = the batch id (pulled from `detail['batch_id']`)
so the admin-side `_compute_notification_link` resolves every procurement_* row to
`/vendor-bidding/{batch_id}`.
"""

from __future__ import annotations

import json as _json
import logging
from typing import Any, Iterable

import asyncpg

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# (entity_type, action) → notification_type enum value
# ---------------------------------------------------------------------------
# award / re_award          => procurement_award
# quote submit / decline    => procurement_quote
# contract create / sign    => procurement_contract
# po create / status_change => procurement_po
# delivery create/recv/rej  => procurement_delivery
_NOTIF_TYPE: dict[str, str] = {
    "award:award": "procurement_award",
    "award:re_award": "procurement_award",
    # Đợt 3 maker-checker: đề xuất chốt thầu chờ duyệt + cảnh báo break-glass.
    # TÁI DÙNG procurement_award (đã có deep-link /vendor-bidding/{batch_id}),
    # KHÔNG ALTER TYPE enum (tránh non-transactional + restart 3 service).
    "award:award_proposed": "procurement_award",
    "award:award_breakglass": "procurement_award",
    "invitation:invite": "procurement_quote",
    "quote:submit": "procurement_quote",
    "quote:decline": "procurement_quote",
    "quote:withdraw": "procurement_quote",
    "contract:create": "procurement_contract",
    "contract:sign": "procurement_contract",
    "contract:mark_signed": "procurement_contract",
    # (2026-06-30) admin gửi HĐ cho NCC (draft→sent) → notif vendor-facing để
    # chuông cổng NCC kêu ngay. TÁI DÙNG procurement_contract (deep-link sẵn).
    "contract:send_to_vendor": "procurement_contract",
    "po:create": "procurement_po",
    "po:status_change": "procurement_po",
    "po:cancel": "procurement_po",
    "po:acknowledge": "procurement_po",
    "delivery:create": "procurement_delivery",
    "delivery:received": "procurement_delivery",
    "delivery:rejected": "procurement_delivery",
    # Đợt 1: buyer huỷ cả đợt báo giá → báo NCC đã mời "không cần báo giá nữa".
    "batch:cancel": "procurement_quote",
    # Đợt 2a #12: Q&A + addendum — TÁI DÙNG procurement_quote (đã vendor-facing +
    # deep-link sẵn) để KHỎI ALTER TYPE enum (non-transactional + restart 3 service).
    "rfq_message:question": "procurement_quote",  # NCC hỏi    → internal team
    "rfq_message:answer":   "procurement_quote",  # admin đáp  → 1 NCC đích
    "rfq_message:addendum": "procurement_quote",  # admin phụ lục → broadcast NCC mời
    # Đợt 2b [AM]: admin sửa metadata phiên (title/desc/notes) sau publish →
    # broadcast NCC mời. TÁI DÙNG procurement_quote (vendor-facing + deep-link),
    # KHÔNG ALTER TYPE enum. entity_type='batch' → ref_id=batch_id → deep-link đúng.
    "batch:amend": "procurement_quote",
}

# Internal-team roles that should see procurement events.
_INTERNAL_ROLES = ("admin", "manager", "procurement")


def _resolve_type(entity_type: str, action: str) -> str | None:
    """Map (entity_type, action) → notification_type, else None (skip)."""
    return _NOTIF_TYPE.get(f"{entity_type}:{action}")


async def _internal_recipients(
    conn: asyncpg.Connection, roles: Iterable[str], exclude_id: str | None
) -> list[str]:
    """Active users with any of `roles`, EXCLUDING the actor (exclude_id)."""
    rows = await conn.fetch(
        "SELECT id FROM users "
        "WHERE role = ANY($1::role_enum[]) AND is_active = true AND deleted_at IS NULL",
        list(roles),
    )
    out: list[str] = []
    for r in rows:
        uid = str(r["id"])
        if exclude_id and uid == str(exclude_id):
            continue
        out.append(uid)
    return out


def _build_message(
    entity_type: str, action: str, notif_type: str, detail: dict[str, Any]
) -> tuple[str, str]:
    """Vietnamese (title, message) from detail. Best-effort; never raises."""
    d = detail or {}
    batch_code = d.get("batch_code") or d.get("contract_no") or d.get("po_no") or d.get("delivery_no")
    ref_label = f" {batch_code}" if batch_code else ""
    currency = d.get("currency") or ""
    total = d.get("total_amount")
    amount_str = ""
    if total is not None:
        try:
            amount_str = f" — {float(total):,.0f} {currency}".rstrip()
        except (TypeError, ValueError):
            amount_str = ""

    if notif_type == "procurement_award":
        if action == "award_proposed":
            # Đợt 3: internal team — có đề xuất chốt thầu chờ NGƯỜI THỨ HAI duyệt
            # (cổng tài chính). KHÔNG nêu NCC/giá (vendor-facing=None ở call-site).
            title = f"Đấu thầu: có đề xuất chốt thầu chờ duyệt{ref_label}"
            msg = "Một đề xuất chốt thầu đang chờ người thứ hai duyệt (cổng tài chính). Mở đợt báo giá để duyệt/từ chối."
        elif action == "award_breakglass":
            # Đợt 3: cảnh báo compliance — award tự duyệt qua break-glass, cần hậu kiểm.
            title = f"⚠ Chốt thầu qua break-glass{ref_label}"
            msg = "Một award được TỰ DUYỆT qua break-glass (cùng người đề xuất). Cần hậu kiểm compliance."
        elif action == "re_award":
            title = f"Đấu thầu: chọn lại NCC trúng thầu{ref_label}"
            msg = "Kết quả trúng thầu đã được cập nhật lại (re-award)."
        else:
            title = f"Đấu thầu: đã chọn NCC trúng thầu{ref_label}"
            msg = "Đã công bố nhà cung cấp trúng thầu cho đợt báo giá."
        if d.get("winner_count"):
            msg += f" Số NCC trúng: {d['winner_count']}."

    elif notif_type == "procurement_quote":
        round_no = d.get("round")
        round_label = f" (vòng {round_no})" if round_no else ""
        if action == "invite":
            # Vendor-facing invite (addressed via recipient_vendor_id).
            title = f"Mời báo giá{ref_label}"
            msg = (
                "Bạn được mời tham gia báo giá. Đăng nhập cổng NCC để xem chi "
                "tiết và gửi báo giá."
            )
        elif action == "submit":
            # Internal team: a supplier just submitted a quote.
            title = f"NCC đã gửi báo giá{ref_label}"
            msg = f"Một nhà cung cấp vừa gửi báo giá cho đợt{ref_label or ' báo giá'}{round_label}."
        elif action == "decline":
            # Internal team: a supplier declined the invitation.
            title = f"NCC đã từ chối mời{ref_label}"
            msg = f"Một nhà cung cấp đã từ chối tham gia đợt báo giá{ref_label}{round_label}."
        elif action == "withdraw":
            # Internal team: a supplier withdrew a submitted quote while still in time.
            # No competitor signal — never names the vendor; reason is the buyer's
            # re-source cue. Placed BEFORE `else` so it doesn't fall to the
            # generic "Báo giá mới từ NCC" fallback.
            reason = d.get("reason")
            title = f"NCC đã thu hồi báo giá{ref_label}"
            msg = f"Một nhà cung cấp đã thu hồi báo giá cho đợt{ref_label or ' báo giá'}{round_label}."
            if reason:
                msg += f" Lý do: {reason}"
        elif action == "cancel":
            # Đợt 1: gửi cho NCC đã mời — buyer huỷ cả đợt. `reason` do buyer gõ
            # tay → KHÔNG chứa target_price/đối thủ (buyer tự kiểm). Đặt TRƯỚC
            # `else` để không rơi vào fallback "Báo giá mới từ NCC".
            reason = d.get("reason")
            title = f"Đợt báo giá đã huỷ{ref_label}"
            msg = "Song Châu đã huỷ đợt báo giá này. Bạn không cần gửi báo giá nữa."
            if reason:
                msg += f" Lý do: {reason}"
        elif action == "question":
            # Đợt 2a: internal team — một NCC vừa đặt câu hỏi làm rõ. KHÔNG nêu
            # tên NCC, KHÔNG nhét body câu hỏi (tránh rò nội dung sang chuông team).
            title = f"NCC có câu hỏi làm rõ{ref_label}"
            msg = "Một nhà cung cấp vừa đặt câu hỏi làm rõ. Mở đợt báo giá để trả lời riêng."
        elif action == "answer":
            # Đợt 2a: vendor-facing — bên mua đã trả lời câu hỏi của CHÍNH NCC này.
            # KHÔNG nhét body đáp vào nhãn notif.
            title = f"Có trả lời cho câu hỏi của bạn{ref_label}"
            msg = "Bên mua đã trả lời câu hỏi của bạn. Đăng nhập cổng NCC để xem."
        elif action == "addendum":
            # Đợt 2a: vendor-facing broadcast — phụ lục/làm rõ chung cho mọi NCC mời.
            title = f"Phụ lục đợt báo giá{ref_label}"
            msg = "Song Châu vừa đăng phụ lục làm rõ/sửa đổi cho đợt báo giá. Vui lòng xem trước khi gửi báo giá."
        elif action == "amend":
            # Đợt 2b: vendor-facing broadcast — bên mua cập nhật THÔNG TIN phiên
            # (tiêu đề/mô tả/ghi chú). TUYỆT ĐỐI không nhét old/new (tránh rò).
            title = f"Cập nhật thông tin đợt báo giá{ref_label}"
            msg = "Song Châu vừa cập nhật thông tin phiên đấu thầu. Vui lòng xem lại trước khi gửi báo giá."
        else:
            title = f"Báo giá mới từ NCC{ref_label}"
            msg = "Một nhà cung cấp vừa gửi báo giá."

    elif notif_type == "procurement_contract":
        if action in ("sign", "mark_signed"):
            title = f"Hợp đồng đã ký{ref_label}"
            msg = "Hợp đồng đã được ký xác nhận."
        elif action == "send_to_vendor":
            # Vendor-facing: Song Châu vừa gửi hợp đồng cho NCC này. NCC truy cập
            # qua ĐĂNG NHẬP cổng (login-scoped) — không phụ thuộc email.
            title = f"Hợp đồng mới cần ký{ref_label}"
            msg = "Song Châu đã gửi hợp đồng cho bạn. Đăng nhập cổng NCC để xem và ký xác nhận."
        else:
            title = f"Đã tạo hợp đồng{ref_label}"
            msg = "Một hợp đồng mới được tạo từ kết quả đấu thầu."
        if amount_str:
            msg += amount_str

    elif notif_type == "procurement_po":
        if action == "acknowledge":
            # Chiều ngược: NCC xác nhận đã nhận đơn → báo internal team.
            title = f"NCC đã xác nhận đơn hàng (PO){ref_label}"
            ack_note = d.get("ack_note")
            msg = "Nhà cung cấp đã xác nhận nhận đơn đặt hàng."
            if ack_note:
                msg += f" Ghi chú: {ack_note}"
        elif action == "cancel":
            title = f"Đã huỷ đơn hàng (PO){ref_label}"
            reason = d.get("reason")
            msg = f"PO đã bị huỷ. Lý do: {reason}" if reason else "PO đã bị huỷ."
        else:
            title = f"Đã tạo đơn hàng (PO){ref_label}"
            msg = "Một đơn đặt hàng mới được tạo."
            if amount_str:
                msg += amount_str

    elif notif_type == "procurement_delivery":
        if action == "received":
            title = f"Giao hàng: đã nhận hàng{ref_label}"
            msg = "Một lô giao hàng đã được xác nhận nhận hàng."
        elif action == "rejected":
            title = f"Giao hàng: bị từ chối{ref_label}"
            reason = d.get("rejection_reason")
            msg = f"Một lô giao hàng bị từ chối. Lý do: {reason}" if reason else "Một lô giao hàng bị từ chối."
        else:
            title = f"Giao hàng mới{ref_label}"
            msg = "Một lô giao hàng mới được tạo."

    else:  # pragma: no cover — defensive default
        title = f"Cập nhật đấu thầu{ref_label}"
        msg = "Có cập nhật mới trong quy trình đấu thầu NCC."

    return title, msg


async def dispatch_procurement_event(
    conn: asyncpg.Connection,
    entity_type: str,
    entity_id: int,
    action: str,
    *,
    actor_id: str | None = None,
    awarded_vendor_id: int | None = None,
    detail: dict[str, Any] | None = None,
    internal: bool = True,
) -> int:
    """Fan out notifications for ONE procurement business event.

    BEST-EFFORT: the entire body is wrapped in try/except that LOGS and NEVER
    raises — a notification failure must never break the calling business write
    (the caller invokes this AFTER its _audit, inside the same transaction).

    `internal=False` SKIPS the internal-team fan-out and only writes the vendor
    row (when `awarded_vendor_id` is given). Dùng khi caller LẶP nhiều NCC cho
    CÙNG 1 sự kiện (vd huỷ đợt → mỗi NCC mời 1 row): gọi lần đầu internal=True
    để team nhận đúng 1 bản, các lần sau internal=False để KHÔNG nhân bản nội bộ.
    Mặc định True → backward-compat, mọi call-site cũ không đổi.

    Returns the number of notification rows inserted (0 on any skip/error).
    """
    try:
        notif_type = _resolve_type(entity_type, action)
        if not notif_type:
            # Not a meaningful/mapped transition — skip quietly.
            return 0

        detail = detail or {}
        # ref_id = batch id so _compute_notification_link → /vendor-bidding/{batch_id}.
        ref_id = detail.get("batch_id")
        title, message = _build_message(entity_type, action, notif_type, detail)
        # default=str: detail có thể chứa Decimal (NUMERIC total_amount) / date —
        # nếu không có sẽ raise TypeError, bị nuốt bởi try ngoài → notif rớt âm
        # thầm. Stringify an toàn (metadata chỉ để hiển thị; _build_message đã
        # float() lại số tiền).
        metadata = _json.dumps(detail, default=str)

        inserted = 0

        # SAVEPOINT: isolate ALL notification DB work in a nested transaction
        # (asyncpg: conn.transaction() while already in a txn == SAVEPOINT). If any
        # INSERT/SELECT here raises a DB error, only the notification work rolls
        # back — the caller's OUTER award/contract/po/delivery transaction stays
        # usable. Together with the outer try/except this makes dispatch truly
        # non-breaking to the business write.
        async with conn.transaction():
            # ---- INTERNAL fan-out (admin + manager + procurement, minus actor) ----
            recipients = (
                await _internal_recipients(conn, _INTERNAL_ROLES, actor_id)
                if internal else []
            )
            for uid in recipients:
                await conn.execute(
                    """
                    INSERT INTO notifications
                        (recipient_id, type, title, body, ref_type, ref_id, metadata)
                    VALUES ($1::uuid, $2::notification_type, $3, $4, $5, $6, $7::jsonb)
                    """,
                    uid, notif_type, title, message, entity_type, ref_id, metadata,
                )
                inserted += 1

            # ---- VENDOR (NCC-lite) row, addressed via recipient_vendor_id ----
            if awarded_vendor_id is not None:
                # recipient_id is NOT NULL on the base table → use the vendor's own
                # user account as the FK placeholder; the vendor feed scopes by
                # recipient_vendor_id only, so this never reaches an admin inbox.
                vendor_user_id = await conn.fetchval(
                    "SELECT user_id FROM vendor_accounts WHERE id = $1",
                    int(awarded_vendor_id),
                )
                if vendor_user_id is not None:
                    await conn.execute(
                        """
                        INSERT INTO notifications
                            (recipient_id, recipient_vendor_id, type, title, body,
                             ref_type, ref_id, metadata)
                        VALUES ($1::uuid, $2, $3::notification_type, $4, $5,
                                $6, $7, $8::jsonb)
                        """,
                        str(vendor_user_id), int(awarded_vendor_id), notif_type,
                        title, message, entity_type, ref_id, metadata,
                    )
                    inserted += 1
                else:
                    logger.warning(
                        "dispatch_procurement_event: awarded_vendor_id=%s has no "
                        "vendor_accounts row — skipped vendor notification",
                        awarded_vendor_id,
                    )

        logger.info(
            "procurement_notifications: %s/%s (entity_id=%s) → %s, %d rows",
            entity_type, action, entity_id, notif_type, inserted,
        )
        return inserted
    except Exception as exc:  # noqa: BLE001 — best-effort, never raise
        logger.warning(
            "dispatch_procurement_event failed (%s/%s id=%s): %s",
            entity_type, action, entity_id, exc,
        )
        return 0
