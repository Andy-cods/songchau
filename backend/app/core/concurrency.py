"""
Concurrency control utilities — optimistic locking + idempotency.

Pattern: every write operation goes through these helpers to:
1. Check version (optimistic lock) → return 409 if stale
2. Emit Socket.IO event so other browsers refetch
3. Invalidate Redis cache for related queries
"""

from __future__ import annotations

import json
import logging
from typing import Any

import asyncpg
from fastapi import HTTPException

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Optimistic Lock — version check on UPDATE
# ---------------------------------------------------------------------------

async def update_with_version_check(
    conn: asyncpg.Connection,
    table: str,
    record_id: int,
    expected_version: int | None,
    fields: dict[str, Any],
    id_column: str = "id",
) -> dict[str, Any]:
    """
    Update a record with optimistic lock.

    Args:
        conn: asyncpg connection
        table: table name (whitelist-validated)
        record_id: row id
        expected_version: client's known version (or None to skip check)
        fields: {column: value} dict — these will be updated
        id_column: primary key column name

    Returns:
        Updated row as dict.

    Raises:
        HTTPException(404): row not found
        HTTPException(409): version mismatch (someone else updated)
        HTTPException(400): no fields to update
    """
    # Whitelist tables to prevent SQL injection
    ALLOWED_TABLES = {
        "bqms_deliveries", "crm_pipeline_cards", "quotations",
        "sales_invoices_q", "purchase_invoices_q", "customers",
        "vendor_quotes",
    }
    if table not in ALLOWED_TABLES:
        raise HTTPException(500, f"Bảng {table} không được phép update qua helper")

    if not fields:
        raise HTTPException(400, "Không có trường nào để cập nhật")

    # Build SET clause
    sets = []
    params: list = []
    idx = 1
    for col, val in fields.items():
        sets.append(f"{col} = ${idx}")
        params.append(val)
        idx += 1

    # WHERE: id + optional version check
    where = f"{id_column} = ${idx}"
    params.append(record_id)
    idx += 1

    if expected_version is not None:
        where += f" AND version = ${idx}"
        params.append(expected_version)

    sql = f"UPDATE {table} SET {', '.join(sets)} WHERE {where} RETURNING *"

    try:
        row = await conn.fetchrow(sql, *params)
    except asyncpg.PostgresError as e:
        logger.error("update_with_version_check SQL error: %s", e)
        raise HTTPException(500, f"Lỗi cập nhật: {e}")

    if not row:
        # Could be: row not exist OR version mismatch
        # Check if row exists
        exists = await conn.fetchval(
            f"SELECT version FROM {table} WHERE {id_column} = $1", record_id
        )
        if exists is None:
            raise HTTPException(404, f"Bản ghi không tồn tại")
        else:
            raise HTTPException(
                409,
                f"Người khác đã cập nhật bản ghi này (version hiện tại: {exists}). "
                f"Vui lòng tải lại để xem dữ liệu mới."
            )

    return dict(row)


# ---------------------------------------------------------------------------
# Real-time event emit (Socket.IO)
# ---------------------------------------------------------------------------

async def emit_record_changed(
    entity_type: str,
    record_id: int,
    action: str = "updated",
    user_id: str | None = None,
    metadata: dict | None = None,
) -> None:
    """
    Emit a record_changed event to all connected clients.

    Frontend listens to this event and auto-invalidates TanStack Query cache
    for the matching entity_type.

    Args:
        entity_type: e.g. 'bqms_delivery', 'crm_pipeline_card', 'invoice'
        record_id: which record changed
        action: 'created', 'updated', 'deleted', 'moved'
        user_id: who made the change (so frontend can skip self)
        metadata: optional extra data (stage transitions, etc.)
    """
    try:
        from app.websocket.handlers import sio

        payload = {
            "entity_type": entity_type,
            "record_id": record_id,
            "action": action,
            "user_id": user_id,
            "metadata": metadata or {},
        }

        # Broadcast to all connected clients
        # Frontend filters by entity_type when invalidating
        await sio.emit("record_changed", payload)
        logger.debug("emit_record_changed: %s/%d (%s)", entity_type, record_id, action)
    except Exception as exc:
        # Never fail the main request if socket emit fails
        logger.warning("emit_record_changed failed: %s", exc)


# ---------------------------------------------------------------------------
# Idempotency middleware (for POST endpoints)
# ---------------------------------------------------------------------------

async def check_idempotency(
    conn: asyncpg.Connection,
    key: str,
    user_id: str | None,
    endpoint: str,
) -> dict | None:
    """
    Check if this idempotency key has been used before.

    Returns:
        Cached response dict if found, None otherwise.
    """
    if not key:
        return None

    row = await conn.fetchrow(
        """
        SELECT response_body, status_code FROM idempotency_keys
        WHERE key = $1 AND endpoint = $2 AND expires_at > NOW()
        """,
        key, endpoint,
    )

    if row:
        logger.info("Idempotency hit: %s for %s", key[:12], endpoint)
        return {
            "body": row["response_body"],
            "status_code": row["status_code"],
        }
    return None


async def save_idempotency(
    conn: asyncpg.Connection,
    key: str,
    user_id: str | None,
    endpoint: str,
    response_body: dict,
    status_code: int = 200,
) -> None:
    """Store idempotency key with response."""
    if not key:
        return

    try:
        await conn.execute(
            """
            INSERT INTO idempotency_keys (key, user_id, endpoint, response_body, status_code)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (key) DO NOTHING
            """,
            key, user_id, endpoint, json.dumps(response_body, default=str), status_code,
        )
    except Exception as exc:
        logger.warning("save_idempotency failed: %s", exc)
