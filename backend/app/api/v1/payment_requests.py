"""Payment Requests API.

Accountants/admins approve/reject payment requests originating from sourcing
orders. Sales/procurement see their own requests only.

State machine (payment_requests.status):

    draft -> pending -> approved -> paid
                   \\-> rejected
                   \\-> cancelled

Side effects on sourcing_orders.status:
  approve   : payment_requested -> payment_approved
  reject    : payment_requested -> confirmed   (so sales can edit + re-submit)
  mark-paid : no change (already payment_approved -> warehouse handles)

All status mutations on the linked sourcing_order go through
sourcing._so_apply_status_transition so audit history is preserved.

Thang 2026-06-03.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any, Literal

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

from app.core.audit import write_audit_log
from app.core.database import get_db
from app.core.rbac import require_role, TokenData

logger = logging.getLogger(__name__)
router = APIRouter()

# Vietnamese labels for reject reasons (surfaced in audit + in-app notifs).
REJECT_REASON_LABELS_VI: dict[str, str] = {
    "missing_info": "Thiếu thông tin",
    "insufficient_funds": "Không đủ ngân sách",
    "invalid_supplier": "NCC không hợp lệ",
    "other": "Khác",
}


# ── State constants ──────────────────────────────────────────────────────────
# Status set the table CHECK constraint allows (init_v3.sql:1736-1738).
_PR_STATUSES = {"draft", "pending", "approved", "paid", "rejected", "cancelled"}
_PR_ACTIVE_STATUSES = {"pending", "approved", "paid"}

# Roles that may see ALL payment requests; everyone else is auto-filtered to
# requester_id = self.
_PR_PRIVILEGED_ROLES = {"accountant", "manager", "admin", "director"}


# ── Pydantic models ──────────────────────────────────────────────────────────


class PaymentApprovePayload(BaseModel):
    note: str | None = None
    paid_immediately: bool | None = False


class PaymentRejectPayload(BaseModel):
    note: str = Field(..., min_length=5, max_length=1000)
    reason: Literal[
        "missing_info", "insufficient_funds", "invalid_supplier", "other"
    ]


class PaymentMarkPaidPayload(BaseModel):
    paid_at: datetime | None = None
    payment_proof_url: str | None = None
    note: str | None = None


# ── Serialization helpers ────────────────────────────────────────────────────


def _serialize_pr(row: asyncpg.Record | dict | None) -> dict | None:
    """Normalize PR row for JSON: datetimes -> iso, decimals -> int/float."""
    if row is None:
        return None
    from decimal import Decimal

    d = dict(row)
    for k, v in list(d.items()):
        if isinstance(v, datetime):
            d[k] = v.isoformat()
        elif hasattr(v, "isoformat"):
            d[k] = v.isoformat()
        elif isinstance(v, Decimal):
            d[k] = int(v) if v == v.to_integral_value() else float(v)
        elif isinstance(v, str) and k == "metadata":
            try:
                d[k] = json.loads(v)
            except Exception:
                pass
    return d


# ── List ──────────────────────────────────────────────────────────────────────


@router.get("")
async def list_payment_requests(
    status: str | None = Query(None, description="csv ok: pending,approved,..."),
    assigned_to: str | None = Query(None, description="user uuid"),
    customer: str | None = Query(None, description="customer name ilike"),
    date_from: str | None = Query(None, description="YYYY-MM-DD"),
    date_to: str | None = Query(None, description="YYYY-MM-DD"),
    q: str | None = Query(None, description="free text (order_number/desc/beneficiary)"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    sort: str = Query("created_at:desc"),
    token_data: TokenData = Depends(require_role(
        "admin", "manager", "accountant", "director",
        "sales", "procurement", "staff",
    )),
    conn: asyncpg.Connection = Depends(get_db),
):
    """List payment requests with filters + pagination.

    Privileged roles see all; sales/procurement/staff are auto-filtered to
    `requester_id = self`.
    """
    where: list[str] = ["1=1"]
    args: list[Any] = []
    n = 0

    def add(clause_tmpl: str, value: Any) -> None:
        nonlocal n
        n += 1
        where.append(clause_tmpl.replace("$$", f"${n}"))
        args.append(value)

    if status:
        parts = [s.strip() for s in status.split(",") if s.strip() in _PR_STATUSES]
        if parts:
            add("pr.status = ANY($$::text[])", parts)
    if assigned_to:
        add("so.assigned_to = $$::uuid", assigned_to)
    if customer:
        add("so.customer_name ILIKE $$", f"%{customer}%")
    if date_from:
        add("pr.created_at >= $$::timestamptz", date_from)
    if date_to:
        add("pr.created_at < ($$::timestamptz + INTERVAL '1 day')", date_to)
    if q:
        n += 1
        where.append(
            f"(so.order_number ILIKE ${n} OR pr.description ILIKE ${n} "
            f"OR pr.beneficiary_name ILIKE ${n})"
        )
        args.append(f"%{q}%")

    actor_role = (token_data.role or "").lower()
    if actor_role not in _PR_PRIVILEGED_ROLES and actor_role != "viewer":
        add("pr.requester_id = $$::uuid", token_data.user_id)

    # Sort whitelist
    sort_field, _, sort_dir = sort.partition(":")
    sort_field = sort_field.strip() or "created_at"
    sort_dir = (sort_dir or "desc").lower()
    if sort_field not in {"created_at", "amount", "status", "approved_at"}:
        sort_field = "created_at"
    if sort_dir not in {"asc", "desc"}:
        sort_dir = "desc"

    where_sql = " AND ".join(where)
    offset = (page - 1) * page_size

    total = await conn.fetchval(
        f"""
        SELECT COUNT(*)
          FROM payment_requests pr
          LEFT JOIN sourcing_orders so ON so.id = pr.sourcing_order_id
         WHERE {where_sql}
        """,
        *args,
    )

    n += 1
    limit_p = n
    args.append(page_size)
    n += 1
    offset_p = n
    args.append(offset)

    rows = await conn.fetch(
        f"""
        SELECT
            pr.id, pr.status, pr.amount, pr.currency,
            pr.beneficiary_name, pr.beneficiary_bank, pr.beneficiary_account,
            pr.payment_method, pr.description,
            pr.rejection_reason, pr.rejected_at, pr.rejected_by,
            pr.approved_by, pr.approved_at, pr.paid_at,
            pr.created_at, pr.updated_at,
            pr.sourcing_order_id, pr.requester_id, pr.requester_name,
            so.id            AS so_id,
            so.order_number  AS so_order_number,
            so.customer_name AS so_customer_name,
            so.total_value_vnd AS so_total_value_vnd,
            so.quote_pdf_url AS so_quote_pdf_url,
            so.status        AS so_status,
            u.full_name      AS requester_full_name,
            u.email          AS requester_email
          FROM payment_requests pr
          LEFT JOIN sourcing_orders so ON so.id = pr.sourcing_order_id
          LEFT JOIN users u ON u.id = pr.requester_id
         WHERE {where_sql}
         ORDER BY pr.{sort_field} {sort_dir}
         LIMIT ${limit_p} OFFSET ${offset_p}
        """,
        *args,
    )

    items: list[dict] = []
    for r in rows:
        d = _serialize_pr(r) or {}
        items.append({
            "id": d.get("id"),
            "status": d.get("status"),
            "amount": d.get("amount"),
            "currency": d.get("currency"),
            "beneficiary_name": d.get("beneficiary_name"),
            "beneficiary_bank": d.get("beneficiary_bank"),
            "beneficiary_account": d.get("beneficiary_account"),
            "payment_method": d.get("payment_method"),
            "description": d.get("description"),
            "rejection_reason": d.get("rejection_reason"),
            "rejected_at": d.get("rejected_at"),
            "approved_by": d.get("approved_by"),
            "approved_at": d.get("approved_at"),
            "paid_at": d.get("paid_at"),
            "created_at": d.get("created_at"),
            "sourcing_order": {
                "id": d.get("so_id"),
                "order_number": d.get("so_order_number"),
                "customer_name": d.get("so_customer_name"),
                "total_value_vnd": d.get("so_total_value_vnd"),
                "quote_pdf_url": d.get("so_quote_pdf_url"),
                "status": d.get("so_status"),
            } if d.get("so_id") else None,
            "requester": {
                "id": str(d.get("requester_id")) if d.get("requester_id") else None,
                "full_name": d.get("requester_full_name"),
                "email": d.get("requester_email"),
            },
        })

    return {
        "data": {
            "items": items,
            "total": int(total or 0),
            "page": page,
            "page_size": page_size,
        }
    }


# ── Detail ────────────────────────────────────────────────────────────────────


@router.get("/{pr_id}")
async def get_payment_request(
    pr_id: int,
    token_data: TokenData = Depends(require_role(
        "admin", "manager", "accountant", "director",
        "sales", "procurement", "staff",
    )),
    conn: asyncpg.Connection = Depends(get_db),
):
    pr = await conn.fetchrow(
        """
        SELECT pr.*,
               u.full_name AS requester_full_name, u.email AS requester_email
          FROM payment_requests pr
          LEFT JOIN users u ON u.id = pr.requester_id
         WHERE pr.id = $1
        """,
        pr_id,
    )
    if not pr:
        raise HTTPException(404, f"Không tìm thấy đề xuất TT #{pr_id}")

    actor_role = (token_data.role or "").lower()
    if (
        actor_role not in _PR_PRIVILEGED_ROLES
        and actor_role != "viewer"
        and str(pr["requester_id"]) != str(token_data.user_id)
    ):
        raise HTTPException(403, "Bạn không có quyền xem đề xuất TT này")

    so_row = None
    if pr["sourcing_order_id"]:
        so_row = await conn.fetchrow(
            """
            SELECT id, order_number, customer_name, customer_email,
                   customer_phone, total_value_vnd, quote_pdf_url, status,
                   line_items
              FROM sourcing_orders
             WHERE id = $1
            """,
            pr["sourcing_order_id"],
        )

    # History — prefer workflow_history when workflow_id is set; otherwise
    # surface sourcing_order_status_history filtered by metadata.payment_request_id.
    history: list[dict] = []
    if pr["workflow_id"]:
        try:
            hrows = await conn.fetch(
                """
                SELECT id, from_status, to_status, action, performed_by,
                       performed_at, note, metadata
                  FROM workflow_history
                 WHERE workflow_id = $1
                 ORDER BY performed_at ASC
                """,
                pr["workflow_id"],
            )
            history = [_serialize_pr(r) or {} for r in hrows]
        except Exception as exc:
            logger.debug("workflow_history fetch skipped: %s", exc)
    elif pr["sourcing_order_id"]:
        try:
            hrows = await conn.fetch(
                """
                SELECT id, from_status, status AS to_status,
                       by_user_id AS performed_by, created_at AS performed_at,
                       note, metadata
                  FROM sourcing_order_status_history
                 WHERE order_id = $1
                   AND (metadata->>'payment_request_id' = $2
                        OR metadata->>'payment_request_id' = $3)
                 ORDER BY created_at ASC
                """,
                pr["sourcing_order_id"],
                str(pr["id"]),
                str(pr["sourcing_order_id"]),  # legacy pseudo-id rows
            )
            history = [_serialize_pr(r) or {} for r in hrows]
        except Exception as exc:
            logger.debug("sourcing_order_status_history fetch skipped: %s", exc)

    data = _serialize_pr(pr) or {}
    data["sourcing_order"] = _serialize_pr(so_row) if so_row else None
    data["requester"] = {
        "id": str(data.get("requester_id")) if data.get("requester_id") else None,
        "full_name": data.pop("requester_full_name", None),
        "email": data.pop("requester_email", None),
    }
    data["history"] = history
    return {"data": data}


# ── Approve ───────────────────────────────────────────────────────────────────


@router.post("/{pr_id}/approve")
async def approve_payment_request(
    pr_id: int,
    body: PaymentApprovePayload,
    request: Request,
    token_data: TokenData = Depends(require_role("accountant", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Approve a pending PR. Drives sourcing_order: payment_requested → payment_approved.

    Idempotent: 409 if status != 'pending'.
    """
    # Defer import to avoid circular: sourcing.py imports nothing from us, but
    # we import from it.
    from app.api.v1.sourcing import _so_apply_status_transition

    async with conn.transaction():
        pr = await conn.fetchrow(
            "SELECT * FROM payment_requests WHERE id = $1 FOR UPDATE",
            pr_id,
        )
        if not pr:
            raise HTTPException(404, f"Không tìm thấy đề xuất TT #{pr_id}")
        if pr["status"] != "pending":
            raise HTTPException(
                409,
                {
                    "error": "INVALID_STATUS",
                    "message": f"Không thể duyệt — PR đang ở status '{pr['status']}'",
                    "current_status": pr["status"],
                },
            )

        note = (body.note or "").strip()
        new_notes = pr["notes"] or ""
        if note:
            new_notes = (new_notes + "\n" if new_notes else "") + f"[approve] {note}"

        await conn.execute(
            """
            UPDATE payment_requests
               SET status = 'approved',
                   approved_by = $1::uuid,
                   approved_at = NOW(),
                   notes = $2
             WHERE id = $3
            """,
            token_data.user_id, new_notes, pr_id,
        )

        # payment_requests has NO DB-level audit trigger (unlike
        # accounts_payable/accounts_receivable) — write the audit row
        # explicitly so every approve/reject/mark-paid transition is
        # traceable. Atomic with the UPDATE above (same outer transaction).
        await write_audit_log(
            conn=conn,
            token_data=token_data,
            action="UPDATE",
            table_name="payment_requests",
            record_id=pr_id,
            old_data=dict(pr),
            new_data={
                **dict(pr),
                "status": "approved",
                "approved_by": str(token_data.user_id),
                "notes": new_notes,
            },
            request=request,
        )

        # Drive linked sourcing_order to payment_approved
        so_id = pr["sourcing_order_id"]
        so_row = None
        if so_id:
            so_row = await conn.fetchrow(
                "SELECT id, order_number, customer_name, status, total_value_vnd, "
                "       created_by_email, assigned_to "
                "  FROM sourcing_orders WHERE id = $1 FOR UPDATE",
                so_id,
            )
            if so_row and so_row["status"] == "payment_requested":
                await _so_apply_status_transition(
                    conn,
                    order_id=so_id,
                    from_status="payment_requested",
                    to_status="payment_approved",
                    actor_user_id=token_data.user_id,
                    actor_email=token_data.email,
                    note=f"Đã duyệt TT: {note}" if note else "Đã duyệt TT",
                    metadata={
                        "payment_request_id": pr_id,
                        "action": "payment_approved",
                    },
                )

                # ================================================================
                # === PHASE 3 BEHAVIOR-CHANGE (auto-AR) — requires owner       ===
                # === sign-off before enabling.                                ===
                # ================================================================
                # When PHASE3_AUTO_AR_ENABLED is TRUE, approving a payment
                # request auto-creates the accounts_receivable (công nợ) row for
                # the linked sourcing order and advances the revenue_chain.
                #
                # GATED default-OFF (app.core.config.settings.PHASE3_AUTO_AR_ENABLED,
                # env var PHASE3_AUTO_AR_ENABLED). With the flag FALSE this entire
                # block is skipped, so deploying the code does NOT change any
                # financial behavior. Every line below only runs once Thang
                # flips the flag on.  ⚠️ OWNER REVIEW REQUIRED.
                #
                # All writes happen inside the SAME `async with conn.transaction()`
                # opened above, so the AR row + domain_event + chain advance
                # commit atomically with the PR approval — or all roll back.
                from app.core.config import settings  # local import: avoid cycle

                # Resolve the flag: app_config 'phase3_auto_ar_enabled' is an
                # INSTANT runtime kill-switch (no redeploy) that overrides the
                # env/settings default. Read inside a SAVEPOINT so a config-read
                # error can NEVER poison/abort the accountant's approval txn.
                _auto_ar_on = settings.PHASE3_AUTO_AR_ENABLED
                try:
                    async with conn.transaction():  # savepoint isolates the read
                        _ov = await conn.fetchval(
                            "SELECT value::text FROM app_config WHERE key = 'phase3_auto_ar_enabled'"
                        )
                    if _ov is not None:
                        _auto_ar_on = _ov.strip().strip('"').lower() in ("true", "1", "yes")
                except Exception:  # noqa: BLE001 — never block approval on a config read
                    pass

                if _auto_ar_on:  # ⚠️ BEHAVIOR-CHANGE GUARD (env default OR app_config)
                    from app.services import chain_service

                    # BEST-EFFORT: the auto-AR hook must NEVER abort or roll back
                    # the accountant's payment approval. The chain/AR/event writes
                    # below run in a NESTED `async with conn.transaction()`
                    # (savepoint) wrapped in try/except. If anything fails we log a
                    # WARNING and let the OUTER transaction (PR approval + SO
                    # transition + notification) commit normally.
                    #
                    # The savepoint is load-bearing: a bare try/except that only
                    # logs is NOT enough. The outer `async with conn.transaction()`
                    # opened above means any in-statement error marks the WHOLE
                    # transaction aborted in asyncpg — every subsequent statement
                    # (notifications INSERT, final fetchrow) would then raise
                    # InFailedSQLTransactionError and still break the approval. The
                    # nested transaction rolls back ONLY the auto-AR writes and
                    # leaves the outer transaction clean and usable.
                    try:
                        async with conn.transaction():  # savepoint — auto-AR only
                            # 1) Ensure the deal has a chain_code (creates
                            #    revenue_chain row stage='so' on first touch).
                            #    ⚠️ BEHAVIOR-CHANGE
                            chain_code = await chain_service.ensure_chain_for_order(
                                conn,
                                so_id,
                                revenue_vnd=so_row["total_value_vnd"],
                                created_by=token_data.user_id,
                            )
                            # 2) Auto công nợ — idempotent via uq_ar_sourcing_order.
                            #    ⚠️ BEHAVIOR-CHANGE: writes accounts_receivable.
                            ar_id = await chain_service.ensure_ar_for_order(
                                conn,
                                so_id,
                                payment_request_id=pr_id,
                                chain_code=chain_code,
                                created_by=token_data.user_id,
                            )
                            # 3) Append-only audit event.  ⚠️ BEHAVIOR-CHANGE (additive).
                            await chain_service.emit_event(
                                conn,
                                event_type="payment.approved",
                                aggregate_type="sourcing_order",
                                aggregate_id=so_id,
                                payload={
                                    "payment_request_id": pr_id,
                                    "ar_id": ar_id,
                                    "amount_vnd": float(so_row["total_value_vnd"] or 0),
                                },
                                chain_code=chain_code,
                                created_by=token_data.user_id,
                            )
                            # 4) Advance the spine (monotonic; sets ar_id + statuses).
                            #    ⚠️ BEHAVIOR-CHANGE: mutates revenue_chain.
                            await chain_service.advance_chain(
                                conn,
                                chain_code,
                                "order.payment_approved",
                                {
                                    "ar_id": ar_id,
                                    "so_status": "payment_approved",
                                    "payment_status": "pending",
                                    "revenue_vnd": so_row["total_value_vnd"],
                                },
                            )
                    except Exception as exc:
                        # W3-06 — NEVER swallow: the auto-AR SAVEPOINT above has
                        # already rolled back (so the accountant's approval + SO
                        # transition still commit), but the công-nợ row the deal
                        # needed is now MISSING. Log at ERROR *and* bell-notify
                        # every admin so a human creates the AR by hand instead of
                        # the gap dying silently in the log. The notify runs in its
                        # OWN savepoint (inside chain_service) so it can't poison
                        # the still-open outer approval transaction.
                        logger.error(
                            "Phase3 auto-AR hook failed for SO %s / PR %s: %s",
                            so_id, pr_id, exc, exc_info=True,
                        )
                        await chain_service.notify_admins_hook_failure(
                            conn,
                            hook="auto-AR",
                            ref_type="payment_request",
                            ref_id=pr_id,
                            error=f"SO {so_id} / PR {pr_id}: {exc}",
                            link="/finance/reconcile",
                        )
                # ============ END PHASE 3 BEHAVIOR-CHANGE BLOCK ===============

        # If paid_immediately, also flip to paid in same transaction
        if body.paid_immediately:
            await conn.execute(
                "UPDATE payment_requests SET status = 'paid', paid_at = NOW() WHERE id = $1",
                pr_id,
            )
            await write_audit_log(
                conn=conn,
                token_data=token_data,
                action="UPDATE",
                table_name="payment_requests",
                record_id=pr_id,
                old_data={"status": "approved"},
                new_data={"status": "paid", "paid_immediately": True},
                request=request,
            )

        # ── Side effects (out-of-band) ──
        approver = await conn.fetchrow(
            "SELECT full_name FROM users WHERE id = $1::uuid",
            token_data.user_id,
        )

    if so_row:
        try:
            await conn.execute(
                """
                INSERT INTO notifications
                  (recipient_id, type, title, body, ref_type, ref_id, metadata)
                VALUES ($1::uuid, 'workflow_approved', $2, $3,
                        'payment_request', $4, $5::jsonb)
                """,
                str(pr["requester_id"]),
                f"TT đã duyệt: {so_row['order_number']}",
                f"Kế toán {approver['full_name'] if approver else token_data.email} đã duyệt",
                pr_id,
                json.dumps({"order_id": so_row["id"], "payment_request_id": pr_id}),
            )
        except Exception as exc:
            logger.warning("approve in-app notif insert failed: %s", exc)

    fresh = await conn.fetchrow(
        "SELECT id, status, approved_by, approved_at, paid_at FROM payment_requests WHERE id = $1",
        pr_id,
    )
    fresh_d = _serialize_pr(fresh) or {}
    fresh_d["sourcing_order"] = {
        "id": so_row["id"] if so_row else None,
        "status": "payment_approved" if so_row else None,
    }
    return {"data": fresh_d, "message": "Đã duyệt đề xuất thanh toán"}


# ── Reject ────────────────────────────────────────────────────────────────────


@router.post("/{pr_id}/reject")
async def reject_payment_request(
    pr_id: int,
    body: PaymentRejectPayload,
    request: Request,
    token_data: TokenData = Depends(require_role("accountant", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Reject a pending PR. Drives sourcing_order: payment_requested → confirmed (reverse).

    This allows sales/procurement to edit and re-submit. The rejected PR row
    remains; the next /sourcing/orders/{id}/payment-request call creates a
    new PR row (active PR lookup uses status IN ('pending','approved','paid')).
    """
    from app.api.v1.sourcing import _so_apply_status_transition

    note = body.note.strip()
    reason = body.reason
    reason_label = REJECT_REASON_LABELS_VI.get(reason, reason)

    async with conn.transaction():
        pr = await conn.fetchrow(
            "SELECT * FROM payment_requests WHERE id = $1 FOR UPDATE",
            pr_id,
        )
        if not pr:
            raise HTTPException(404, f"Không tìm thấy đề xuất TT #{pr_id}")
        if pr["status"] != "pending":
            raise HTTPException(
                409,
                {
                    "error": "INVALID_STATUS",
                    "message": f"Không thể từ chối — PR đang ở status '{pr['status']}'",
                    "current_status": pr["status"],
                },
            )

        await conn.execute(
            """
            UPDATE payment_requests
               SET status           = 'rejected',
                   rejected_by      = $1::uuid,
                   rejected_at      = NOW(),
                   rejection_reason = $2
             WHERE id = $3
            """,
            token_data.user_id,
            f"{reason}: {note}",
            pr_id,
        )

        await write_audit_log(
            conn=conn,
            token_data=token_data,
            action="UPDATE",
            table_name="payment_requests",
            record_id=pr_id,
            old_data=dict(pr),
            new_data={
                **dict(pr),
                "status": "rejected",
                "rejected_by": str(token_data.user_id),
                "rejection_reason": f"{reason}: {note}",
            },
            request=request,
        )

        so_id = pr["sourcing_order_id"]
        so_row = None
        if so_id:
            so_row = await conn.fetchrow(
                "SELECT id, order_number, status FROM sourcing_orders "
                "WHERE id = $1 FOR UPDATE",
                so_id,
            )
            if so_row and so_row["status"] == "payment_requested":
                await _so_apply_status_transition(
                    conn,
                    order_id=so_id,
                    from_status="payment_requested",
                    to_status="confirmed",
                    actor_user_id=token_data.user_id,
                    actor_email=token_data.email,
                    note=f"TT bị từ chối ({reason_label}): {note}",
                    metadata={
                        "payment_request_id": pr_id,
                        "action": "payment_rejected",
                        "reject_reason": reason,
                        "reject_note": note,
                    },
                )

        rejector = await conn.fetchrow(
            "SELECT full_name FROM users WHERE id = $1::uuid",
            token_data.user_id,
        )

    if so_row:
        rejector_name = (rejector["full_name"] if rejector else token_data.email) or "kế toán"
        try:
            await conn.execute(
                """
                INSERT INTO notifications
                  (recipient_id, type, title, body, ref_type, ref_id, metadata)
                VALUES ($1::uuid, 'workflow_rejected', $2, $3,
                        'payment_request', $4, $5::jsonb)
                """,
                str(pr["requester_id"]),
                f"TT bị từ chối: {so_row['order_number']}",
                f"{rejector_name} đã từ chối. Lý do: {reason_label}. {note}",
                pr_id,
                json.dumps({
                    "order_id": so_row["id"],
                    "payment_request_id": pr_id,
                    "reject_reason": reason,
                }),
            )
        except Exception as exc:
            logger.warning("reject in-app notif insert failed: %s", exc)

    return {
        "data": {
            "id": pr_id,
            "status": "rejected",
            "rejected_by": str(token_data.user_id),
            "rejection_reason": f"{reason}: {note}",
            "sourcing_order": {
                "id": so_row["id"] if so_row else None,
                "status": "confirmed" if so_row else None,
            },
        },
        "message": "Đã từ chối đề xuất thanh toán",
    }


# ── Mark paid ────────────────────────────────────────────────────────────────


@router.post("/{pr_id}/mark-paid")
async def mark_payment_request_paid(
    pr_id: int,
    body: PaymentMarkPaidPayload,
    request: Request,
    token_data: TokenData = Depends(require_role("accountant", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Flip an approved PR to paid. Does NOT change sourcing_order status."""
    async with conn.transaction():
        pr = await conn.fetchrow(
            "SELECT pr.*, so.order_number, so.id AS so_id "
            "  FROM payment_requests pr "
            "  LEFT JOIN sourcing_orders so ON so.id = pr.sourcing_order_id "
            " WHERE pr.id = $1 FOR UPDATE OF pr",
            pr_id,
        )
        if not pr:
            raise HTTPException(404, f"Không tìm thấy đề xuất TT #{pr_id}")
        if pr["status"] != "approved":
            raise HTTPException(
                409,
                {
                    "error": "INVALID_STATUS",
                    "message": f"Chỉ PR ở status 'approved' mới chuyển sang 'paid' được (hiện: {pr['status']})",
                    "current_status": pr["status"],
                },
            )

        paid_at = body.paid_at or datetime.now(timezone.utc)
        meta = dict(pr["metadata"] or {}) if not isinstance(pr["metadata"], str) else {}
        if isinstance(pr["metadata"], str):
            try:
                meta = json.loads(pr["metadata"])
            except Exception:
                meta = {}
        if body.payment_proof_url:
            meta["payment_proof_url"] = body.payment_proof_url
        if body.note:
            meta["mark_paid_note"] = body.note

        await conn.execute(
            """
            UPDATE payment_requests
               SET status   = 'paid',
                   paid_at  = $1::timestamptz,
                   metadata = $2::jsonb
             WHERE id = $3
            """,
            paid_at, json.dumps(meta), pr_id,
        )

        # `pr` came back from a JOIN with sourcing_orders (order_number/so_id) —
        # strip those before snapshotting so old/new_data only reflect the
        # payment_requests row itself, not the joined columns.
        pr_only = {k: v for k, v in dict(pr).items() if k not in ("order_number", "so_id")}
        await write_audit_log(
            conn=conn,
            token_data=token_data,
            action="UPDATE",
            table_name="payment_requests",
            record_id=pr_id,
            old_data=pr_only,
            new_data={
                **pr_only,
                "status": "paid",
                "paid_at": paid_at,
                "metadata": meta,
            },
            request=request,
        )

    # In-app notif for paid is already covered via /notifications subscribers;
    # the existing `notifications` insert fan-out happens in approve/reject
    # only. Mark-paid intentionally keeps logs lean.

    return {
        "data": {
            "id": pr_id,
            "status": "paid",
            "paid_at": paid_at.isoformat(),
        },
        "message": "Đã ghi nhận chuyển khoản",
    }
