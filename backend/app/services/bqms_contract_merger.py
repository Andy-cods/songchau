"""Merge bqms_vendor_portal_staging WHERE module='contract' → bqms_contracts.

Per Thang 2026-05-12 (audit follow-up): Trúng BG ↔ Contract chưa có mapping
chính thức trong DB. Service này parse raw_json từ contract staging rows và
UPSERT vào dedicated bqms_contracts + bqms_contract_items, set FK đến
bqms_won_quotations qua match (rfq_number, bqms_code) và bqms_rfq qua rfq_number.

Idempotent — re-run safely.
"""
from __future__ import annotations

import json
import logging
import re
from datetime import datetime, date
from typing import Any

import asyncpg

logger = logging.getLogger(__name__)


_DATE_RX = re.compile(r"(\d{1,2})/(\d{1,2})/(\d{4})")


def _parse_period(period: str | None) -> tuple[date | None, date | None]:
    """Parse '5/11/2026 ~ 8/11/2026' → (start, end)."""
    if not period:
        return None, None
    matches = _DATE_RX.findall(period)
    if len(matches) < 2:
        return None, None

    def _to_date(m):
        mm, dd, yyyy = int(m[0]), int(m[1]), int(m[2])
        try:
            return date(yyyy, mm, dd)
        except ValueError:
            return None
    return _to_date(matches[0]), _to_date(matches[1])


def _parse_amount(s: str | None) -> float | None:
    """Parse '5,000,000' or '5,000,000 VND' → 5000000.0"""
    if not s:
        return None
    s = re.sub(r"[^\d.,]", "", str(s))
    s = s.replace(",", "")
    try:
        return float(s)
    except ValueError:
        return None


async def merge_contracts(conn: asyncpg.Connection) -> dict[str, int]:
    """Pull all module='contract' staging rows → upsert bqms_contracts.

    Returns stats: {scanned, inserted, updated, linked_won, errors}.
    """
    stats = {"scanned": 0, "inserted": 0, "updated": 0,
             "linked_won": 0, "linked_rfq": 0, "items_inserted": 0, "errors": 0}

    rows = await conn.fetch(
        """
        SELECT id, rfq_number, raw_json, created_at
        FROM bqms_vendor_portal_staging
        WHERE module = 'contract' AND raw_json IS NOT NULL
        ORDER BY id
        """,
    )

    for r in rows:
        stats["scanned"] += 1
        raw = r["raw_json"]
        if isinstance(raw, str):
            try:
                raw = json.loads(raw)
            except Exception:
                stats["errors"] += 1
                continue
        contract = raw.get("contract") or {}
        basic = contract.get("basic_info") or {}

        contract_no = (
            contract.get("contract_no")
            or basic.get("Contract No")
            or basic.get("contract_no")
        )
        if not contract_no:
            stats["errors"] += 1
            continue

        request_no = (
            contract.get("request_no")
            or basic.get("Request Number")
            or r["rfq_number"]
        )

        period = contract.get("period") or basic.get("Contract Period")
        start_d, end_d = _parse_period(period)
        amount = _parse_amount(contract.get("amount") or basic.get("Contract Amount"))
        currency = (contract.get("currency") or "VND").strip() or "VND"

        # Look up linked rows
        rfq_id = None
        won_quot_id = None
        if request_no:
            rfq_id = await conn.fetchval(
                "SELECT id FROM bqms_rfq WHERE rfq_number = $1 LIMIT 1",
                request_no,
            )
            won_quot_id = await conn.fetchval(
                "SELECT id FROM bqms_won_quotations WHERE rfq_number = $1 ORDER BY id DESC LIMIT 1",
                request_no,
            )
        if rfq_id:
            stats["linked_rfq"] += 1
        if won_quot_id:
            stats["linked_won"] += 1

        # UPSERT bqms_contracts
        existing_id = await conn.fetchval(
            "SELECT id FROM bqms_contracts WHERE contract_no = $1",
            contract_no,
        )

        params = (
            contract_no,
            request_no,
            contract.get("contract_kind") or basic.get("Type"),
            contract.get("contract_type"),
            contract.get("subject") or basic.get("Subject"),
            contract.get("status") or basic.get("Status"),
            amount,
            currency,
            period,
            start_d,
            end_d,
            basic.get("Vendor name"),
            contract.get("created_by") or basic.get("Created by"),
            basic.get("Reconciliation"),
            won_quot_id,
            rfq_id,
            json.dumps(raw, ensure_ascii=False, default=str),
        )

        if existing_id:
            await conn.execute(
                """
                UPDATE bqms_contracts SET
                    request_no=$2, contract_kind=$3, contract_type=$4,
                    subject=$5, status=$6, amount=$7, currency=$8,
                    contract_period=$9, contract_start=$10, contract_end=$11,
                    vendor_name=$12, created_by_samsung=$13, reconciliation=$14,
                    won_quotation_id=$15, rfq_id=$16, raw_data=$17::jsonb,
                    synced_at=NOW(), updated_at=NOW()
                WHERE contract_no=$1
                """,
                *params,
            )
            stats["updated"] += 1
            contract_id = existing_id
        else:
            contract_id = await conn.fetchval(
                """
                INSERT INTO bqms_contracts
                    (contract_no, request_no, contract_kind, contract_type,
                     subject, status, amount, currency, contract_period,
                     contract_start, contract_end, vendor_name,
                     created_by_samsung, reconciliation, won_quotation_id,
                     rfq_id, raw_data, synced_at)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,NOW())
                RETURNING id
                """,
                *params,
            )
            stats["inserted"] += 1

        # Items: replace existing
        await conn.execute("DELETE FROM bqms_contract_items WHERE contract_id=$1", contract_id)
        items = contract.get("items") or []
        for it in items:
            await conn.execute(
                """
                INSERT INTO bqms_contract_items
                    (contract_id, item_no, bqms_code, description, specification,
                     quantity, unit, unit_price, amount, currency)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                """,
                contract_id,
                str(it.get("no") or "").strip() or None,
                (it.get("item_code") or "").strip() or None,
                (it.get("description") or "").strip() or None,
                (it.get("specification") or "").strip() or None,
                _parse_amount(it.get("quantity")),
                (it.get("unit") or "").strip() or None,
                _parse_amount(it.get("unit_price")),
                _parse_amount(it.get("amount")),
                (it.get("currency") or currency).strip() or currency,
            )
            stats["items_inserted"] += 1

    logger.info("contract merger done: %s", stats)
    return stats
