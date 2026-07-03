"""Phase 3 — Revenue-chain service (event spine + auto công nợ helpers).

This module centralizes the WRITE-side helpers for the Phase-3 integration
spine that links Đơn (sourcing_orders) ↔ PO ↔ Giao hàng (bqms_deliveries) ↔
Tài chính (accounts_receivable), recording progress on the existing
`revenue_chain` row and an append-only audit trail in `domain_events`.

Design notes
------------
* REUSES the existing tables created in `phase2_revenue_chain.sql`
  (`revenue_chain`, `domain_events`) and `init_v3.sql` (`accounts_receivable`).
  Nothing here creates schema — see `migrations/phase3_chain_activation.sql`
  for the additive columns these helpers depend on.
* Chain-code format matches the legacy generator in
  `app/tasks/revenue_chain.py`: ``RC-YYYYMM-NNNNNN``.
* All helpers take an *open* asyncpg connection and MUST be called inside an
  ``async with conn.transaction():`` block by the caller so the writes commit
  atomically with the surrounding business mutation. They never open their own
  transaction.
* ``ensure_ar_for_order`` is idempotent via the partial unique index
  ``uq_ar_sourcing_order`` (``ON CONFLICT DO NOTHING``) — calling it twice for
  the same order is a no-op.

⚠️ These helpers only WRITE financial rows (accounts_receivable) when the
   caller invokes them. The auto-AR caller in `payment_requests.py` is gated
   behind the ``PHASE3_AUTO_AR_ENABLED`` flag (default FALSE), so importing /
   shipping this module does not, on its own, change financial behavior.
"""

import json
import logging
import re
from datetime import date, timedelta
from typing import Any

import asyncpg

logger = logging.getLogger(__name__)

# Ordered chain stages — mirrors revenue_chain.current_stage CHECK constraint
# (phase2_revenue_chain.sql:384). ``advance_chain`` only moves FORWARD through
# this list (monotonic), so a late/duplicate event can never regress the stage.
_STAGE_ORDER: list[str] = [
    "rfq",
    "quotation",
    "so",
    "supplier_quote",
    "po",
    "shipment",
    "invoice",
    "payment",
    "completed",
]
_STAGE_RANK: dict[str, int] = {s: i for i, s in enumerate(_STAGE_ORDER)}

# Event-name → target chain stage. Used by advance_chain to translate a
# business event into the spine stage it should (monotonically) reach.
_EVENT_STAGE: dict[str, str] = {
    "order.created":           "so",
    "order.confirmed":         "so",
    "order.payment_requested": "so",
    "order.payment_approved":  "payment",
    "po.created":              "po",
    "delivery.delivered":      "shipment",
    "invoice.issued":          "invoice",
    "payment.received":        "completed",
}

_DEFAULT_PAYMENT_TERM_DAYS = 30


# ─────────────────────────────────────────────────────────────────────────────
# Chain code
# ─────────────────────────────────────────────────────────────────────────────
async def gen_chain_code(conn: asyncpg.Connection) -> str:
    """Generate a new ``RC-YYYYMM-NNNNNN`` chain code.

    Reuses the legacy format from app/tasks/revenue_chain.py. The numeric
    suffix is drawn atomically from the dedicated Postgres sequence
    ``revenue_chain_code_seq`` (created by the T4 migration
    ``phase3_chain_code_seq.sql`` and seeded past existing rows). ``nextval`` is
    atomic, so two parallel approvals always receive distinct codes — this is the
    concurrency-safe replacement for the old ``SELECT MAX(id)+1`` body, which
    could hand identical suffixes to simultaneous transactions and cross-link
    chains.

    The collision-probe loop is kept as a belt-and-suspenders guard against
    pre-sequence legacy ``RC-`` codes whose suffix may overlap a freshly drawn
    value; on collision it draws *another* ``nextval`` (never ``+= 1``) so the
    sequence remains the single source of truth.

    NOTE: this does NOT create the sequence — that is the T4 migration's job. If
    the sequence is absent (un-migrated DB), ``nextval`` raises. This path only
    runs under ``PHASE3_AUTO_AR_ENABLED=True`` (currently False), so no
    un-migrated runtime path is exercised. As a defensive fallback we degrade to
    the legacy ``MAX(id)+1`` probe so an accidental call on an un-migrated DB
    still yields a usable (best-effort) code rather than hard-failing.
    """
    today = date.today()
    prefix = f"RC-{today.strftime('%Y%m')}-"

    async def _next_seq() -> int | None:
        try:
            return int(await conn.fetchval("SELECT nextval('revenue_chain_code_seq')"))
        except asyncpg.PostgresError as exc:
            # Un-migrated DB (sequence missing) — degrade to legacy MAX(id)+1.
            logger.warning(
                "gen_chain_code: revenue_chain_code_seq unavailable (%s); "
                "falling back to MAX(id)+1 — run phase3_chain_code_seq.sql",
                exc,
            )
            return None

    seq = await _next_seq()
    if seq is None:
        # Legacy fallback (un-migrated DB): MAX(id)+1 with the probe loop below.
        seq = int(await conn.fetchval("SELECT COALESCE(MAX(id), 0) + 1 FROM revenue_chain"))
        legacy = True
    else:
        legacy = False

    candidate = f"{prefix}{int(seq):06d}"

    # Defensive collision guard (rare): legacy RC- codes may overlap a freshly
    # drawn suffix. Bump via another nextval (so the sequence stays canonical),
    # or via +1 only in the un-migrated legacy fallback.
    for _ in range(50):
        exists = await conn.fetchval(
            "SELECT 1 FROM revenue_chain WHERE chain_code = $1", candidate
        )
        if not exists:
            return candidate
        if legacy:
            seq += 1
        else:
            bumped = await _next_seq()
            seq = (seq + 1) if bumped is None else bumped
        candidate = f"{prefix}{int(seq):06d}"
    # Extremely unlikely — return the last candidate.
    return candidate


async def ensure_chain_for_order(
    conn: asyncpg.Connection,
    sourcing_order_id: int,
    *,
    revenue_vnd: Any = None,
    created_by: Any = None,
) -> str:
    """Return the chain_code for a sourcing order, creating the chain if absent.

    Idempotent: if the order already carries a chain_code it is returned as-is.
    Otherwise a new revenue_chain row is created (stage ``so``) and the code is
    stamped back onto sourcing_orders.chain_code.
    """
    existing = await conn.fetchval(
        "SELECT chain_code FROM sourcing_orders WHERE id = $1", sourcing_order_id
    )
    if existing:
        return existing

    chain_code = await gen_chain_code(conn)
    await conn.execute(
        """
        INSERT INTO revenue_chain
            (chain_code, so_status, current_stage, revenue_vnd, created_by)
        VALUES ($1, 'order', 'so', $2, $3::uuid)
        ON CONFLICT (chain_code) DO NOTHING
        """,
        chain_code,
        revenue_vnd,
        str(created_by) if created_by else None,
    )
    await conn.execute(
        "UPDATE sourcing_orders SET chain_code = $1 WHERE id = $2 AND chain_code IS NULL",
        chain_code,
        sourcing_order_id,
    )
    return chain_code


# ─────────────────────────────────────────────────────────────────────────────
# Chain advancement (monotonic, idempotent)
# ─────────────────────────────────────────────────────────────────────────────
async def advance_chain(
    conn: asyncpg.Connection,
    chain_code: str,
    event: str,
    fields: dict | None = None,
) -> None:
    """Advance the revenue_chain row for ``chain_code`` in response to ``event``.

    * Stage only moves FORWARD (monotonic by _STAGE_RANK) — a stale or replayed
      event never regresses the chain, making this safe to call idempotently.
    * ``fields`` are extra columns to set on revenue_chain (e.g.
      {'ar_id': 5, 'so_status': 'payment_approved', 'payment_status': 'pending'}).
      Only a known allow-list of columns is written.
    * No-op (logs a debug line) if the chain row does not exist.
    """
    if not chain_code:
        return

    row = await conn.fetchrow(
        "SELECT id, current_stage FROM revenue_chain WHERE chain_code = $1",
        chain_code,
    )
    if not row:
        logger.debug("advance_chain: no revenue_chain for %s (event=%s)", chain_code, event)
        return

    target_stage = _EVENT_STAGE.get(event)
    cur_rank = _STAGE_RANK.get(row["current_stage"] or "rfq", 0)
    new_stage = row["current_stage"]
    if target_stage and _STAGE_RANK.get(target_stage, 0) > cur_rank:
        new_stage = target_stage

    is_complete = new_stage == "completed"

    # Allow-list of revenue_chain columns the caller may set via ``fields``.
    allowed = {
        "rfq_id", "sales_order_id", "supplier_quote_id", "po_id", "shipment_id",
        "invoice_id", "ar_id", "ap_id",
        "rfq_status", "so_status", "quote_status", "po_status",
        "shipment_status", "invoice_status", "payment_status",
        "revenue_vnd", "cogs_vnd", "margin_pct",
    }
    set_parts = ["current_stage = $2", "is_complete = $3", "updated_at = NOW()"]
    params: list[Any] = [chain_code, new_stage, is_complete]
    idx = 4
    for key, val in (fields or {}).items():
        if key not in allowed:
            continue
        set_parts.append(f"{key} = ${idx}")
        params.append(val)
        idx += 1
    if is_complete:
        set_parts.append("completed_at = COALESCE(completed_at, NOW())")

    await conn.execute(
        f"UPDATE revenue_chain SET {', '.join(set_parts)} WHERE chain_code = $1",
        *params,
    )


# ─────────────────────────────────────────────────────────────────────────────
# domain_events audit trail
# ─────────────────────────────────────────────────────────────────────────────
async def emit_event(
    conn: asyncpg.Connection,
    event_type: str,
    aggregate_type: str,
    aggregate_id: Any,
    payload: dict | None = None,
    chain_code: str | None = None,
    created_by: Any = None,
) -> None:
    """Append a row to domain_events (append-only audit trail).

    Mirrors the INSERT shape used by invoice_management.py / shipment_tracking.py
    so the events show up in the existing chain timeline endpoints.
    """
    await conn.execute(
        """
        INSERT INTO domain_events
            (event_type, aggregate_type, aggregate_id, payload, chain_code, created_by)
        VALUES ($1, $2, $3, $4::jsonb, $5, $6::uuid)
        """,
        event_type,
        aggregate_type,
        str(aggregate_id),
        json.dumps(payload or {}),
        chain_code,
        str(created_by) if created_by else None,
    )


# ─────────────────────────────────────────────────────────────────────────────
# Auto công nợ (Accounts Receivable)
# ─────────────────────────────────────────────────────────────────────────────
def _parse_term_days(payment_terms: str | None) -> int:
    """Best-effort parse of a free-text payment_terms string into net-days.

    Handles common VN/EN forms: 'Net 30', 'NET30', '30 ngày', '45 days',
    'TT trong 60 ngày'. Falls back to _DEFAULT_PAYMENT_TERM_DAYS when no
    number is found.
    """
    if not payment_terms:
        return _DEFAULT_PAYMENT_TERM_DAYS
    m = re.search(r"(\d{1,3})", str(payment_terms))
    if not m:
        return _DEFAULT_PAYMENT_TERM_DAYS
    try:
        days = int(m.group(1))
    except (TypeError, ValueError):
        return _DEFAULT_PAYMENT_TERM_DAYS
    # Clamp to a sane range so a stray big number doesn't push due_date wild.
    return max(0, min(days, 365)) if days else _DEFAULT_PAYMENT_TERM_DAYS


async def ensure_ar_for_order(
    conn: asyncpg.Connection,
    sourcing_order_id: int,
    *,
    payment_request_id: int | None = None,
    chain_code: str | None = None,
    created_by: Any = None,
) -> int | None:
    """Idempotently create an accounts_receivable row for a sourcing order.

    Returns the AR id (existing or newly created), or None when an AR cannot be
    created (e.g. order has no resolvable customer_id — AR.customer_id is NOT
    NULL). Idempotency is enforced by the partial unique index
    ``uq_ar_sourcing_order`` plus an explicit pre-check.

    Fields written:
      customer_id        ← sourcing_orders.customer_id
      amount             ← sourcing_orders.total_value_vnd
      currency           ← sourcing_orders.currency (default VND)
      invoice_date       ← sourcing_orders.order_date (or today)
      due_date           ← invoice_date + parse(payment_terms) days
      status             ← 'pending'
      sourcing_order_id / payment_request_id / chain_code (Phase-3 links)
    """
    # Already linked? (fast idempotency path)
    existing = await conn.fetchval(
        "SELECT id FROM accounts_receivable WHERE sourcing_order_id = $1",
        sourcing_order_id,
    )
    if existing:
        return existing

    so = await conn.fetchrow(
        """
        SELECT id, customer_id, customer_name, order_date, payment_terms,
               total_value_vnd, currency, order_number, chain_code
          FROM sourcing_orders
         WHERE id = $1
        """,
        sourcing_order_id,
    )
    if not so:
        logger.warning("ensure_ar_for_order: sourcing_order %s not found", sourcing_order_id)
        return None

    if so["customer_id"] is None:
        # accounts_receivable.customer_id is NOT NULL — we cannot create an AR
        # without a real customer. Skip gracefully (caller still records the
        # event); a later backfill can attach AR once the customer is linked.
        # Logged at WARNING (owner decision) so the gap — a chain advanced to
        # 'payment' with NO công nợ row — surfaces as a visible flag and the
        # T4 backfill PRECHECK can count it.
        logger.warning(
            "ensure_ar_for_order: order %s payment_approved but has no "
            "customer_id — AR SKIPPED, will be attached by backfill once "
            "customer linked",
            sourcing_order_id,
        )
        return None

    order_date: date = so["order_date"] or date.today()
    due_date = order_date + timedelta(days=_parse_term_days(so["payment_terms"]))
    currency = (so["currency"] or "VND")
    chain = chain_code or so["chain_code"]

    # Resolve a created_by uuid — accounts_receivable.created_by is NOT NULL.
    creator = str(created_by) if created_by else None
    if creator is None:
        creator = await conn.fetchval(
            "SELECT id::text FROM users WHERE role::text = 'admin' LIMIT 1"
        )

    ar_id = await conn.fetchval(
        """
        INSERT INTO accounts_receivable
            (customer_id, sourcing_order_id, payment_request_id, chain_code,
             invoice_date, due_date, amount, currency, paid_amount, status,
             notes, created_by)
        VALUES ($1, $2, $3, $4,
                $5, $6, $7, $8::currency_code, 0, 'pending',
                $9, $10::uuid)
        ON CONFLICT (sourcing_order_id) WHERE sourcing_order_id IS NOT NULL
        DO NOTHING
        RETURNING id
        """,
        so["customer_id"],
        sourcing_order_id,
        payment_request_id,
        chain,
        order_date,
        due_date,
        so["total_value_vnd"] or 0,
        currency,
        f"Auto-AR từ đơn {so['order_number']}",
        creator,
    )

    if ar_id is None:
        # Lost the race / already existed — re-read.
        ar_id = await conn.fetchval(
            "SELECT id FROM accounts_receivable WHERE sourcing_order_id = $1",
            sourcing_order_id,
        )
        return ar_id

    # Back-link the order to its AR row.
    await conn.execute(
        "UPDATE sourcing_orders SET accounts_receivable_id = $1 WHERE id = $2",
        ar_id,
        sourcing_order_id,
    )
    return ar_id


async def ensure_ap_for_po(
    conn: asyncpg.Connection,
    po_id: int,
    *,
    chain_code: str | None = None,
    created_by: Any = None,
) -> int | None:
    """Idempotently create an accounts_payable row for a purchase order.

    STUB for Phase-3 rollout B-3 (AP supplier side). Kept idempotent and
    import-clean so the spine is symmetric; not yet wired to any auto-hook.
    Returns the AP id (existing or newly created) or None.

    Idempotency: a sequential pre-check (``SELECT id WHERE po_id``) makes a
    repeat call a no-op. We deliberately do NOT add ``ON CONFLICT (po_id)`` —
    accounts_payable has only the non-unique index ``idx_ap_po`` (init_v3.sql),
    and the schema permits MULTIPLE AP rows per PO (hence ``ORDER BY id LIMIT 1``
    here), so there is no unique target for ON CONFLICT to match and adding one
    would silently no-op or 42P10-error.

    TODO(Phase-3 B-3): if this is promoted to an auto-hook driven by concurrent
    callers, add a partial unique index (e.g. ``uq_ap_po`` on po_id) in a
    migration FIRST, then switch this INSERT to
    ``ON CONFLICT (po_id) ... DO NOTHING`` + re-read on race — mirroring
    ``ensure_ar_for_order`` / ``uq_ar_sourcing_order``. Until then the pre-check
    is the only safe guard and a true concurrent double-insert is possible.
    """
    existing = await conn.fetchval(
        "SELECT id FROM accounts_payable WHERE po_id = $1 ORDER BY id LIMIT 1",
        po_id,
    )
    if existing:
        return existing

    po = await conn.fetchrow(
        """
        SELECT id, supplier_id, total_amount, currency, exchange_rate,
               order_date, expected_date, po_number, created_by
          FROM purchase_orders
         WHERE id = $1
        """,
        po_id,
    )
    if not po or po["supplier_id"] is None:
        return None

    invoice_date: date = po["order_date"] or date.today()
    due_date = po["expected_date"] or (invoice_date + timedelta(days=_DEFAULT_PAYMENT_TERM_DAYS))
    creator = str(created_by) if created_by else (
        str(po["created_by"]) if po["created_by"] else None
    )

    ap_id = await conn.fetchval(
        """
        INSERT INTO accounts_payable
            (supplier_id, po_id, invoice_date, due_date, amount, currency,
             exchange_rate, paid_amount, status, notes, created_by)
        VALUES ($1, $2, $3, $4, $5, $6::currency_code, $7, 0, 'pending', $8, $9::uuid)
        RETURNING id
        """,
        po["supplier_id"],
        po_id,
        invoice_date,
        due_date,
        po["total_amount"] or 0,
        po["currency"] or "USD",
        po["exchange_rate"],
        f"Auto-AP từ PO {po['po_number']}",
        creator,
    )
    return ap_id


# Currencies the procurement TEXT column may hold that map cleanly onto the
# ``currency_code`` enum. Anything else (or NULL) falls back to VND.
_AP_CURRENCY_WHITELIST = ("USD", "RMB", "VND")


async def ensure_ap_for_procurement_delivery(
    conn: asyncpg.Connection,
    delivery_id: int,
    *,
    created_by: Any = None,
) -> int | None:
    """Idempotently create one accounts_payable row for a procurement delivery.

    CANONICAL Phase-3 procurement AP helper (Đợt 5). Mirrors
    ``ensure_ar_for_order`` on the supplier side, but keyed on a *delivery*
    (one AP per ``procurement_delivery`` that reaches status='received'), with
    the AP amount = the value of THAT delivery only (Σ delivered_qty *
    po_item.unit_price), NOT the whole PO total. The procurement chain is
    STANDALONE — no revenue_chain / chain_code linkage; the AP is tied to its
    source via ``procurement_po_id`` + ``delivery_id`` + ``vendor_id``.

    Idempotency is enforced by the partial unique index
    ``uq_ap_procurement_delivery`` (``ON CONFLICT (delivery_id) DO NOTHING``)
    plus an explicit pre-check; calling twice for the same delivery returns the
    existing AP id.

    Returns the AP id (existing or newly created), or ``None`` on a graceful
    business-skip (delivery not 'received', vendor has no linked supplier_id,
    or a zero/NULL amount). It NEVER raises on a business-skip — only real DB
    errors propagate. This function does its OWN INSERT only; the runtime GATE
    (``PROCUREMENT_AUTO_AP_ENABLED`` + ``procurement_auto_ap_enabled`` app_config
    override) and the per-call savepoint wrapping are the CALLER hook's job.
    """
    # Already linked? (fast idempotency path)
    existing = await conn.fetchval(
        "SELECT id FROM accounts_payable WHERE delivery_id = $1",
        delivery_id,
    )
    if existing:
        return existing

    dlv = await conn.fetchrow(
        """
        SELECT id, po_id, vendor_id, received_at, status, delivery_no
          FROM procurement_deliveries
         WHERE id = $1
        """,
        delivery_id,
    )
    if not dlv:
        logger.warning(
            "ensure_ap_for_procurement_delivery: delivery %s not found", delivery_id
        )
        return None

    if dlv["status"] != "received":
        # Trigger fires only on the received transition; any other state is a
        # graceful no-op so callers can fire the hook defensively.
        logger.info(
            "ensure_ap_for_procurement_delivery: delivery %s status=%s (not "
            "'received') — AP skipped",
            delivery_id,
            dlv["status"],
        )
        return None

    # Resolve the supplier behind this vendor account. accounts_payable.supplier_id
    # is NOT NULL, so a vendor with no linked supplier means we MUST skip (mirror
    # the ensure_ar_for_order customer_id-null skip).
    supplier_id = None
    if dlv["vendor_id"] is not None:
        supplier_id = await conn.fetchval(
            "SELECT supplier_id FROM vendor_accounts WHERE id = $1",
            dlv["vendor_id"],
        )
    if supplier_id is None:
        logger.warning(
            "ensure_ap_for_procurement_delivery: delivery %s vendor_account %s "
            "has no linked supplier_id — AP SKIPPED (AP.supplier_id is NOT NULL)",
            delivery_id,
            dlv["vendor_id"],
        )
        return None

    # Amount = value of THIS delivery only: Σ over delivery items of
    # COALESCE(confirmed_qty, delivered_qty) * the matching po_item.unit_price.
    # Đợt 10 #4 (D3=A): nếu BUYER đã xác nhận số thực nhận (confirmed_qty) thì
    # owe theo số đó, else fallback delivered_qty (NCC khai). DORMANT — auto-AP
    # VẪN OFF (gated PROCUREMENT_AUTO_AP_ENABLED) → deploy KHÔNG đổi tài chính.
    # EXCLUDE lines whose quality_status='rejected' — we do not owe the vendor for
    # goods that failed QC. ok/minor_defect (and NULL legacy) are billed. If every
    # line is rejected the amount is NULL/0 → graceful skip below (no AP).
    amount = await conn.fetchval(
        """
        SELECT SUM(COALESCE(di.confirmed_qty, di.delivered_qty) * pi.unit_price)
          FROM procurement_delivery_items di
          JOIN procurement_po_items pi ON pi.id = di.po_item_id
         WHERE di.delivery_id = $1
           AND COALESCE(di.quality_status, 'ok') <> 'rejected'
        """,
        delivery_id,
    )
    if amount is None or amount <= 0:
        logger.info(
            "ensure_ap_for_procurement_delivery: delivery %s has NULL/zero "
            "amount (%s) — AP skipped",
            delivery_id,
            amount,
        )
        return None

    # Currency + payment terms come from the parent PO (and its contract).
    po = await conn.fetchrow(
        """
        SELECT po.currency,
               c.payment_terms AS contract_terms
          FROM procurement_pos po
          LEFT JOIN procurement_contracts c ON c.id = po.contract_id
         WHERE po.id = $1
        """,
        dlv["po_id"],
    )
    raw_currency = (po["currency"] if po else None) or "VND"
    currency = raw_currency.upper() if isinstance(raw_currency, str) else "VND"
    if currency not in _AP_CURRENCY_WHITELIST:
        currency = "VND"

    term_days = _parse_term_days(po["contract_terms"] if po else None)
    invoice_date: date = (
        dlv["received_at"].date() if dlv["received_at"] else date.today()
    )
    due_date = invoice_date + timedelta(days=term_days)

    # Resolve a created_by uuid — accounts_payable.created_by is NOT NULL.
    creator = str(created_by) if created_by else None
    if creator is None:
        creator = await conn.fetchval(
            "SELECT id::text FROM users WHERE role::text = 'admin' LIMIT 1"
        )

    ap_id = await conn.fetchval(
        """
        INSERT INTO accounts_payable
            (supplier_id, procurement_po_id, delivery_id, vendor_id,
             invoice_date, due_date, amount, currency, paid_amount, status,
             payment_terms, notes, created_by)
        VALUES ($1, $2, $3, $4,
                $5, $6, $7, $8::currency_code, 0, 'pending'::payment_status,
                $9, $10, $11::uuid)
        ON CONFLICT (delivery_id) WHERE delivery_id IS NOT NULL
        DO NOTHING
        RETURNING id
        """,
        supplier_id,
        dlv["po_id"],
        delivery_id,
        dlv["vendor_id"],
        invoice_date,
        due_date,
        amount,
        currency,
        str(term_days),
        f"Auto-AP từ giao hàng {dlv['delivery_no']}",
        creator,
    )

    if ap_id is None:
        # Lost the race / already existed — re-read.
        ap_id = await conn.fetchval(
            "SELECT id FROM accounts_payable WHERE delivery_id = $1",
            delivery_id,
        )
    return ap_id
