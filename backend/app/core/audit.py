"""Shared audit-log writer — appends one immutable row to `audit_log`.

W3-07 (Thang). Two mechanisms currently write to `audit_log`:

  1. DB-level trigger `auto_audit_log()` (see tests/_schema_snapshot.sql),
     attached to accounts_payable / accounts_receivable / customers /
     cash_book / purchase_orders / sales_orders / suppliers / inventory /
     exchange_rates / bqms_samsung_po / import_export_tracking /
     imv_purchase_orders / revenue_invoices / workflow_instances. It fires
     automatically on every INSERT/UPDATE/DELETE — no app code needed.

     KNOWN LIMITATION (found during W3-07, not fixed here — flagged for a
     follow-up): that trigger reads `current_setting('app.current_user_id',
     true)`, which app/core/rbac.py's `require_role()` sets via a *standalone*
     `SELECT set_config(..., true)` statement executed OUTSIDE any explicit
     transaction. Postgres discards `SET LOCAL`/`set_config(_, true)` effects
     at the end of the (implicit, auto-committed) transaction that set them —
     so by the time the endpoint's own INSERT/UPDATE runs, the setting is
     already gone and the triggered audit_log row's `user_id` is NULL. The
     row itself still gets written (table/action/old_data/new_data are
     correct), so DB-trigger-covered tables DO have audit coverage; only the
     actor attribution on those specific rows is unreliable.

  2. Explicit app-level calls (this module) for tables the DB trigger does
     NOT cover. These pass `token_data` straight from the request, so
     `user_id`/`user_email` are always populated correctly — immune to the
     GUC-timing issue above. Prefer this path for any NEW table that needs
     audit coverage instead of adding another DB trigger.

Mirrors the INSERT shape of the private `_write_audit_log` already used in
app/api/v1/quarterly_invoices.py (kept as-is there to avoid touching a
shipped, working file for this task — the two are intentionally identical).

The `audit_log` table itself is append-only as of
backend/migrations/m44_audit_log_immutable.sql — this helper only INSERTs,
never UPDATE/DELETE.
"""

from __future__ import annotations

import json
from typing import Any

import asyncpg
from fastapi import Request

from app.core.security import TokenData


async def write_audit_log(
    conn: asyncpg.Connection,
    token_data: TokenData,
    action: str,
    table_name: str,
    record_id: int | str,
    old_data: dict[str, Any] | None,
    new_data: dict[str, Any] | None,
    request: Request | None = None,
) -> None:
    """Append one row to audit_log.

    Caller should already be inside `async with conn.transaction()` when the
    audit row must be atomic with the business write it documents (same
    convention as `app.api.v1.procurement._audit`).
    """
    await conn.execute(
        """
        INSERT INTO audit_log (
            user_id,
            user_email,
            action,
            table_name,
            record_id,
            old_data,
            new_data,
            ip_address,
            user_agent
        )
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::inet, $9)
        """,
        token_data.user_id,
        token_data.email,
        action,
        table_name,
        str(record_id),
        json.dumps(old_data or {}, ensure_ascii=False, default=str),
        json.dumps(new_data or {}, ensure_ascii=False, default=str),
        request.client.host if request and request.client else None,
        request.headers.get("user-agent") if request else None,
    )
