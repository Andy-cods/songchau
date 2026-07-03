"""Vendor Portal — View MY purchase orders and self-submit shipments (login-scoped).

Đợt 4 (Thang 2026-06-19): the supplier side of the PO + delivery lifecycle. The
admin owns PO creation (procurement.py `POST /contracts/{id}/create-po`) and the
arrived/received transitions (`PUT /deliveries/{id}/status`); the VENDOR here can:
  - GET /api/vendor/pos            → list MY purchase orders (draft HIDDEN).
  - GET /api/vendor/pos/{id}       → detail (items + my deliveries), 404 if not mine.
  - POST /api/vendor/pos/{id}/deliveries → self-submit a shipment (status='shipping').
  - GET /api/vendor/deliveries     → my deliveries list.

Every query is scoped through `resolve_vendor` (active `vendor_accounts.id`). A
vendor can ONLY see / act on POs where `procurement_pos.vendor_id` equals their own
resolved id. Cross-tenant access returns 404 (never 403) so we never leak the
existence of another vendor's PO. Drafts are HIDDEN from the vendor entirely (only
status IN open/partially_delivered/delivered/closed/cancelled are visible) — the PO
is born 'open' from an active contract, so a vendor never sees admin WIP.

Internal admin columns (created_by, internal notes, target_price, …) are NEVER
selected/returned. Self-submitting a shipment MIRRORS the admin
`POST /pos/{id}/deliveries` logic in procurement.py 1:1 (delivery_no via
nextval('procurement_delivery_seq'), insert delivery + items, INCREMENT
procurement_po_items.delivered_qty, AUTO-bump PO status) but writes status='shipping'
(the supplier is shipping it; admin later marks arrived/received) and stamps
vendor_id=resolve_vendor + created_by=token_data.user_id. delivered_qty is validated
against ordered_qty − already_delivered (400 if over). The whole write is one
transaction and appends procurement_audit_log rows via the shared `_audit` helper
(DRY single source in procurement.py): a 'delivery'/'create' row and, if the PO
status was bumped, a 'po'/'status_change' row.

AP (accounts payable) is Đợt 5 and is intentionally NOT touched here.
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
from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse

from app.api.vendor.deps import resolve_vendor
from app.core.database import get_db
from app.core.rbac import get_current_user
from app.core.security import TokenData

logger = logging.getLogger(__name__)


def _num(raw: Any):
    """Numeric → float | None (for NUMERIC columns). Never raises."""
    if raw in (None, ""):
        return None
    try:
        return float(raw)
    except (ValueError, TypeError):
        return None

# Two routers so each lands on its own top-level vendor prefix in __init__.py:
#   router            → mounted at prefix="/pos"        (GET/{id}, deliveries submit)
#   deliveries_router → mounted at prefix="/deliveries" (GET my deliveries list)
# The vendor_router can't reach /api/vendor/deliveries from inside the /pos prefix,
# so the deliveries list lives on its own router (registered alongside in __init__).
router = APIRouter()
deliveries_router = APIRouter()

# Statuses a vendor is ever allowed to see for a PO. 'draft' is admin-only WIP and
# is hidden so the supplier never learns a PO exists before it is opened.
_VENDOR_VISIBLE = ("open", "partially_delivered", "delivered", "closed", "cancelled")

# A vendor may only self-submit a shipment while the PO is still receiving goods.
_DELIVERABLE = ("open", "partially_delivered")

# A vendor may acknowledge any vendor-visible PO except a cancelled one.
_ACKNOWLEDGEABLE = ("open", "partially_delivered", "delivered", "closed")

# Delivery method / quality whitelists (mirror the DB CHECK constraints).
_DELIVERY_METHODS = ("courier", "vendor_delivery", "pickup", "express")
_QUALITY_STATUSES = ("ok", "minor_defect", "rejected")


# ── Audit helper (DRY single source lives in procurement.py) ──────────────────
# The canonical `_audit` lives in app/api/v1/procurement.py and is shared by the
# vendor side. We import it so vendor-side writes use the exact same INSERT +
# signature. A thin local fallback keeps this module importable/runnable before
# the helper has landed (best-effort: swallow a missing audit table).
try:  # pragma: no cover - import wiring (shared with admin side)
    from app.api.v1.procurement import _audit  # type: ignore
except Exception:  # pragma: no cover - fallback until backend agent lands helper
    import json as _json

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
            logger.warning(
                "procurement_audit_log missing; skipped audit %s/%s", entity_type, action
            )


# ── Notification dispatch (best-effort, never raises) ─────────────────────────
# Shared producer that fans out a procurement notification to the INTERNAL team
# (admin + manager + procurement). The acknowledge endpoint uses it CHIỀU NGƯỢC
# (vendor → internal) and TUYỆT ĐỐI KHÔNG truyền awarded_vendor_id (else the NCC
# would receive a copy of its own notification). A no-op fallback keeps this module
# importable/runnable if the service hasn't landed yet.
try:  # pragma: no cover - import wiring (shared with admin side)
    from app.services.procurement_notifications import dispatch_procurement_event  # type: ignore
except Exception:  # pragma: no cover - fallback until service lands
    async def dispatch_procurement_event(*args, **kwargs) -> int:  # type: ignore[no-redef]
        return 0


# ── Date coercion (DRY single source lives in procurement.py) ─────────────────
# Reuse the admin-side `_as_date` so a client `<input type="date">` ISO string is
# parsed before asyncpg DATE binding (asyncpg rejects str for DATE). Self-contained
# fallback mirrors it 1:1 in case the canonical helper hasn't landed.
try:  # pragma: no cover - import wiring (shared with admin side)
    from app.api.v1.procurement import _as_date  # type: ignore
except Exception:  # pragma: no cover - fallback mirror of procurement._as_date
    from datetime import date as _date, datetime as _datetime

    def _as_date(v):  # type: ignore[no-redef]
        if v is None or v == "":
            return None
        if isinstance(v, _datetime):
            return v.date()
        if isinstance(v, _date):
            return v
        if isinstance(v, str):
            try:
                return _date.fromisoformat(v.strip()[:10])
            except ValueError:
                raise HTTPException(400, f"Ngày không hợp lệ: {v!r} (định dạng YYYY-MM-DD)")
        raise HTTPException(400, f"Ngày không hợp lệ: {v!r}")


def _client_ip(request: Request) -> str | None:
    """Best-effort caller IP (honours X-Forwarded-For behind the reverse proxy)."""
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip() or None
    return request.client.host if request.client else None


@router.get("")
async def list_my_pos(
    status: str | None = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=50),
    vendor_id: int = Depends(resolve_vendor),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Danh sách ĐƠN ĐẶT HÀNG (PO) của tôi.

    Scoped to `procurement_pos.vendor_id = resolve_vendor()`. Drafts are never
    returned (only status IN open/partially_delivered/delivered/closed/cancelled).
    Internal admin columns (created_by, notes, target_price) are NEVER selected.
    Optional ?status filter is intersected with the vendor-visible set, so a vendor
    can never use it to ask for drafts. `delivered_pct` is computed from item qty
    totals; `my_delivery_count` counts only this vendor's deliveries on the PO.
    """
    where = "p.vendor_id = $1 AND p.status = ANY($2::text[])"
    params: list[Any] = [vendor_id, list(_VENDOR_VISIBLE)]

    if status:
        if status not in _VENDOR_VISIBLE:
            # Asking for a status a vendor may never see → empty, not an error.
            return {"data": [], "total": 0}
        where = "p.vendor_id = $1 AND p.status = $2"
        params = [vendor_id, status]

    total = await conn.fetchval(
        f"SELECT COUNT(*) FROM procurement_pos p WHERE {where}", *params
    )

    offset = (page - 1) * limit
    rows = await conn.fetch(
        f"""
        SELECT p.id, p.po_no, p.po_date, p.requested_delivery_date,
               p.actual_delivery_date, p.total_amount, p.currency, p.status,
               p.payment_status, p.delivery_address,
               c.contract_no,
               (SELECT COUNT(*) FROM procurement_po_items i
                 WHERE i.po_id = p.id) AS item_count,
               (SELECT COUNT(*) FROM procurement_deliveries d
                 WHERE d.po_id = p.id AND d.vendor_id = $1) AS my_delivery_count,
               COALESCE(
                 (SELECT CASE WHEN SUM(i.ordered_qty) > 0
                              THEN ROUND(100.0 * SUM(i.delivered_qty) / SUM(i.ordered_qty), 1)
                              ELSE 0 END
                    FROM procurement_po_items i WHERE i.po_id = p.id),
                 0
               ) AS delivered_pct
          FROM procurement_pos p
          LEFT JOIN procurement_contracts c ON c.id = p.contract_id
         WHERE {where}
         ORDER BY p.po_date DESC, p.id DESC
         LIMIT ${len(params) + 1} OFFSET ${len(params) + 2}
        """,
        *params, limit, offset,
    )
    return {"data": [dict(r) for r in rows], "total": total}


@router.get("/{po_id}")
async def get_my_po(
    po_id: int,
    vendor_id: int = Depends(resolve_vendor),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Chi tiết ĐƠN ĐẶT HÀNG (PO) của tôi + dòng hàng + các lần tôi giao.

    GUARD: the PO must belong to me (vendor_id = resolve_vendor()) and be in a
    vendor-visible status (NOT 'draft') — otherwise 404 (never 403), so we don't
    leak the existence of other vendors' / draft POs. Internal admin columns
    (created_by) are NOT exposed. `deliveries` lists only THIS vendor's deliveries.
    """
    row = await conn.fetchrow(
        """
        SELECT p.id, p.po_no, p.contract_id, p.po_date, p.requested_delivery_date,
               p.actual_delivery_date, p.total_amount, p.currency, p.status,
               p.payment_status, p.delivery_address, p.vendor_name,
               p.closed_at, p.created_at, p.updated_at,
               p.acknowledged_at, p.acknowledged_by, p.ack_note,
               c.contract_no
          FROM procurement_pos p
          LEFT JOIN procurement_contracts c ON c.id = p.contract_id
         WHERE p.id = $1 AND p.vendor_id = $2 AND p.status = ANY($3::text[])
        """,
        po_id, vendor_id, list(_VENDOR_VISIBLE),
    )
    if not row:
        # 404 (not 403) — never leak cross-tenant / draft existence.
        raise HTTPException(404, "Không tìm thấy đơn đặt hàng")

    items = await conn.fetch(
        """
        SELECT id, item_no, bqms_code, specification, ordered_qty, delivered_qty,
               unit, unit_price, total_price, notes
          FROM procurement_po_items
         WHERE po_id = $1
         ORDER BY item_no
        """,
        po_id,
    )

    deliveries = await conn.fetch(
        """
        SELECT d.id, d.delivery_no, d.delivered_at, d.delivery_method,
               d.tracking_no, d.status, d.received_at, d.created_at, d.documents,
               (SELECT COUNT(*) FROM procurement_delivery_items di
                 WHERE di.delivery_id = d.id) AS item_count
          FROM procurement_deliveries d
         WHERE d.po_id = $1 AND d.vendor_id = $2
         ORDER BY d.created_at DESC
        """,
        po_id, vendor_id,
    )

    # Strip server 'path' khỏi documents (NCC chỉ cần name/size để list + tải theo idx).
    deliveries_out: list[dict] = []
    for d in deliveries:
        dd = dict(d)
        docs = dd.get("documents")
        if isinstance(docs, str):
            try:
                docs = _json.loads(docs or "[]")
            except Exception:
                docs = []
        dd["documents"] = [
            {"name": x.get("name"), "size": x.get("size")} for x in (docs or [])
        ]
        deliveries_out.append(dd)

    return {
        "data": {
            **dict(row),
            "items": [dict(i) for i in items],
            "deliveries": deliveries_out,
        }
    }


@router.post("/{po_id}/acknowledge")
async def acknowledge_my_po(
    po_id: int,
    body: dict[str, Any],
    request: Request,
    vendor_id: int = Depends(resolve_vendor),
    conn: asyncpg.Connection = Depends(get_db),
):
    """NCC xác nhận "đã nhận đơn" cho PO của mình (stamp acknowledged_at + ghi chú).

    Đợt 9 / Item 3. Một-nút-xác-nhận + ghi chú tùy chọn (KHÔNG có nhánh từ chối).
    KHÔNG đụng status machine (giữ nguyên gate giao hàng) — chỉ stamp 3 cột ack.

    GUARDS / BẢO MẬT:
      - PO phải thuộc về tôi (vendor_id = resolve_vendor()) VÀ ở trạng thái
        vendor-visible → nếu không: 404 (KHÔNG 403) để không lộ tồn tại PO của
        NCC khác / PO draft.
      - PO 'cancelled' → 409 (không thể xác nhận đơn đã huỷ).
      - IDEMPOTENT: đã xác nhận trước đó → trả lại acknowledged_at cũ, KHÔNG ghi
        đè, KHÔNG raise. UPDATE có `AND acknowledged_at IS NULL` nên race-safe.

    CHAIN-REACTION (chiều ngược NCC → internal team): dispatch_procurement_event
    với actor_id=None (cả team nhận) và TUYỆT ĐỐI KHÔNG truyền awarded_vendor_id
    (nếu truyền, NCC tự nhận lại notif của chính mình). detail chỉ gồm
    batch_id + po_no + ack_note — KHÔNG có giá / target_price / xếp hạng.
    """
    # Đọc PO scoped — tự thêm batch_id (get_my_po không select) để dựng notif detail.
    row = await conn.fetchrow(
        """
        SELECT id, status, acknowledged_at, po_no, batch_id
          FROM procurement_pos
         WHERE id = $1 AND vendor_id = $2 AND status = ANY($3::text[])
        """,
        po_id, vendor_id, list(_VENDOR_VISIBLE),
    )
    if not row:
        # 404 (not 403) — never leak cross-tenant / draft existence.
        raise HTTPException(404, "Không tìm thấy đơn đặt hàng")
    if row["status"] == "cancelled":
        raise HTTPException(409, "Đơn đã huỷ, không thể xác nhận")

    # IDEMPOTENT: already acknowledged → return prior timestamp, no overwrite/raise.
    if row["acknowledged_at"] is not None:
        return {
            "data": {
                "acknowledged_at": row["acknowledged_at"].isoformat(),
                "already": True,
            },
            "message": "Đơn đã được xác nhận trước đó",
        }

    note = (body.get("note") or "").strip()[:500] or None

    async with conn.transaction():
        updated = await conn.execute(
            """
            UPDATE procurement_pos
               SET acknowledged_at = NOW(), acknowledged_by = $1,
                   ack_note = $2, updated_at = NOW()
             WHERE id = $3 AND vendor_id = $4 AND acknowledged_at IS NULL
            """,
            vendor_id, note, po_id, vendor_id,
        )
        if updated == "UPDATE 0":
            # Race: someone acknowledged between our SELECT and UPDATE → idempotent.
            ts = await conn.fetchval(
                "SELECT acknowledged_at FROM procurement_pos WHERE id = $1", po_id
            )
            return {
                "data": {
                    "acknowledged_at": ts.isoformat() if ts else None,
                    "already": True,
                },
                "message": "Đơn đã được xác nhận trước đó",
            }

        ts = await conn.fetchval(
            "SELECT acknowledged_at FROM procurement_pos WHERE id = $1", po_id
        )

        await _audit(
            conn, "po", po_id, "acknowledge",
            actor_vendor_id=vendor_id, ip=_client_ip(request),
            detail={"po_no": row["po_no"], "ack_note": note},
        )

        # CHIỀU NGƯỢC → internal team only. actor_id=None (cả team nhận); KHÔNG
        # truyền awarded_vendor_id. Bọc try/except để an toàn (producer đã best-effort
        # nội bộ nhưng giữ guard để dispatch không bao giờ vỡ business write).
        try:
            await dispatch_procurement_event(
                conn, "po", po_id, "acknowledge",
                actor_id=None,
                detail={
                    "batch_id": row["batch_id"],
                    "po_no": row["po_no"],
                    "ack_note": note,
                },
            )
        except Exception as exc:  # noqa: BLE001 — never break the ack write
            logger.warning("acknowledge dispatch failed (po %d): %s", po_id, exc)

    logger.info("Vendor %d acknowledged PO %d (po_no=%s)", vendor_id, po_id, row["po_no"])
    return {
        "data": {
            "acknowledged_at": ts.isoformat() if ts else None,
            "already": False,
        },
        "message": "Đã xác nhận nhận đơn",
    }


@router.post("/{po_id}/deliveries")
async def submit_my_delivery(
    po_id: int,
    body: dict[str, Any],
    request: Request,
    vendor_id: int = Depends(resolve_vendor),
    token_data: TokenData = Depends(get_current_user),
    conn: asyncpg.Connection = Depends(get_db),
):
    """NCC tự gửi 1 lô GIAO HÀNG cho PO của mình (status='shipping').

    Body: {
        "items": [{po_item_id: int, delivered_qty: number, quality_status?: 'ok'|'minor_defect'|'rejected', notes?: str}],
        "delivery_method"?: 'courier'|'vendor_delivery'|'pickup'|'express',
        "tracking_no"?: str,
        "delivered_at"?: 'YYYY-MM-DD',
        "notes"?: str
    }

    GUARDS:
      - PO must belong to me (vendor_id = resolve_vendor()) else 404 (never leak).
      - PO status MUST be IN ('open','partially_delivered') else 400 (a delivered/
        closed/cancelled PO can't receive more shipments).
      - every po_item_id must belong to THIS PO else 400.
      - delivered_qty must be > 0 and must NOT exceed ordered_qty − already_delivered
        for that item else 400 (no over-delivery).

    Mirrors the admin POST /pos/{id}/deliveries logic 1:1 (delivery_no via
    nextval('procurement_delivery_seq'), insert delivery + items, INCREMENT
    procurement_po_items.delivered_qty, AUTO-bump PO status to delivered when all
    items reach 100% else partially_delivered) — but writes status='shipping' and
    stamps vendor_id=resolve_vendor + created_by=token_data.user_id. Whole write is
    one transaction; appends a 'delivery'/'create' audit row and, if the PO status
    was bumped, a 'po'/'status_change' audit row (actor_vendor_id=me).
    """
    items_in = body.get("items") or []
    if not isinstance(items_in, list) or not items_in:
        raise HTTPException(400, "Cần ít nhất 1 dòng hàng để giao (items)")

    method = body.get("delivery_method") or "vendor_delivery"
    if method not in _DELIVERY_METHODS:
        raise HTTPException(400, f"delivery_method không hợp lệ: {method!r}")

    delivered_at = _as_date(body.get("delivered_at"))

    async with conn.transaction():
        # Ownership + status gate (FOR UPDATE so the qty checks below are race-safe).
        po = await conn.fetchrow(
            """
            SELECT id, status
              FROM procurement_pos
             WHERE id = $1 AND vendor_id = $2 AND status = ANY($3::text[])
             FOR UPDATE
            """,
            po_id, vendor_id, list(_VENDOR_VISIBLE),
        )
        if not po:
            raise HTTPException(404, "Không tìm thấy đơn đặt hàng")
        if po["status"] not in _DELIVERABLE:
            raise HTTPException(
                400,
                f"PO ở trạng thái '{po['status']}' — không gửi giao hàng được",
            )

        # Load this PO's items (ordered/delivered) keyed by id for validation.
        po_items = await conn.fetch(
            "SELECT id, ordered_qty, delivered_qty FROM procurement_po_items WHERE po_id = $1",
            po_id,
        )
        by_id = {int(r["id"]): r for r in po_items}

        # Validate each line BEFORE any write.
        parsed: list[tuple[int, float, str, str | None]] = []
        for it in items_in:
            try:
                pid = int(it["po_item_id"])
                qty = float(it["delivered_qty"])
            except (KeyError, TypeError, ValueError):
                raise HTTPException(400, "Mỗi dòng cần po_item_id (int) và delivered_qty (số)")
            if pid not in by_id:
                raise HTTPException(400, f"po_item_id {pid} không thuộc PO này")
            if qty <= 0:
                raise HTTPException(400, f"delivered_qty phải > 0 (po_item_id {pid})")
            ordered = float(by_id[pid]["ordered_qty"])
            already = float(by_id[pid]["delivered_qty"] or 0)
            remaining = ordered - already
            if qty > remaining + 1e-9:
                raise HTTPException(
                    400,
                    f"delivered_qty {qty} vượt số còn lại {remaining} (po_item_id {pid})",
                )
            quality = it.get("quality_status") or "ok"
            if quality not in _QUALITY_STATUSES:
                raise HTTPException(400, f"quality_status không hợp lệ: {quality!r}")
            parsed.append((pid, qty, quality, it.get("notes")))

        # Allocate delivery_no and insert the shipment header (status='shipping').
        seq = await conn.fetchval("SELECT nextval('procurement_delivery_seq')")
        delivery_no = f"SC-DEL-{datetime.now().year}-{seq:04d}"

        delivery_id = await conn.fetchval(
            """
            INSERT INTO procurement_deliveries (
                delivery_no, po_id, vendor_id, delivered_at, delivery_method,
                tracking_no, status, notes, created_by,
                vendor_invoice_no, invoice_date, packing_qty, packing_unit, gross_weight
            ) VALUES ($1,$2,$3,$4,$5,$6,'shipping',$7,$8,$9,$10,$11,$12,$13)
            RETURNING id
            """,
            delivery_no, po_id, vendor_id, delivered_at, method,
            body.get("tracking_no"), body.get("notes"), token_data.user_id,
            (body.get("vendor_invoice_no") or None),
            _as_date(body.get("invoice_date")),
            _num(body.get("packing_qty")),
            (body.get("packing_unit") or None),
            _num(body.get("gross_weight")),
        )

        for pid, qty, quality, line_notes in parsed:
            await conn.execute(
                """
                INSERT INTO procurement_delivery_items (
                    delivery_id, po_item_id, delivered_qty, quality_status, notes
                ) VALUES ($1,$2,$3,$4,$5)
                """,
                delivery_id, pid, qty, quality, line_notes,
            )
            # Increment delivered_qty on the PO item.
            await conn.execute(
                "UPDATE procurement_po_items SET delivered_qty = delivered_qty + $1 WHERE id = $2",
                qty, pid,
            )

        # Auto-update PO status from delivered_qty totals (mirror admin logic).
        totals = await conn.fetchrow(
            """SELECT SUM(ordered_qty) AS ordered, SUM(delivered_qty) AS delivered
                 FROM procurement_po_items WHERE po_id = $1""",
            po_id,
        )
        new_status = po["status"]
        if totals and totals["delivered"] is not None:
            ratio = (
                float(totals["delivered"]) / float(totals["ordered"])
                if totals["ordered"] else 0
            )
            new_status = "delivered" if ratio >= 1 else (
                "partially_delivered" if ratio > 0 else "open"
            )
        status_bumped = new_status != po["status"]
        if status_bumped:
            # On reaching 'delivered', stamp actual_delivery_date (first time only).
            await conn.execute(
                "UPDATE procurement_pos SET status = $1, updated_at = NOW(), "
                "actual_delivery_date = CASE WHEN $1 = 'delivered' "
                "THEN COALESCE(actual_delivery_date, NOW()::date) ELSE actual_delivery_date END "
                "WHERE id = $2",
                new_status, po_id,
            )

        client_ip = _client_ip(request)
        await _audit(
            conn, "delivery", delivery_id, "create",
            actor_vendor_id=vendor_id, ip=client_ip,
            detail={
                "po_id": po_id,
                "delivery_no": delivery_no,
                "delivery_method": method,
                "tracking_no": body.get("tracking_no"),
                "line_count": len(parsed),
            },
        )
        if status_bumped:
            await _audit(
                conn, "po", po_id, "status_change",
                actor_vendor_id=vendor_id, ip=client_ip,
                from_status=po["status"], to_status=new_status,
                detail={"via": "vendor_delivery_submit", "delivery_no": delivery_no},
            )

    logger.info(
        "Vendor %d submitted delivery %s on PO %d (lines=%d, po_status=%s)",
        vendor_id, delivery_no, po_id, len(parsed), new_status,
    )

    return {
        "message": f"Đã gửi giao hàng {delivery_no}",
        "data": {
            "id": delivery_id,
            "delivery_no": delivery_no,
            "status": "shipping",
            "po_status": new_status,
        },
    }


@router.get("/{po_id}/pdf")
async def download_my_po_pdf(
    po_id: int,
    vendor_id: int = Depends(resolve_vendor),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Đợt 8 #9 — NCC tải PDF ĐƠN ĐẶT HÀNG CỦA MÌNH (vendor-scoped, 404 cross-tenant)."""
    from app.api.v1.procurement import _resolve_under_files_base
    from app.services.procurement_docs import generate_po_pdf

    p = await conn.fetchrow(
        "SELECT po_no, status FROM procurement_pos WHERE id = $1 AND vendor_id = $2",
        po_id, vendor_id,
    )
    if not p or p["status"] not in _VENDOR_VISIBLE:
        raise HTTPException(404, "Không tìm thấy đơn đặt hàng")
    try:
        rel = await generate_po_pdf(conn, po_id)
    except ValueError:
        raise HTTPException(404, "Không tìm thấy đơn đặt hàng")
    resolved = _resolve_under_files_base(rel)
    return FileResponse(
        str(resolved),
        media_type="application/pdf",
        filename=f"DonDatHang_{p['po_no']}.pdf",
    )


@router.post("/{po_id}/deliveries/{delivery_id}/upload-doc")
async def upload_delivery_doc(
    po_id: int,
    delivery_id: int,
    file: UploadFile = File(...),
    vendor_id: int = Depends(resolve_vendor),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Đợt 8 #6 — NCC upload chứng từ chất lượng (CO/CQ/test report) cho lô giao.

    Lưu vào cột documents JSONB (đã có sẵn), file vào sandbox vendor_uploads/{vendor_id}
    với prefix delivery_{id}_ (tránh đụng quote files batch_{id}_). Scope vendor.
    """
    from app.api.vendor.quotes import _vendor_sandbox_dir

    allowed = (".pdf", ".jpg", ".jpeg", ".png")
    fn = (file.filename or "").lower()
    if not file.filename or not any(fn.endswith(e) for e in allowed):
        raise HTTPException(400, "Chỉ chấp nhận PDF hoặc ảnh (.pdf/.jpg/.png)")
    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(400, "File quá lớn (tối đa 10MB)")
    # Defense-in-depth: magic-byte phải khớp đuôi file (chặn HTML đổi tên .pdf →
    # tránh stored-XSS khi serve lại). Kết hợp Content-Disposition: attachment dưới.
    ok_magic = (
        (fn.endswith(".pdf") and content[:5] == b"%PDF-")
        or (fn.endswith((".jpg", ".jpeg")) and content[:3] == b"\xff\xd8\xff")
        or (fn.endswith(".png") and content[:8] == b"\x89PNG\r\n\x1a\n")
    )
    if not ok_magic:
        raise HTTPException(400, "Nội dung file không khớp định dạng khai báo")

    d = await conn.fetchrow(
        "SELECT id, status FROM procurement_deliveries WHERE id = $1 AND po_id = $2 AND vendor_id = $3",
        delivery_id, po_id, vendor_id,
    )
    if not d:
        raise HTTPException(404, "Không tìm thấy lô giao")
    if d["status"] in ("rejected", "returned"):
        raise HTTPException(409, "Lô giao đã đóng (từ chối/trả lại) — không thể thêm chứng từ")

    upload_dir = _vendor_sandbox_dir(vendor_id)
    upload_dir.mkdir(parents=True, exist_ok=True)
    # SECURITY: reduce client filename to a safe basename pinned inside the sandbox.
    safe_name = os.path.basename(file.filename or "").replace("\\", "").replace("/", "")
    safe_name = re.sub(r"[^A-Za-z0-9._-]", "_", safe_name).lstrip(".") or "upload"
    dest = upload_dir / f"delivery_{delivery_id}_{safe_name}"
    try:
        resolved = dest.resolve()
        resolved.relative_to(upload_dir)
    except (ValueError, OSError):
        raise HTTPException(400, "Tên file không hợp lệ")
    resolved.write_bytes(content)

    entry = {"name": safe_name, "path": str(resolved), "size": len(content)}
    await conn.execute(
        "UPDATE procurement_deliveries "
        "SET documents = COALESCE(documents, '[]'::jsonb) || $1::jsonb, updated_at = NOW() "
        "WHERE id = $2",
        _json.dumps([entry]), delivery_id,
    )
    # KHÔNG trả 'path' (đường dẫn server) ra cổng NCC — chỉ cần name/size để list.
    return {"message": "Đã tải lên chứng từ", "document": {"name": safe_name, "size": len(content)}}


@router.get("/{po_id}/deliveries/{delivery_id}/documents/{idx}")
async def download_my_delivery_doc(
    po_id: int,
    delivery_id: int,
    idx: int,
    vendor_id: int = Depends(resolve_vendor),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Đợt 8 #6 — NCC tải chứng từ đã upload của lô giao CỦA MÌNH (scoped)."""
    from app.api.v1.procurement import _resolve_under_files_base

    d = await conn.fetchrow(
        "SELECT documents FROM procurement_deliveries WHERE id = $1 AND po_id = $2 AND vendor_id = $3",
        delivery_id, po_id, vendor_id,
    )
    if not d:
        raise HTTPException(404, "Không tìm thấy lô giao")
    docs = d["documents"]
    if isinstance(docs, str):
        docs = _json.loads(docs or "[]")
    if not docs or idx < 0 or idx >= len(docs):
        raise HTTPException(404, "Chứng từ không tồn tại")
    entry = docs[idx]
    resolved = _resolve_under_files_base(entry.get("path"))
    # attachment: chặn browser render inline file NCC upload (stored-XSS guard).
    return FileResponse(
        str(resolved),
        filename=entry.get("name") or f"document_{idx}",
        content_disposition_type="attachment",
    )


@router.get("/{po_id}/deliveries/{delivery_id}/note")
async def download_my_delivery_note(
    po_id: int,
    delivery_id: int,
    vendor_id: int = Depends(resolve_vendor),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Đợt 8 #2 — NCC tải PHIẾU GIAO NHẬN PDF của lô giao CỦA MÌNH.

    Scoped: lô giao phải thuộc PO của vendor này (vendor_id=resolve_vendor) — 404
    (không 403) nếu không phải của họ, không lộ tồn tại lô của NCC khác. Lazy-render
    nếu chưa có. Deferred import tránh circular import lúc load module.
    """
    from app.api.v1.procurement import _resolve_under_files_base  # generic path resolver
    from app.services.procurement_docs import generate_delivery_note_pdf

    d = await conn.fetchrow(
        """SELECT delivery_no, delivery_note_path
             FROM procurement_deliveries
            WHERE id = $1 AND po_id = $2 AND vendor_id = $3""",
        delivery_id, po_id, vendor_id,
    )
    if not d:
        raise HTTPException(404, "Không tìm thấy lô giao")
    rel = d["delivery_note_path"]
    if not rel:
        # file-write + path-store trong cùng txn (tránh orphan + double-generate).
        try:
            async with conn.transaction():
                rel = await generate_delivery_note_pdf(conn, delivery_id)
                await conn.execute(
                    "UPDATE procurement_deliveries SET delivery_note_path = $1, updated_at = NOW() WHERE id = $2",
                    rel, delivery_id,
                )
        except ValueError:
            raise HTTPException(404, "Không tìm thấy lô giao")
    resolved = _resolve_under_files_base(rel)
    return FileResponse(
        str(resolved),
        media_type="application/pdf",
        filename=f"PhieuGiaoNhan_{d['delivery_no']}.pdf",
    )


@deliveries_router.get("")
async def list_my_deliveries(
    status: str | None = Query(None),
    po_id: int | None = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=50),
    vendor_id: int = Depends(resolve_vendor),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Danh sách các lần GIAO HÀNG của tôi (vendor-scoped).

    Scoped to `procurement_deliveries.vendor_id = resolve_vendor()`. Returns basic
    fields + po_no (JOIN). Optional ?status / ?po_id filters. Internal admin columns
    (created_by, received_by, rejection_reason) are NOT exposed.
    """
    where = "d.vendor_id = $1"
    params: list[Any] = [vendor_id]
    idx = 2
    if status:
        where += f" AND d.status = ${idx}"
        params.append(status)
        idx += 1
    if po_id:
        where += f" AND d.po_id = ${idx}"
        params.append(po_id)
        idx += 1

    total = await conn.fetchval(
        f"SELECT COUNT(*) FROM procurement_deliveries d WHERE {where}", *params
    )

    offset = (page - 1) * limit
    rows = await conn.fetch(
        f"""
        SELECT d.id, d.delivery_no, d.po_id, d.delivered_at, d.delivery_method,
               d.tracking_no, d.status, d.received_at, d.created_at,
               p.po_no,
               (SELECT COUNT(*) FROM procurement_delivery_items di
                 WHERE di.delivery_id = d.id) AS item_count
          FROM procurement_deliveries d
          LEFT JOIN procurement_pos p ON p.id = d.po_id
         WHERE {where}
         ORDER BY d.created_at DESC
         LIMIT ${idx} OFFSET ${idx + 1}
        """,
        *params, limit, offset,
    )
    return {"data": [dict(r) for r in rows], "total": total}
