"""Bridge: bqms_vendor_portal_staging(module='po') → bqms_deliveries.

After `scrape_mro_po` lands rows into staging with module='po', this service
maps each row to `bqms_deliveries` via UPSERT.

Mapping (Thang 2026-05-15 spec):
  - po_number     ← PO_NO
  - shipping_no   ← PO_SEQ
  - bqms_code     ← ITEM_CODE
  - po_date       ← parse_date(PO_CONFIRM_DT)
  - quotation_no  ← REQ_NO
  - specification ← SPECIFICATION
  - quantity      ← _to_number(PO_QTY)
  - unit_price    ← _to_number(BUYING_PRICE)
  - amount        ← _to_number(BUYING_AMOUNT)
  - recipient_name      ← RECEIVER_NAME
  - receiving_warehouse ← DELIVERY_ADDRESS
  - expected_delivery_date ← parse_date(REQ_DELIVERY_DATE)
  - data_source ← 'samsung_scrape'

User-edit fields KHÔNG overwrite (per Thang 2026-05-15):
  - sev_type, buyer_email, buyer_phone, country_origin, delivery_method
  - delivery_status, delivery_date, actual_delivered_qty, actual_delivered_at
  - total_delivered_value_vnd, driver_id

UPSERT key: (po_number, shipping_no, bqms_code) — idx `uq_bqms_del_po_ship_bqms`.

Marks staging.status='approved' after successful UPSERT.
"""
from __future__ import annotations

import hashlib
import json
import logging
import re
from datetime import date, datetime

logger = logging.getLogger(__name__)

# UPSERT SQL — scrape ONLY sets columns it has data for. Existing values (esp.
# user-edited fields like delivery_status, country_origin, sev_type, etc.) are
# preserved via COALESCE(NULLIF(existing,''), EXCLUDED).
#
# Conflict key: (po_number, bqms_code) — matches live constraint
# `bqms_deliveries_po_bqms_unique`. PO_SEQ from Samsung stored in shipping_no
# as informational field only (not part of dedup key).
_UPSERT_SQL = """
INSERT INTO bqms_deliveries (
    po_number, shipping_no, bqms_code, po_date, quotation_no,
    specification, quantity, unit_price, amount,
    recipient_name, receiving_warehouse, expected_delivery_date,
    delivery_status, data_source, source_hash, synced_at
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
    COALESCE($13::delivery_status, 'chua_giao'),
    'samsung_scrape', $14, NOW()
)
ON CONFLICT (po_number, bqms_code) DO UPDATE SET
    shipping_no = COALESCE(NULLIF(bqms_deliveries.shipping_no, ''), EXCLUDED.shipping_no),
    po_date = COALESCE(EXCLUDED.po_date, bqms_deliveries.po_date),
    quotation_no = COALESCE(EXCLUDED.quotation_no, bqms_deliveries.quotation_no),
    specification = COALESCE(EXCLUDED.specification, bqms_deliveries.specification),
    quantity = COALESCE(EXCLUDED.quantity, bqms_deliveries.quantity),
    unit_price = COALESCE(EXCLUDED.unit_price, bqms_deliveries.unit_price),
    amount = COALESCE(EXCLUDED.amount, bqms_deliveries.amount),
    recipient_name = COALESCE(
        NULLIF(bqms_deliveries.recipient_name, ''), EXCLUDED.recipient_name
    ),
    receiving_warehouse = COALESCE(
        NULLIF(bqms_deliveries.receiving_warehouse, ''), EXCLUDED.receiving_warehouse
    ),
    expected_delivery_date = COALESCE(
        EXCLUDED.expected_delivery_date, bqms_deliveries.expected_delivery_date
    ),
    -- USER-EDIT FIELDS — never overwrite from scrape
    -- delivery_status, sev_type, buyer_email, buyer_phone, country_origin,
    -- delivery_method, delivery_date, actual_delivered_qty,
    -- total_delivered_value_vnd, driver_id: untouched
    source_hash = EXCLUDED.source_hash,
    synced_at = NOW(),
    updated_at = NOW()
RETURNING (xmax = 0) AS inserted
"""

_NUM_RE = re.compile(r"[^\d\.\-]")


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


def _parse_date(s) -> date | None:
    """Parse Samsung's date strings: YYYY-MM-DD, YYYYMMDD, DD/MM/YYYY, etc."""
    if s is None:
        return None
    raw = str(s).strip()
    if not raw:
        return None
    # Try common formats
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%Y%m%d", "%d/%m/%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(raw[:10] if fmt == "%Y-%m-%d" else raw, fmt).date()
        except ValueError:
            continue
    # Last resort: regex YYYY[-/]MM[-/]DD
    m = re.match(r"(\d{4})[-/]?(\d{2})[-/]?(\d{2})", raw)
    if m:
        try:
            return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except (ValueError, TypeError):
            pass
    return None


def _source_hash(*parts) -> str:
    s = "|".join(str(p) if p is not None else "" for p in parts)
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def _safe_str(v) -> str | None:
    if v is None:
        return None
    s = str(v).strip().replace("&gt;", ">")
    return s or None


async def upsert_deliveries_from_po_staging(pool, limit: int | None = None) -> dict:
    """Read po staging rows → UPSERT bqms_deliveries.

    Returns:
        {inserted, updated, skipped, errors, total_seen}
    """
    stats = {"inserted": 0, "updated": 0, "skipped": 0, "errors": 0, "total_seen": 0}

    async with pool.acquire() as conn:
        q = (
            "SELECT id, raw_json FROM bqms_vendor_portal_staging "
            "WHERE module = 'po' AND status = 'pending_review' ORDER BY id"
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

            po_number = _safe_str(raw.get("PO_NO"))
            shipping_no = _safe_str(raw.get("PO_SEQ")) or ""
            bqms_code = _safe_str(raw.get("ITEM_CODE"))
            if not po_number or not bqms_code:
                stats["skipped"] += 1
                continue

            quantity = _to_number(raw.get("PO_QTY"))
            unit_price = _to_number(raw.get("BUYING_PRICE"))
            amount = _to_number(raw.get("BUYING_AMOUNT"))
            po_date = _parse_date(raw.get("PO_CONFIRM_DT"))
            expected_delivery_date = _parse_date(raw.get("REQ_DELIVERY_DATE"))

            sh = _source_hash(
                po_number, shipping_no, bqms_code,
                quantity, amount, raw.get("PO_STATUS_NAME"),
            )

            async with pool.acquire() as c:
                inserted = await c.fetchval(
                    _UPSERT_SQL,
                    po_number,
                    shipping_no,
                    bqms_code,
                    po_date,
                    _safe_str(raw.get("REQ_NO")),
                    _safe_str(raw.get("SPECIFICATION")),
                    quantity,
                    unit_price,
                    amount,
                    _safe_str(raw.get("RECEIVER_NAME")),
                    _safe_str(raw.get("DELIVERY_ADDRESS")),
                    expected_delivery_date,
                    None,  # delivery_status — let DB default to 'chua_giao' on insert
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
                "deliveries bridge failed for staging_id=%s: %s",
                r["id"], str(exc)[:200],
            )

    logger.info("upsert_deliveries_from_po_staging done: %s", stats)
    return stats
