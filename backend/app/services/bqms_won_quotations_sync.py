"""Bridge: bqms_vendor_portal_staging(module='contract') → bqms_won_quotations.

After `scrape_contracts` lands rows into staging with module='contract', this
service maps each staging row to `bqms_won_quotations` via UPSERT.

Mapping (Thang 2026-05-15 spec):
  - rfq_number ← basic_info.Request Number ‖ contract.request_no
  - bqms_code  ← item.item_code
  - description, specification, quantity, unit ← item.*
  - po_price   ← _to_number(item.unit_price)
  - po_deadline ← parse_end_date(basic_info.Contract Period or contract.period)
  - supplier_name ← basic_info.Supplier ‖ contract.created_by (fallback)
  - person_in_charge_name ← lookup bqms_rfq.person_in_charge_name by rfq_number
  - hs_code / goods_description / customs_char_count: NULL on insert
    (user-edited via UI; preserved via COALESCE on UPDATE)
  - notes: trace `'Auto from contract scrape staging_id=N'`
  - source_hash: SHA256 of (rfq, bqms_code, po_price, quantity, po_deadline)

UPSERT key: (rfq_number, bqms_code) — idx `uq_bwq_rfq_bqms`.

After successful UPSERT, marks staging.status='approved' so we don't reprocess.

Runs in parallel with Excel import — both paths UPSERT into same table; COALESCE
guards prevent overwrite of user-edited fields (hs_code, goods_description, etc.).
"""
from __future__ import annotations

import hashlib
import json
import logging
import re
from datetime import date, datetime

logger = logging.getLogger(__name__)

_UPSERT_SQL = """
INSERT INTO bqms_won_quotations (
    rfq_number, bqms_code, person_in_charge_name,
    description, specification, quantity, unit,
    po_price, po_deadline, supplier_name, notes,
    source_hash, synced_at
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW()
)
ON CONFLICT (rfq_number, bqms_code) DO UPDATE SET
    description = COALESCE(EXCLUDED.description, bqms_won_quotations.description),
    specification = COALESCE(EXCLUDED.specification, bqms_won_quotations.specification),
    quantity = COALESCE(EXCLUDED.quantity, bqms_won_quotations.quantity),
    unit = COALESCE(EXCLUDED.unit, bqms_won_quotations.unit),
    po_price = COALESCE(EXCLUDED.po_price, bqms_won_quotations.po_price),
    po_deadline = COALESCE(EXCLUDED.po_deadline, bqms_won_quotations.po_deadline),
    supplier_name = COALESCE(EXCLUDED.supplier_name, bqms_won_quotations.supplier_name),
    person_in_charge_name = COALESCE(
        NULLIF(bqms_won_quotations.person_in_charge_name, ''),
        EXCLUDED.person_in_charge_name
    ),
    hs_code = COALESCE(NULLIF(bqms_won_quotations.hs_code, ''), EXCLUDED.hs_code),
    goods_description = COALESCE(
        NULLIF(bqms_won_quotations.goods_description, ''),
        EXCLUDED.goods_description
    ),
    customs_char_count = COALESCE(
        bqms_won_quotations.customs_char_count,
        EXCLUDED.customs_char_count
    ),
    notes = COALESCE(NULLIF(bqms_won_quotations.notes, ''), EXCLUDED.notes),
    source_hash = EXCLUDED.source_hash,
    synced_at = NOW()
RETURNING (xmax = 0) AS inserted
"""

_DATE_RE_DASH = re.compile(r"(\d{4})-(\d{2})-(\d{2})")
_DATE_RE_SLASH = re.compile(r"(\d{1,2})/(\d{1,2})/(\d{4})")
_NUM_RE = re.compile(r"[^\d\.\-]")


def _parse_period_end(period: str | None) -> date | None:
    """Extract last date from a Contract Period string.

    Samsung returns M/D/YYYY format (Korean/US style), e.g. `'5/8/2026 ~ 8/8/2026'`
    meaning May 8, 2026 → August 8, 2026. Also handle ISO `YYYY-MM-DD` as fallback.
    Returns the END date (right side of ~).
    """
    if not period:
        return None
    # Try ISO YYYY-MM-DD first
    iso = _DATE_RE_DASH.findall(period)
    if iso:
        try:
            y, m, d = iso[-1]
            return date(int(y), int(m), int(d))
        except (ValueError, TypeError):
            pass
    # Then Samsung's M/D/YYYY
    slash = _DATE_RE_SLASH.findall(period)
    if slash:
        try:
            m, d, y = slash[-1]
            return date(int(y), int(m), int(d))
        except (ValueError, TypeError):
            pass
    return None


def _to_number(s) -> float | None:
    if s is None:
        return None
    raw = str(s).strip()
    if not raw:
        return None
    cleaned = _NUM_RE.sub("", raw.replace(",", ""))
    try:
        return float(cleaned) if cleaned else None
    except ValueError:
        return None


def _source_hash(*parts) -> str:
    s = "|".join(str(p) if p is not None else "" for p in parts)
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def _safe_str(v) -> str | None:
    if v is None:
        return None
    s = str(v).strip()
    return s or None


async def upsert_won_from_contract_staging(pool, limit: int | None = None) -> dict:
    """Read contract staging rows → UPSERT bqms_won_quotations.

    Args:
        pool: asyncpg pool
        limit: optional cap on rows to process this call

    Returns:
        {inserted, updated, skipped, errors, total_seen}
    """
    stats = {"inserted": 0, "updated": 0, "skipped": 0, "errors": 0, "total_seen": 0}

    async with pool.acquire() as conn:
        q = (
            "SELECT id, rfq_number, raw_json FROM bqms_vendor_portal_staging "
            "WHERE module = 'contract' AND status = 'pending_review' ORDER BY id"
        )
        if limit:
            q += f" LIMIT {int(limit)}"
        rows = await conn.fetch(q)

    stats["total_seen"] = len(rows)

    for r in rows:
        try:
            raw = r["raw_json"]
            if isinstance(raw, str):
                raw = json.loads(raw)
            item = raw.get("item") or {}
            contract = raw.get("contract") or {}
            basic = contract.get("basic_info") or {}

            rfq_number = _safe_str(
                basic.get("Request Number")
                or contract.get("request_no")
                or r["rfq_number"]
            )
            bqms_code = _safe_str(item.get("item_code"))
            if not rfq_number or not bqms_code:
                stats["skipped"] += 1
                continue

            po_price = _to_number(item.get("unit_price"))
            quantity = _to_number(item.get("quantity"))
            po_deadline = _parse_period_end(
                basic.get("Contract Period") or contract.get("period")
            )
            supplier = _safe_str(
                basic.get("Supplier")
                or contract.get("supplier_name")
                or contract.get("created_by")
            )

            # Lookup person_in_charge from bqms_rfq (user wants this from there
            # not Samsung's `created_by`)
            async with pool.acquire() as c:
                pic = await c.fetchval(
                    "SELECT person_in_charge_name FROM bqms_rfq "
                    "WHERE rfq_number=$1 LIMIT 1",
                    rfq_number,
                )

            sh = _source_hash(rfq_number, bqms_code, po_price, quantity, po_deadline)

            async with pool.acquire() as c:
                inserted = await c.fetchval(
                    _UPSERT_SQL,
                    rfq_number,
                    bqms_code,
                    _safe_str(pic),
                    _safe_str(item.get("description")),
                    _safe_str(item.get("specification")),
                    quantity,
                    _safe_str(item.get("unit")),
                    po_price,
                    po_deadline,
                    supplier,
                    f"Auto from contract scrape staging_id={r['id']}",
                    sh,
                )
                if inserted:
                    stats["inserted"] += 1
                else:
                    stats["updated"] += 1

                await c.execute(
                    "UPDATE bqms_vendor_portal_staging "
                    "SET status='approved', reviewed_at=NOW() WHERE id=$1",
                    r["id"],
                )
        except Exception as exc:
            stats["errors"] += 1
            logger.warning(
                "won_quotations bridge failed for staging_id=%s: %s",
                r["id"], str(exc)[:200],
            )

    logger.info("upsert_won_from_contract_staging done: %s", stats)
    return stats
