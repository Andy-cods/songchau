"""Vendor Portal — Submit and manage quotes (login-scoped, invitation-gated).

Đợt 1: a vendor may only quote a batch they were INVITED to. Scoping goes through
`resolve_vendor` (active account -> vendor_accounts.id); the inline vendor lookup is
gone. Every write path first checks for a procurement_rfq_invitations row for
(batch_id, $me) — a vendor can never quote / attach to an uninvited batch. Currency
now allows VND in addition to USD/RMB; quotes are written round-aware
(vendor_quotes UNIQUE(batch_id, vendor_id, round_number)).

Đợt 2 (reverse-auction multi-round): the vendor quotes the batch's CURRENT round,
read from procurement_rfq_batches.current_round. The vendor must hold an invitation
for THAT round (carried forward by the admin /open-round endpoint) — being invited
to an earlier round is no longer enough. Each round produces a fresh vendor_quotes
row (the prior-round row stays as history); GET .../prefill returns the previous
round's lines so the FE can seed the revise form. Quote submit also writes the
procurement_audit_log via the shared _audit helper (imported from procurement.py;
DRY single source) inside the existing transaction.
"""

from __future__ import annotations

import json as _json
import logging
import os
import re
from datetime import datetime
from pathlib import Path
from typing import Any

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form

from app.api.vendor.deps import resolve_vendor
from app.core.database import get_db
from app.core.config import settings
from app.core.rate_limit import upload_rate_limit
from app.services.procurement_notifications import dispatch_procurement_event

logger = logging.getLogger(__name__)
router = APIRouter()

ALLOWED_CURRENCIES = ("VND", "JPY", "USD", "KRW", "RMB", "EUR")


def _parse_valid_until(raw: Any) -> datetime | None:
    """Parse an optional quote-level `valid_until` (ISO date/datetime) → datetime | None.

    Defensive: accepts an ISO date ('2026-07-01') or ISO datetime, tolerates a
    trailing 'Z' (UTC), and returns None for anything absent/blank/unparseable so
    a bad value never blocks a quote submit (the column stays NULL).
    """
    if raw in (None, ""):
        return None
    if isinstance(raw, datetime):
        return raw
    try:
        s = str(raw).strip()
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        return datetime.fromisoformat(s)
    except (ValueError, TypeError):
        logger.warning("Ignoring unparseable valid_until: %r", raw)
        return None


def _normalize_external_url(raw: Any) -> str | None:
    """Validate an optional quote-level external link → str | None.

    Keeps only http(s) URLs (≤500 chars). Absent/blank/other-scheme → None so a
    bad value never blocks a submit (and javascript:/data:/file: never reach the
    admin UI). The link is stored verbatim, rendered with rel="noopener
    noreferrer", and NEVER fetched server-side (no SSRF). A DB CHECK constraint
    (procurement_v2_022) is the second line of defense.
    """
    if raw in (None, ""):
        return None
    s = str(raw).strip()
    if not s:
        return None
    if len(s) > 500:
        s = s[:500]
    if not re.match(r"^https?://", s, re.IGNORECASE):
        logger.warning("Ignoring non-http(s) external_url: %r", s[:80])
        return None
    return s


def _vendor_sandbox_dir(vendor_id: int) -> Path:
    """The vendor's own upload sandbox: FILES_BASE_PATH/vendor_uploads/{vendor_id}.

    SINGLE source of the sandbox root — used by both the upload destination
    (upload_quote_file) and the submit-time attachment_paths validation
    (_sanitize_attachment_paths) so they can never drift apart.
    """
    return (Path(settings.FILES_BASE_PATH) / "vendor_uploads" / str(vendor_id)).resolve()


def _sanitize_attachment_paths(raw: Any, vendor_id: int) -> list[str]:
    """Keep only client-supplied attachment paths that resolve INSIDE the vendor sandbox.

    Security: per-line `attachment_paths` arrive from the client and are stored
    verbatim into vendor_quote_items.attachment_paths (JSONB). Without this guard a
    vendor could persist an arbitrary server path (e.g. another vendor's uploads,
    or /etc/...). Each entry is resolved (absolute or relative to the sandbox) and
    rejected unless it sits under FILES_BASE_PATH/vendor_uploads/{vendor_id}. So
    ONLY server-issued upload paths (returned by /upload-file) survive.
    """
    if raw is None or raw == "":
        return []
    items = raw if isinstance(raw, list) else [raw]
    sandbox = _vendor_sandbox_dir(vendor_id)
    clean: list[str] = []
    for entry in items:
        if not entry:
            continue
        s = str(entry)
        candidate = Path(s) if os.path.isabs(s) else (sandbox / s)
        try:
            resolved = candidate.resolve()
            resolved.relative_to(sandbox)
        except (ValueError, OSError):
            logger.warning(
                "Rejected attachment path outside vendor %s sandbox: %r", vendor_id, s
            )
            continue
        clean.append(str(resolved))
    return clean


# ── Audit helper (DRY single source lives in procurement.py) ──────────────────
# Backend agent lands the canonical `_audit` in procurement.py; we import it so
# vendor-side writes share the exact same insert + signature. A thin local
# fallback keeps this module importable/runnable before the helper has landed.
try:  # pragma: no cover - import wiring
    from app.api.v1.procurement import _audit  # type: ignore
except Exception:  # pragma: no cover - fallback until backend agent lands helper

    async def _audit(  # type: ignore[no-redef]
        conn: asyncpg.Connection,
        entity_type: str,
        entity_id: int,
        action: str,
        *,
        actor_id=None,
        actor_vendor_id=None,
        detail=None,
        from_status=None,
        to_status=None,
        ip=None,
    ) -> None:
        """Append a procurement_audit_log row inside the caller's transaction.

        Mirror of procurement._audit; used only until the canonical helper lands.
        Best-effort: if the audit table does not yet exist (migration not run),
        swallow the error so the business write is never blocked.
        """
        try:
            await conn.execute(
                """INSERT INTO procurement_audit_log
                     (entity_type, entity_id, action, from_status, to_status,
                      actor_id, actor_vendor_id, detail, ip)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::inet)""",
                entity_type, int(entity_id), action, from_status, to_status,
                actor_id, actor_vendor_id, _json.dumps(detail or {}), ip,
            )
        except asyncpg.UndefinedTableError:
            logger.warning("procurement_audit_log missing; skipped audit %s/%s", entity_type, action)


async def _latest_invitation(
    conn: asyncpg.Connection, batch_id: int, vendor_id: int
) -> asyncpg.Record | None:
    """Return the latest (highest-round) invitation row for (batch, vendor) or None."""
    return await conn.fetchrow(
        """
        SELECT id, round_number, status
          FROM procurement_rfq_invitations
         WHERE batch_id = $1 AND vendor_id = $2
         ORDER BY round_number DESC NULLS LAST, invited_at DESC NULLS LAST
         LIMIT 1
        """,
        batch_id, vendor_id,
    )


async def _invitation_for_round(
    conn: asyncpg.Connection, batch_id: int, vendor_id: int, round_number: int
) -> asyncpg.Record | None:
    """Return the (batch, vendor, round) invitation row or None.

    Multi-round gate: a vendor may only quote the batch's CURRENT round, and only
    if the admin carried their invitation forward into that exact round. The
    Đợt-1 unique index uq_prfq_inv_batch_vendor_round guarantees at most one row.
    """
    return await conn.fetchrow(
        """
        SELECT id, round_number, status
          FROM procurement_rfq_invitations
         WHERE batch_id = $1 AND vendor_id = $2 AND round_number = $3
         LIMIT 1
        """,
        batch_id, vendor_id, round_number,
    )


async def _persist_quote(
    conn: asyncpg.Connection,
    vendor_id: int,
    body: dict[str, Any],
    *,
    status: str,
):
    """Lưu báo giá cho một đợt ĐÃ ĐƯỢC MỜI — dùng chung cho 2 chế độ:

      · status='submitted'  → GỬI báo giá (Đợt 1 BQMS "đẩy"): bắt buộc Ý kiến
        (notes) + Hạn hiệu lực (valid_until); flip invitation='submitted',
        cập nhật quote_count, bắn thông báo nội bộ.
      · status='draft'      → LƯU NHÁP (Save Temporarily): KHÔNG flip invitation,
        KHÔNG đụng quote_count, KHÔNG thông báo nội bộ, KHÔNG bắt buộc Ý kiến/Hạn.
        Nháp TUYỆT ĐỐI vô hình với bên mua — mọi query so sánh/xếp hạng đã lọc
        status='submitted' (matrix/rank/decision-sheet) nên nháp không bao giờ lọt.

    BẢO MẬT GIỮ NGUYÊN ở cả 2 chế độ: validate item_id ∈ batch (chặn cross-batch),
    _sanitize_attachment_paths (chỉ giữ path trong sandbox NCC). 'Nháp nới lỏng về
    độ đầy đủ' KHÔNG có nghĩa 'nháp bỏ qua kiểm bảo mật'.
    """
    is_submit = status == "submitted"

    batch_id = body.get("batch_id")
    if not batch_id:
        raise HTTPException(400, "batch_id là bắt buộc")

    # Verify batch exists + is published, and read its CURRENT round.
    # `past_deadline` is computed in SQL (timezone-safe) so a vendor cannot sneak a
    # quote in the ≤5-minute window between bid_deadline and the scheduler auto-close
    # tick — that would be a bidding-fairness hole.
    batch = await conn.fetchrow(
        """
        SELECT id, status, current_round, batch_code,
               (bid_deadline IS NOT NULL AND bid_deadline < NOW()) AS past_deadline
        FROM procurement_rfq_batches WHERE id = $1
        """,
        batch_id,
    )
    if not batch:
        raise HTTPException(404, "Đợt báo giá không tồn tại")
    if batch["status"] != "published":
        raise HTTPException(400, "Đợt báo giá đã đóng hoặc chưa công bố")
    if batch["past_deadline"]:
        raise HTTPException(400, "Đã quá hạn báo giá cho đợt này")

    round_number = batch["current_round"] or 1

    # Gate on invitation for the CURRENT round — a vendor may only quote the round
    # the batch is on, and only if the admin carried their invitation into it.
    inv = await _invitation_for_round(conn, batch_id, vendor_id, round_number)
    if not inv:
        raise HTTPException(
            404, f"Không tìm thấy lời mời báo giá cho vòng {round_number} của đợt này"
        )

    currency = body.get("currency", "USD")
    if currency not in ALLOWED_CURRENCIES:
        raise HTTPException(
            400, "Tiền tệ phải là một trong: VND, JPY, USD, KRW, RMB, EUR"
        )

    # Quote-level "hiệu lực báo giá đến" — parsed defensively (NULL if absent).
    valid_until = _parse_valid_until(body.get("valid_until"))
    # Quote-level "Link tham khảo" (URL) — only http(s) survives (NULL else).
    external_url = _normalize_external_url(body.get("external_url"))
    opinion = (body.get("notes") or "").strip()  # Ý kiến (Submission Opinion)

    items = body.get("items", [])
    # Nháp được phép rỗng/dở dang; GỬI thì bắt buộc có ít nhất 1 dòng.
    if is_submit and not items:
        raise HTTPException(400, "Cần ít nhất 1 item trong báo giá")

    # GỬI báo giá: bắt buộc Ý kiến + Hạn hiệu lực (giống BQMS bắt Quote Valid
    # Date). LƯU NHÁP không bắt buộc 2 trường này.
    if is_submit:
        if not opinion:
            raise HTTPException(400, "Vui lòng nhập Ý kiến trước khi gửi báo giá")
        if valid_until is None:
            raise HTTPException(400, "Vui lòng chọn Hạn hiệu lực báo giá trước khi gửi")

    # Validate every item_id belongs to this batch (prevents cross-batch injection).
    # Also capture the RFQ item quantity → used as the default offered_qty when the
    # vendor does not override it (P5 commercial per-line fields).
    rfq_item_qty: dict[int, Any] = {
        r["id"]: r["quantity"]
        for r in await conn.fetch(
            "SELECT id, quantity FROM procurement_rfq_items WHERE batch_id = $1",
            batch_id,
        )
    }
    valid_item_ids = set(rfq_item_qty)
    for item in items:
        if item.get("item_id") not in valid_item_ids:
            raise HTTPException(400, f"item_id {item.get('item_id')} không thuộc đợt báo giá này")

    # Upsert the quote for this round (one per batch+vendor+round).
    existing = await conn.fetchrow(
        """
        SELECT id FROM vendor_quotes
         WHERE batch_id = $1 AND vendor_id = $2 AND round_number = $3
        """,
        batch_id, vendor_id, round_number,
    )

    async with conn.transaction():
        if existing:
            quote_id = existing["id"]
            await conn.execute(
                """UPDATE vendor_quotes SET currency = $1, lead_time_days = $2,
                   moq_notes = $3, notes = $4, valid_until = $5, external_url = $6,
                   status = $7,
                   submitted_at = CASE WHEN $7 = 'submitted' THEN NOW() ELSE submitted_at END,
                   updated_at = NOW()
                WHERE id = $8""",
                currency, body.get("lead_time_days"),
                body.get("moq_notes"), body.get("notes"), valid_until, external_url,
                status, quote_id,
            )
            await conn.execute("DELETE FROM vendor_quote_items WHERE quote_id = $1", quote_id)
        else:
            quote_id = await conn.fetchval(
                """INSERT INTO vendor_quotes (batch_id, vendor_id, round_number, currency,
                   lead_time_days, moq_notes, notes, valid_until, external_url, status, submitted_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                        CASE WHEN $10 = 'submitted' THEN NOW() ELSE NULL END)
                RETURNING id""",
                batch_id, vendor_id, round_number, currency,
                body.get("lead_time_days"), body.get("moq_notes"), body.get("notes"),
                valid_until, external_url, status,
            )

        # Insert quote items + recompute total.
        total = 0.0
        for item in items:
            item_id = item.get("item_id")
            unit_price = item.get("unit_price", 0)
            qty = item.get("quantity")
            if not item_id or unit_price is None:
                continue

            # P5 per-line commercial fields:
            #  · can_do  — vendor unchecked "Báo được" (không báo giá mã này) -> False.
            #  · offered_qty — số lượng NCC có thể cung cấp; default = RFQ item qty.
            #  · moq     — minimum order quantity / điều kiện đặt tối thiểu (free text).
            #  · attachment_paths — per-line file(s) (reuse upload-file → list of paths),
            #    stored in the existing JSONB column (default '[]').
            can_do = item.get("can_do")
            can_do = True if can_do is None else bool(can_do)

            #  · free_charge — NCC cam kết cung cấp dòng này MIỄN PHÍ (FOC). Chỉ có
            #    nghĩa khi can_do=True; khi bật thì ép unit_price=0. Dòng FOC sẽ KHÔNG
            #    bị tính là "giá thấp nhất" ở matrix/decision-sheet (server là nguồn
            #    sự thật — không tin client gửi giá 0 mà quên cờ này).
            free_charge = bool(item.get("free_charge")) and can_do
            if free_charge:
                unit_price = 0
            # can_do=False (không cung cấp được) → ép giá 0 để DB nhất quán: dòng
            # "không làm" KHÔNG bao giờ mang giá, tránh lọt vào mọi query so sánh.
            if not can_do:
                unit_price = 0

            offered_qty = item.get("offered_qty")
            if offered_qty in (None, ""):
                offered_qty = qty if qty not in (None, "") else rfq_item_qty.get(item_id)

            # SECURITY: only keep paths that resolve inside the vendor's own
            # upload sandbox — never store a client-supplied arbitrary server path.
            attachment_paths = _sanitize_attachment_paths(
                item.get("attachment_paths"), vendor_id
            )

            # Per-line currency: a vendor may quote different lines in different
            # currencies. Validate against the same allow-list; fall back to the
            # quote-level currency when absent (existing single-currency behavior).
            line_currency = item.get("currency") or currency
            if line_currency not in ALLOWED_CURRENCIES:
                raise HTTPException(
                    400, "Tiền tệ phải là một trong: VND, JPY, USD, KRW, RMB, EUR"
                )

            await conn.execute(
                """INSERT INTO vendor_quote_items
                       (quote_id, item_id, unit_price, quantity, offered_qty,
                        moq, lead_time_days, notes, can_do, attachment_paths,
                        currency, free_charge)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12)""",
                quote_id, item_id, unit_price, qty, offered_qty,
                item.get("moq"), item.get("lead_time_days"), item.get("notes"),
                can_do, _json.dumps(attachment_paths), line_currency, free_charge,
            )
            # Only priced, deliverable lines contribute to the total. Money math
            # uses offered_qty ('SL báo') — already resolved above with fallback
            # offered_qty ?? quantity ?? RFQ item qty — so it matches the admin
            # full-quote drawer's line_total basis (procurement.vendor_full_quote).
            # Chỉ dòng báo được, KHÔNG FOC, có giá > 0 mới cộng vào tổng tiền.
            # (FOC + "không làm" đã bị ép unit_price=0 ở trên — guard này là tường
            # minh ý đồ, không phụ thuộc thứ tự ép giá.)
            if (
                can_do and not free_charge
                and offered_qty not in (None, "")
                and unit_price and float(unit_price) > 0
            ):
                total += float(unit_price) * float(offered_qty)

        await conn.execute(
            "UPDATE vendor_quotes SET total_amount = $1 WHERE id = $2", total, quote_id
        )

        # Audit cả 2 chế độ (append-only, cùng txn). Nháp ghi to_status='draft'.
        await _audit(
            conn, "quote", quote_id,
            "quote_submit" if is_submit else "quote_draft",
            actor_vendor_id=vendor_id, to_status=status,
            detail={
                "round": round_number,
                "total": total,
                "item_count": len(items),
                "currency": currency,
            },
        )

        # ── CÁC SIDE-EFFECT CHỈ KHI GỬI THẬT (không chạy khi lưu nháp) ──
        # Nháp KHÔNG: cập nhật quote_count, KHÔNG flip invitation→submitted,
        # KHÔNG bắn thông báo nội bộ → bên mua hoàn toàn không thấy nháp.
        if is_submit:
            # Update batch quote count (distinct submitting vendors).
            await conn.execute(
                """UPDATE procurement_rfq_batches SET quote_count = (
                    SELECT COUNT(DISTINCT vendor_id) FROM vendor_quotes
                     WHERE batch_id = $1 AND status = 'submitted'
                ) WHERE id = $1""",
                batch_id,
            )

            # Mark the invitation submitted.
            prev_inv_status = inv["status"]
            await conn.execute(
                """UPDATE procurement_rfq_invitations
                      SET status = 'submitted', quoted_at = NOW()
                    WHERE id = $1""",
                inv["id"],
            )
            await _audit(
                conn, "invitation", inv["id"], "status_change",
                actor_vendor_id=vendor_id,
                from_status=prev_inv_status, to_status="submitted",
                detail={"round": round_number},
            )

            # In-portal notification to the internal team (team-only). Best-effort,
            # same txn. KHÔNG bắn khi lưu nháp → tránh spam đội mua.
            await dispatch_procurement_event(
                conn, "quote", quote_id, "submit",
                actor_id=None,
                detail={
                    "batch_id": batch_id,
                    "batch_code": batch["batch_code"],
                    "round": round_number,
                },
            )

    logger.info(
        "Vendor %d %s quote for batch %d round %d (%d items)",
        vendor_id, "submitted" if is_submit else "saved DRAFT",
        batch_id, round_number, len(items),
    )

    return {
        "message": "Báo giá đã được gửi thành công!" if is_submit else "Đã lưu nháp báo giá.",
        "quote_id": quote_id,
        "total_amount": total,
        "status": status,
    }


@router.post("/submit")
async def submit_quote(
    body: dict[str, Any],
    vendor_id: int = Depends(resolve_vendor),
    conn: asyncpg.Connection = Depends(get_db),
):
    """GỬI báo giá (Đợt 1 BQMS "đẩy"). Xem `_persist_quote` cho ràng buộc đầy đủ."""
    return await _persist_quote(conn, vendor_id, body, status="submitted")


@router.post("/draft")
async def save_quote_draft(
    body: dict[str, Any],
    vendor_id: int = Depends(resolve_vendor),
    conn: asyncpg.Connection = Depends(get_db),
):
    """LƯU NHÁP báo giá (Save Temporarily). Vô hình với bên mua tới khi GỬI.

    KHÔNG bắt buộc Ý kiến/Hạn hiệu lực, cho phép dòng dở dang; nhưng VẪN validate
    item_id ∈ batch + sandbox attachment như khi gửi (nới lỏng độ đầy đủ ≠ bỏ
    kiểm bảo mật). Không flip invitation, không đếm quote_count, không thông báo.
    """
    return await _persist_quote(conn, vendor_id, body, status="draft")


@router.patch("/{quote_id}/withdraw")
async def withdraw_quote(
    quote_id: int,
    body: dict[str, Any] | None = None,
    vendor_id: int = Depends(resolve_vendor),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Đợt-11 #16-P2 — NCC THU HỒI báo giá đã gửi khi đợt CÒN HẠN.

    Khác 'Sửa báo giá' (vẫn dự thầu): thu hồi = RÚT KHỎI cuộc → quote rớt khỏi mọi
    ma trận so sánh (mọi query lọc status='submitted' nên 'withdrawn' tự loại — KHÔNG
    sửa query nào). Sau khi thu hồi, NCC CÓ THỂ báo giá lại cùng vòng: submit UPSERT
    theo UNIQUE(batch,vendor,round) đưa hàng withdrawn về 'submitted' tại chỗ.

    Body: {"reason": str}  — LÝ DO BẮT BUỘC (400 nếu rỗng; buyer cần tín hiệu re-source).

    Bảo mật:
      * scope WHERE q.vendor_id = $me → 404 (không lộ tồn tại quote của NCC khác).
      * KHÔNG lộ giá / xếp hạng / đối thủ; notif nội bộ (actor_id=None).

    Guards (server-side, tôn trọng GAP-X1):
      * 404 nếu không có quote của chính NCC.
      * 400 nếu quote không ở trạng thái 'submitted' (chỉ rút báo giá đang dự thầu).
      * 400 nếu đợt không 'published' (đã đóng / chưa công bố).
      * 400 nếu quá hạn (bid_deadline < NOW() — server-side, tránh khe 5 phút).
      * 400 nếu quote KHÔNG thuộc vòng đang mở (round_number != current_round) —
        không cho rút quote vòng cũ (đã là lịch sử).
    """
    reason = ((body or {}).get("reason") or "").strip()
    if not reason:
        raise HTTPException(400, "Vui lòng nhập lý do thu hồi báo giá")

    # Scope strictly by vendor_id — a vendor can only ever see / act on their OWN
    # quote. A missing row (or a quote belonging to another vendor) → 404, never
    # leaking that the quote exists.
    row = await conn.fetchrow(
        """
        SELECT q.id, q.status, q.round_number, q.vendor_id,
               b.id AS batch_id, b.batch_code, b.status AS batch_status,
               b.current_round,
               (b.bid_deadline IS NOT NULL AND b.bid_deadline < NOW()) AS past_deadline
          FROM vendor_quotes q
          JOIN procurement_rfq_batches b ON b.id = q.batch_id
         WHERE q.id = $1 AND q.vendor_id = $2
        """,
        quote_id, vendor_id,
    )
    if not row:
        raise HTTPException(404, "Không tìm thấy báo giá")
    if row["status"] != "submitted":
        raise HTTPException(400, "Chỉ có thể thu hồi báo giá đang dự thầu")
    if row["batch_status"] != "published":
        raise HTTPException(400, "Đợt báo giá đã đóng — không thể thu hồi")
    if row["past_deadline"]:
        raise HTTPException(400, "Đã quá hạn — không thể thu hồi báo giá")
    if row["round_number"] != (row["current_round"] or 1):
        raise HTTPException(400, "Chỉ có thể thu hồi báo giá của vòng đang mở")

    round_number = row["round_number"]
    batch_id = row["batch_id"]

    async with conn.transaction():
        # 1) Flip the quote out of the running. Every comparison query filters
        #    status='submitted', so this single write removes it from the matrix,
        #    decision sheet and award candidate set — no other query changes.
        await conn.execute(
            """UPDATE vendor_quotes
                  SET status = 'withdrawn', withdrawn_at = NOW(),
                      withdraw_reason = $2, updated_at = NOW()
                WHERE id = $1""",
            quote_id, reason,
        )

        # 2) Recompute the batch quote count (distinct submitting vendors) — mirror
        #    of submit_quote so the admin batch list stays accurate after a rut.
        await conn.execute(
            """UPDATE procurement_rfq_batches SET quote_count = (
                SELECT COUNT(DISTINCT vendor_id) FROM vendor_quotes
                 WHERE batch_id = $1 AND status = 'submitted'
            ) WHERE id = $1""",
            batch_id,
        )

        # 3) Revert this round's invitation submitted → viewed so the vendor is no
        #    longer shown as "đã báo giá" and (E2) is free to re-quote the round.
        #    'viewed' does NOT block re-submit (submit gates only on existence of an
        #    invitation for the current round). Keep quoted_at as history.
        reverted_inv_id = await conn.fetchval(
            """UPDATE procurement_rfq_invitations
                  SET status = 'viewed'
                WHERE batch_id = $1 AND vendor_id = $2 AND round_number = $3
                  AND status = 'submitted'
            RETURNING id""",
            batch_id, vendor_id, round_number,
        )

        # 4) Audit (append-only, atomic with the writes above — same txn).
        await _audit(
            conn, "quote", quote_id, "quote_withdraw",
            actor_vendor_id=vendor_id,
            from_status="submitted", to_status="withdrawn",
            detail={"round": round_number, "reason": reason},
        )
        if reverted_inv_id is not None:
            await _audit(
                conn, "invitation", reverted_inv_id, "status_change",
                actor_vendor_id=vendor_id,
                from_status="submitted", to_status="viewed",
                detail={"round": round_number, "via": "withdraw"},
            )

        # 5) In-portal notification to the internal team (no awarded_vendor_id —
        #    team-only, never names the NCC). Reverse-direction event. Best-effort.
        await dispatch_procurement_event(
            conn, "quote", quote_id, "withdraw",
            actor_id=None,
            detail={
                "batch_id": batch_id,
                "batch_code": row["batch_code"],
                "round": round_number,
                "reason": reason,
            },
        )

    logger.info(
        "Vendor %d withdrew quote %d (batch %d round %d)",
        vendor_id, quote_id, batch_id, round_number,
    )
    return {"message": "Đã thu hồi báo giá. Bạn có thể báo giá lại trước hạn."}


@router.get("/batches/{batch_id}/prefill")
async def round_prefill(
    batch_id: int,
    vendor_id: int = Depends(resolve_vendor),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Trả về báo giá VÒNG TRƯỚC của NCC để FE điền sẵn form revise (reverse-auction).

    Resolve the vendor's latest invitation round R for this batch (scoped to $me),
    then return the line items of their round (R-1) quote so the revise form starts
    from their previous prices. Empty `items` when R = 1 (no prior round) or when no
    prior-round quote exists. 404 only if the vendor was never invited to the batch.

    Response: {"data": {"round": R, "prev_round": R-1, "items": [
        {item_id, unit_price, quantity, offered_qty, moq, lead_time_days,
         notes, can_do, currency, attachment_paths}, ...]}}
    """
    inv = await _latest_invitation(conn, batch_id, vendor_id)
    if not inv:
        raise HTTPException(404, "Không tìm thấy lời mời báo giá cho đợt này")

    round_number = inv["round_number"] or 1
    prev_round = round_number - 1

    items: list[dict[str, Any]] = []
    if prev_round >= 1:
        rows = await conn.fetch(
            """
            SELECT vqi.item_id, vqi.unit_price, vqi.quantity, vqi.offered_qty,
                   vqi.moq, vqi.lead_time_days, vqi.notes, vqi.can_do,
                   vqi.currency, vqi.attachment_paths, vqi.free_charge
              FROM vendor_quote_items vqi
              JOIN vendor_quotes vq ON vq.id = vqi.quote_id
             WHERE vq.batch_id = $1 AND vq.vendor_id = $2 AND vq.round_number = $3
             ORDER BY vqi.item_id
            """,
            batch_id, vendor_id, prev_round,
        )
        items = [dict(r) for r in rows]

    return {
        "data": {
            "round": round_number,
            "prev_round": prev_round if prev_round >= 1 else None,
            "items": items,
        }
    }


@router.get("/my")
async def my_quotes(
    page: int = 1,
    limit: int = 20,
    vendor_id: int = Depends(resolve_vendor),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Lịch sử báo giá của tôi (kèm round_number + trạng thái lời mời)."""
    rows = await conn.fetch(
        """
        SELECT vq.id, vq.batch_id, vq.currency, vq.total_amount, vq.status,
               vq.round_number, vq.submitted_at, vq.lead_time_days, vq.valid_until,
               b.batch_code, b.title, b.status AS batch_status, b.item_count,
               b.bid_deadline,
               inv.status AS inv_status
        FROM vendor_quotes vq
        JOIN procurement_rfq_batches b ON b.id = vq.batch_id
        LEFT JOIN LATERAL (
              SELECT i.status
                FROM procurement_rfq_invitations i
               WHERE i.batch_id = vq.batch_id AND i.vendor_id = vq.vendor_id
               ORDER BY i.round_number DESC NULLS LAST, i.invited_at DESC NULLS LAST
               LIMIT 1
        ) inv ON TRUE
        WHERE vq.vendor_id = $1
        ORDER BY vq.submitted_at DESC NULLS LAST
        LIMIT $2 OFFSET $3
        """,
        vendor_id, limit, (page - 1) * limit,
    )

    return {"data": [dict(r) for r in rows]}


@router.post("/upload-file")
async def upload_quote_file(
    batch_id: int = Form(...),
    file: UploadFile = File(...),
    vendor_id: int = Depends(resolve_vendor),
    conn: asyncpg.Connection = Depends(get_db),
    _rl: None = Depends(upload_rate_limit),
):
    """Upload Excel/PDF đính kèm cho báo giá (chỉ đợt đã được mời).

    Rate-limited (10/phút/IP) để chặn flood upload làm đầy đĩa — file vẫn nằm
    trong sandbox vendor_uploads/{vendor_id}.
    """
    # Validate file type — Excel / PDF / ảnh (JPG/PNG). Thang 30/06: NCC hay
    # gửi kèm ảnh chụp báo giá / sản phẩm.
    allowed = (".xlsx", ".xls", ".pdf", ".jpg", ".jpeg", ".png")
    fname = (file.filename or "").lower()
    if not fname or not any(fname.endswith(ext) for ext in allowed):
        raise HTTPException(400, "Chỉ chấp nhận Excel (.xlsx, .xls), PDF (.pdf) hoặc ảnh (.jpg, .jpeg, .png)")

    # Max 10MB
    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(400, "File quá lớn (tối đa 10MB)")

    # Magic-byte check cho ẢNH (hiển thị inline ở admin preview → chặn file giả
    # đuôi ảnh). Excel/PDF giữ kiểm theo đuôi như cũ (không đổi hành vi sẵn có).
    if fname.endswith((".jpg", ".jpeg")) and content[:3] != b"\xff\xd8\xff":
        raise HTTPException(400, "File .jpg/.jpeg không hợp lệ (sai định dạng ảnh)")
    if fname.endswith(".png") and content[:8] != b"\x89PNG\r\n\x1a\n":
        raise HTTPException(400, "File .png không hợp lệ (sai định dạng ảnh)")

    # Gate on invitation — a vendor may only attach to a batch they were invited to.
    inv = await _latest_invitation(conn, batch_id, vendor_id)
    if not inv:
        raise HTTPException(404, "Không tìm thấy lời mời báo giá cho đợt này")

    # Save file (sandboxed under vendor_uploads/{vendor_id}).
    upload_dir = _vendor_sandbox_dir(vendor_id)
    upload_dir.mkdir(parents=True, exist_ok=True)

    # SECURITY: the raw client filename may contain '../' or an absolute path and
    # escape upload_dir (arbitrary file write). Reduce to a bare basename, drop any
    # residual separators, keep only safe chars, then assert the RESOLVED dest is
    # still inside upload_dir — reject otherwise.
    safe_name = os.path.basename(file.filename or "").replace("\\", "").replace("/", "")
    safe_name = re.sub(r"[^A-Za-z0-9._-]", "_", safe_name).lstrip(".") or "upload"
    dest = upload_dir / f"batch_{batch_id}_{safe_name}"
    try:
        resolved = dest.resolve()
        resolved.relative_to(upload_dir)
    except (ValueError, OSError):
        logger.warning("Upload dest escapes vendor %s sandbox: %r", vendor_id, file.filename)
        raise HTTPException(400, "Tên file không hợp lệ")
    resolved.write_bytes(content)
    dest = resolved

    # Update quote attachment (latest round for this vendor+batch).
    await conn.execute(
        """UPDATE vendor_quotes SET attachment_path = $1
            WHERE id = (
                SELECT id FROM vendor_quotes
                 WHERE batch_id = $2 AND vendor_id = $3
                 ORDER BY round_number DESC NULLS LAST, submitted_at DESC NULLS LAST
                 LIMIT 1
            )""",
        str(dest), batch_id, vendor_id,
    )

    return {"message": "File đã tải lên", "path": str(dest), "size": len(content)}


@router.get("/batches/{batch_id}/items/{item_id}/drawing")
async def view_item_drawing(
    batch_id: int,
    item_id: int,
    vendor_id: int = Depends(resolve_vendor),
    conn: asyncpg.Connection = Depends(get_db),
):
    """P5 — NCC được mời xem bản vẽ của 1 mã hàng (login-scoped, invitation-gated).

    Mirror access check của vendor batch-detail: NCC phải có lời mời cho đợt này
    (procurement_rfq_invitations) — 404 nếu không (không lộ sự tồn tại đợt chưa mời).
    Item phải thuộc đợt. Trả file:// (stream sandboxed), bqms:// (redirect ảnh BQMS),
    http(s):// (legacy). Dùng CHUNG helper _drawing_response trong procurement.py (DRY).
    """
    inv = await _latest_invitation(conn, batch_id, vendor_id)
    if not inv:
        # 404 (not 403) — never leak existence of an uninvited batch.
        raise HTTPException(404, "Không tìm thấy đợt báo giá")

    item = await conn.fetchrow(
        """
        SELECT it.item_no, it.drawing_url
          FROM procurement_rfq_items it
         WHERE it.id = $1 AND it.batch_id = $2
        """,
        item_id, batch_id,
    )
    if not item:
        raise HTTPException(404, "Mã hàng không thuộc đợt báo giá này")

    drawing_url = (item["drawing_url"] or "").strip()

    # bqms:// — the admin endpoint 307-redirects to /api/v1/bqms/rfq/image, but that
    # target requires admin/staff and rejects vendor auth. So for the VENDOR endpoint
    # we resolve + STREAM the BQMS image SERVER-SIDE (no redirect): an invited vendor
    # can actually see a BQMS-sourced drawing. No stored image on disk -> clean 404
    # (never a broken redirect to an admin-only URL).
    if drawing_url.startswith("bqms://"):
        from fastapi.responses import FileResponse
        from app.api.v1.bqms_images import resolve_rfq_image_file

        code = drawing_url[len("bqms://"):]
        found = await resolve_rfq_image_file(code, None)
        if found is None:
            raise HTTPException(404, "Mã hàng này chưa có ảnh bản vẽ BQMS")
        return FileResponse(
            str(found),
            filename=found.name,
            content_disposition_type="inline",
            headers={"Cache-Control": "no-store"},
        )

    # file:// (stream sandboxed) + http(s):// (legacy redirect) — reuse the shared helper.
    from app.api.v1.procurement import _drawing_response
    return _drawing_response(drawing_url, item_no=item["item_no"])
