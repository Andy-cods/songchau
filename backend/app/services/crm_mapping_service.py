from __future__ import annotations

from typing import Any

import asyncpg


async def get_customer_aliases(
    conn: asyncpg.Connection,
    customer_id: int,
    *,
    source_system: str,
    match_field: str,
) -> list[str]:
    rows = await conn.fetch(
        """
        SELECT match_value
        FROM crm_account_external_map
        WHERE customer_id = $1
          AND source_system = $2
          AND match_field = $3
        ORDER BY is_primary DESC, match_value
        """,
        customer_id,
        source_system,
        match_field,
    )
    return [str(row["match_value"]).strip() for row in rows if row["match_value"]]


async def get_customer_match_context(
    conn: asyncpg.Connection,
    customer_id: int,
) -> dict[str, Any]:
    customer = await conn.fetchrow(
        """
        SELECT id, customer_code, company_name, short_name, tax_code
        FROM customers
        WHERE id = $1
        """,
        customer_id,
    )
    if not customer:
        return {}

    context = dict(customer)
    context["po_companies"] = await get_customer_aliases(
        conn,
        customer_id,
        source_system="bqms_samsung_po",
        match_field="company",
    )
    context["delivery_types"] = await get_customer_aliases(
        conn,
        customer_id,
        source_system="bqms_deliveries",
        match_field="sev_type",
    )
    context["order_customer_names"] = await get_customer_aliases(
        conn,
        customer_id,
        source_system="bqms_orders",
        match_field="customer_name",
    )
    return context


def non_empty_aliases(values: list[str]) -> list[str]:
    seen: set[str] = set()
    cleaned: list[str] = []
    for value in values:
        normalized = value.strip()
        if not normalized:
            continue
        key = normalized.lower()
        if key in seen:
            continue
        seen.add(key)
        cleaned.append(normalized)
    return cleaned

