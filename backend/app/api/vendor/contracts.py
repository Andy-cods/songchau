"""Vendor Portal — View MY contracts and e-sign them (login-scoped).

Đợt 3 (Thang 2026-06-18): rebuild of the contract-sign path. The OLD magic-link
sign lived in public_bid.py which is now UNMOUNTED/GONE — every contract action a
supplier takes is login-scoped through `resolve_vendor` (active vendor_accounts.id).

A vendor can ONLY see / sign contracts where `procurement_contracts.vendor_id`
equals their own resolved id. Cross-tenant access returns 404 (never 403) so we
never leak the existence of another vendor's contract. Drafts are HIDDEN from the
vendor entirely (only status IN sent/signed/active/completed are visible) — the
admin must `send-to-vendor` (draft→sent) before a vendor can act.

E-sign (POST /{id}/sign): only a 'sent' contract can be signed. The transition is
sent→signed (NOT straight to 'active'); the admin later confirms via the admin-side
/activate (signed→active). Signing stamps signed_by_vendor (the typed name),
signed_at, signed_ip, and a signature_data JSONB blob, and appends a
procurement_audit_log row (actor_vendor_id=me, action='sign') atomically.

Status values are the EXACT 6 lifecycle strings
draft/sent/signed/active/completed/cancelled (TEXT + CHECK — NO enum). The "sent"
timestamp column is `sent_to_vendor_at` (there is no `sent_at`).
"""
from __future__ import annotations

import json as _json
import logging
from typing import Any

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse

from app.api.vendor.deps import resolve_vendor
from app.core.database import get_db

logger = logging.getLogger(__name__)
router = APIRouter()

# Statuses a vendor is ever allowed to see. Drafts are admin-only WIP and are
# hidden so the supplier never learns a contract exists before it is sent.
_VENDOR_VISIBLE = ("sent", "signed", "active", "completed")


# ── Audit helper (DRY single source lives in procurement.py) ──────────────────
# The canonical `_audit` lives in app/api/v1/procurement.py and is shared by the
# vendor side (its docstring documents this). We import it so vendor-side writes
# use the exact same INSERT + signature. A thin local fallback keeps this module
# importable/runnable before the helper has landed.
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
            logger.warning(
                "procurement_audit_log missing; skipped audit %s/%s", entity_type, action
            )


# ── PDF path resolver (DRY single source lives in procurement.py) ─────────────
# Reuse the admin-side path-traversal guard so the vendor PDF route pins the file
# under FILES_BASE_PATH exactly like the admin route. Self-contained fallback
# mirrors it 1:1 in case the canonical helper hasn't landed.
try:  # pragma: no cover - import wiring (shared with admin side)
    from app.api.v1.procurement import _resolve_contract_pdf  # type: ignore
except Exception:  # pragma: no cover - fallback mirror of procurement._resolve_contract_pdf
    import os as _os
    from pathlib import Path as _Path

    from app.core.config import settings as _settings

    def _resolve_contract_pdf(contract_file_path):  # type: ignore[no-redef]
        if not contract_file_path:
            raise HTTPException(404, "Chưa có file PDF")
        base = _Path(_settings.FILES_BASE_PATH).resolve()
        rel = str(contract_file_path)
        candidate = (base / rel) if not _os.path.isabs(rel) else _Path(rel)
        try:
            resolved = candidate.resolve()
            resolved.relative_to(base)
        except (ValueError, OSError):
            raise HTTPException(404, "File PDF không hợp lệ")
        if not resolved.is_file():
            raise HTTPException(404, "File PDF không tồn tại")
        return resolved


def _client_ip(request: Request) -> str | None:
    """Best-effort caller IP (honours X-Forwarded-For behind the reverse proxy)."""
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        # First hop is the original client.
        return fwd.split(",")[0].strip() or None
    return request.client.host if request.client else None


@router.get("")
async def list_my_contracts(
    status: str | None = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=50),
    vendor_id: int = Depends(resolve_vendor),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Danh sách HỢP ĐỒNG của tôi (chỉ những HĐ đã gửi cho tôi).

    Scoped to `procurement_contracts.vendor_id = resolve_vendor()`. Drafts are
    never returned (only status IN sent/signed/active/completed). Internal admin
    columns (created_by, notes) are NEVER selected. Optional ?status filter is
    intersected with the vendor-visible set, so a vendor can never use it to ask
    for drafts.
    """
    where = "c.vendor_id = $1 AND c.status = ANY($2::text[])"
    params: list[Any] = [vendor_id, list(_VENDOR_VISIBLE)]

    if status:
        if status not in _VENDOR_VISIBLE:
            # Asking for a status a vendor may never see → empty, not an error.
            return {"data": [], "total": 0}
        where = "c.vendor_id = $1 AND c.status = $2"
        params = [vendor_id, status]

    total = await conn.fetchval(
        f"SELECT COUNT(*) FROM procurement_contracts c WHERE {where}", *params
    )

    offset = (page - 1) * limit
    rows = await conn.fetch(
        f"""
        SELECT c.id, c.contract_no, c.total_amount, c.currency, c.status,
               c.contract_date, c.effective_date, c.expiry_date,
               c.sent_to_vendor_at, c.signed_at, c.signed_by_vendor,
               c.payment_terms, c.delivery_terms, c.warranty_terms,
               c.contract_file_path,
               b.batch_code,
               (SELECT COUNT(*) FROM procurement_contract_items i
                 WHERE i.contract_id = c.id) AS item_count
          FROM procurement_contracts c
          LEFT JOIN procurement_rfq_batches b ON b.id = c.batch_id
         WHERE {where}
         ORDER BY c.sent_to_vendor_at DESC NULLS LAST, c.id DESC
         LIMIT ${len(params) + 1} OFFSET ${len(params) + 2}
        """,
        *params, limit, offset,
    )
    return {"data": [dict(r) for r in rows], "total": total}


@router.get("/{contract_id}")
async def get_my_contract(
    contract_id: int,
    vendor_id: int = Depends(resolve_vendor),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Chi tiết HỢP ĐỒNG của tôi + danh sách dòng hàng.

    GUARD: the contract must belong to me (vendor_id = resolve_vendor()) and be in
    a vendor-visible status — otherwise 404 (never 403), so we don't leak the
    existence of other vendors' / draft contracts. Internal admin columns
    (created_by, notes, signed_by_user) are NOT exposed.
    """
    row = await conn.fetchrow(
        """
        SELECT c.id, c.contract_no, c.batch_id, c.total_amount, c.currency,
               c.payment_terms, c.delivery_terms, c.warranty_terms,
               c.status, c.contract_date, c.effective_date, c.expiry_date,
               c.sent_to_vendor_at, c.signed_at, c.signed_by_vendor,
               c.contract_file_path,
               c.vendor_name, c.vendor_email, c.vendor_phone,
               c.vendor_tax_code, c.vendor_address,
               b.batch_code, b.title AS batch_title
          FROM procurement_contracts c
          LEFT JOIN procurement_rfq_batches b ON b.id = c.batch_id
         WHERE c.id = $1 AND c.vendor_id = $2 AND c.status = ANY($3::text[])
        """,
        contract_id, vendor_id, list(_VENDOR_VISIBLE),
    )
    if not row:
        # 404 (not 403) — never leak cross-tenant / draft existence.
        raise HTTPException(404, "Không tìm thấy hợp đồng")

    items = await conn.fetch(
        """
        SELECT id, item_no, bqms_code, specification, quantity, unit,
               unit_price, total_price, lead_time_days, notes
          FROM procurement_contract_items
         WHERE contract_id = $1
         ORDER BY item_no
        """,
        contract_id,
    )

    return {"data": {**dict(row), "items": [dict(i) for i in items]}}


@router.get("/{contract_id}/pdf")
async def download_my_contract_pdf(
    contract_id: int,
    vendor_id: int = Depends(resolve_vendor),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Tải PDF hợp đồng CỦA TÔI (login-scoped).

    GUARD: hợp đồng phải thuộc về tôi (vendor_id = resolve_vendor()) và ở trạng
    thái vendor-visible (sent/signed/active/completed) — else 404 (never 403), để
    không lộ sự tồn tại HĐ của NCC khác / HĐ nháp. Path-traversal được chặn bởi
    `_resolve_contract_pdf` (pin dưới FILES_BASE_PATH; chỉ phục vụ path do server
    sinh, không bao giờ nhận path từ client).
    """
    c = await conn.fetchrow(
        """
        SELECT contract_no, contract_file_path
          FROM procurement_contracts
         WHERE id = $1 AND vendor_id = $2 AND status = ANY($3::text[])
        """,
        contract_id, vendor_id, list(_VENDOR_VISIBLE),
    )
    if not c:
        raise HTTPException(404, "Không tìm thấy hợp đồng")
    resolved = _resolve_contract_pdf(c["contract_file_path"])
    return FileResponse(
        str(resolved),
        media_type="application/pdf",
        filename=f"{c['contract_no']}.pdf",
    )


@router.post("/{contract_id}/sign")
async def sign_my_contract(
    contract_id: int,
    body: dict[str, Any],
    request: Request,
    vendor_id: int = Depends(resolve_vendor),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Ký điện tử hợp đồng (sent → signed).

    Body: {"signature_name": "Tên người ký", "agree": true}
      - signature_name: bắt buộc, không rỗng (tên người đại diện NCC ký).
      - agree: bắt buộc = true (đồng ý điều khoản) — else 400.

    GUARDS:
      - contract must belong to me (vendor_id = resolve_vendor()) else 404.
      - status MUST be 'sent' (else 400): a draft is invisible (404 above), and a
        contract already 'signed'/'active'/'completed' cannot be re-signed.

    Writes status='signed', signed_at=NOW(), signed_by_vendor=signature_name,
    signed_ip=<client ip>::inet, signature_data jsonb {name, agreed_at, ip,
    user_agent}. Appends a procurement_audit_log row (actor_vendor_id=me,
    action='sign', from='sent', to='signed', ip=<client ip>) atomically in the
    same transaction. This is sent→signed ONLY — the admin confirms signed→active
    separately (admin /activate).
    """
    signature_name = (body or {}).get("signature_name")
    if not isinstance(signature_name, str) or not signature_name.strip():
        raise HTTPException(400, "Vui lòng nhập tên người ký (signature_name)")
    signature_name = signature_name.strip()

    if (body or {}).get("agree") is not True:
        raise HTTPException(400, "Bạn phải đồng ý điều khoản hợp đồng (agree=true)")

    # Ownership + status gate in one fetch. 404 if not mine / not vendor-visible.
    row = await conn.fetchrow(
        """
        SELECT id, status
          FROM procurement_contracts
         WHERE id = $1 AND vendor_id = $2 AND status = ANY($3::text[])
        """,
        contract_id, vendor_id, list(_VENDOR_VISIBLE),
    )
    if not row:
        raise HTTPException(404, "Không tìm thấy hợp đồng")
    if row["status"] != "sent":
        raise HTTPException(
            400,
            f"Chỉ ký được hợp đồng ở trạng thái 'đã gửi' (hiện tại: '{row['status']}')",
        )

    client_ip = _client_ip(request)
    user_agent = request.headers.get("user-agent")
    signature_data = {
        "name": signature_name,
        "agreed_at": None,  # filled with DB NOW() below via separate read for the response
        "ip": client_ip,
        "user_agent": user_agent,
    }

    async with conn.transaction():
        updated = await conn.fetchrow(
            """
            UPDATE procurement_contracts
               SET status = 'signed',
                   signed_at = NOW(),
                   signed_by_vendor = $2,
                   signed_ip = $3::inet,
                   signature_data = $4::jsonb,
                   updated_at = NOW()
             WHERE id = $1 AND status = 'sent'
            RETURNING signed_at
            """,
            contract_id, signature_name, client_ip, _json.dumps(signature_data),
        )
        if not updated:
            # Lost a race: status changed away from 'sent' between SELECT and UPDATE.
            raise HTTPException(409, "Hợp đồng đã đổi trạng thái, vui lòng tải lại")

        # Persist the real signed_at into signature_data.agreed_at so the stored
        # blob and the column agree (single round-trip UPDATE, same txn).
        signed_at = updated["signed_at"]
        signature_data["agreed_at"] = signed_at.isoformat() if signed_at else None
        await conn.execute(
            "UPDATE procurement_contracts SET signature_data = $2::jsonb WHERE id = $1",
            contract_id, _json.dumps(signature_data),
        )

        await _audit(
            conn, "contract", contract_id, "sign",
            actor_vendor_id=vendor_id,
            from_status="sent", to_status="signed",
            ip=client_ip,
            detail={"signature_name": signature_name, "user_agent": user_agent},
        )

    logger.info(
        "Vendor %d e-signed contract %d (name=%r ip=%s)",
        vendor_id, contract_id, signature_name, client_ip,
    )

    return {
        "message": "Đã ký hợp đồng điện tử thành công",
        "data": {
            "status": "signed",
            "signed_at": signed_at.isoformat() if signed_at else None,
        },
    }
