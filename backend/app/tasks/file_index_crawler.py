"""
File Index Crawler — quét metadata toàn bộ OneDrive và lưu vào onedrive_file_index.

Quy trình:
1. Đệ quy qua tất cả folders trên OneDrive bằng MS Graph API.
2. UPSERT metadata (tên, kích thước, mime_type, đường dẫn, ...) vào onedrive_file_index.
3. Đánh dấu các items không còn tồn tại là sync_status='deleted'.
4. Ghi log vào etl_sync_log.

Chạy định kỳ mỗi 6 giờ + trigger thủ công.
Database access dùng psycopg2 sync — Procrastinate worker chạy ngoài async event loop.
"""

from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime, timezone
from typing import Any

import psycopg2
import psycopg2.extras

from app.core.config import settings
from app.core.procrastinate_app import app, SYNC_DSN

logger = logging.getLogger(__name__)

BATCH_SIZE = 500


# ---------------------------------------------------------------------------
# Periodic task — mỗi 6 giờ
# ---------------------------------------------------------------------------

@app.periodic(cron="0 */6 * * *")
@app.task(name="file_index_crawl", queue="etl")
def file_index_crawl(timestamp: int = 0) -> dict[str, Any]:
    """
    Quét metadata toàn bộ OneDrive → UPSERT vào onedrive_file_index.
    Không download file nào — chỉ lưu metadata.
    """
    started_at = datetime.now(timezone.utc)
    logger.info("file_index_crawl: bắt đầu (utc=%s)", started_at.isoformat())

    result: dict[str, Any] = {
        "folders_scanned": 0,
        "files_indexed": 0,
        "folders_indexed": 0,
        "items_deleted": 0,
        "errors": 0,
        "duration_seconds": 0.0,
    }

    t0 = time.monotonic()

    # Kiểm tra env vars
    if not all([
        settings.M365_TENANT_ID,
        settings.M365_CLIENT_ID,
        settings.M365_CLIENT_SECRET,
        settings.M365_DRIVE_ID,
    ]):
        logger.warning("file_index_crawl: thiếu M365_* env vars — bỏ qua.")
        result["errors"] += 1
        result["error_message"] = "Missing M365 environment variables"
        result["duration_seconds"] = round(time.monotonic() - t0, 2)
        return result

    sync_log_id = None

    try:
        # Tạo sync log
        sync_log_id = _create_sync_log(started_at)

        # Thu thập tất cả items bằng async crawl
        all_items = asyncio.run(_crawl_all_items())

        logger.info(
            "file_index_crawl: thu thập %d items từ OneDrive",
            len(all_items),
        )

        # UPSERT vào database theo batch
        seen_ids: set[str] = set()
        conn = psycopg2.connect(SYNC_DSN)
        try:
            with conn:
                with conn.cursor() as cur:
                    batch: list[tuple] = []

                    for item in all_items:
                        seen_ids.add(item["id"])

                        batch.append((
                            item["id"],            # graph_item_id
                            item["parent_id"],     # graph_parent_id
                            item["name"],          # name
                            item["file_path"],     # file_path
                            item["file_extension"],# file_extension
                            item["size"],          # file_size
                            item["mime_type"],     # mime_type
                            item["is_folder"],     # is_folder
                            item["created_at"],    # remote_created_at
                            item["modified_at"],   # remote_modified_at
                            item["etag"],          # etag
                        ))

                        if item["is_folder"]:
                            result["folders_indexed"] += 1
                        else:
                            result["files_indexed"] += 1

                        if len(batch) >= BATCH_SIZE:
                            _upsert_batch(cur, batch)
                            batch.clear()

                    # Flush remaining
                    if batch:
                        _upsert_batch(cur, batch)

                    # Đánh dấu items đã bị xóa trên OneDrive
                    if seen_ids:
                        deleted_count = _mark_deleted(cur, seen_ids)
                        result["items_deleted"] = deleted_count

        finally:
            conn.close()

        result["folders_scanned"] = sum(
            1 for item in all_items if item["is_folder"]
        )

    except Exception as exc:
        logger.exception("file_index_crawl: lỗi: %s", exc)
        result["errors"] += 1
        result["error_message"] = str(exc)[:500]

    finally:
        result["duration_seconds"] = round(time.monotonic() - t0, 2)

        if sync_log_id:
            status = "success" if result["errors"] == 0 else "error"
            _update_sync_log(sync_log_id, status, result)

    # Emit WebSocket event
    _emit_crawl_done(result)

    logger.info(
        "file_index_crawl: xong — folders=%d files=%d deleted=%d "
        "errors=%d duration=%.1fs",
        result["folders_indexed"], result["files_indexed"],
        result["items_deleted"], result["errors"],
        result["duration_seconds"],
    )
    return result


# ---------------------------------------------------------------------------
# Async crawler — đệ quy qua toàn bộ OneDrive
# ---------------------------------------------------------------------------

async def _crawl_all_items() -> list[dict[str, Any]]:
    """Đệ quy quét toàn bộ drive, trả về flat list tất cả items."""
    from app.etl.onedrive_client import OneDriveClient

    all_items: list[dict[str, Any]] = []

    async with OneDriveClient() as client:
        await _crawl_folder_recursive(client, "root", all_items)

    return all_items


async def _crawl_folder_recursive(
    client: Any,
    folder_id: str,
    accumulator: list[dict[str, Any]],
) -> None:
    """Đệ quy: list children → thêm vào accumulator → recurse folders."""
    try:
        children = await client.list_children_paginated(folder_id)
    except Exception as exc:
        logger.warning(
            "file_index_crawl: lỗi list folder %s: %s", folder_id, exc,
        )
        return

    accumulator.extend(children)

    # Recurse into sub-folders
    for child in children:
        if child["is_folder"]:
            await _crawl_folder_recursive(client, child["id"], accumulator)


# ---------------------------------------------------------------------------
# Database helpers (psycopg2 sync)
# ---------------------------------------------------------------------------

def _upsert_batch(cur: Any, batch: list[tuple]) -> None:
    """UPSERT một batch items vào onedrive_file_index."""
    psycopg2.extras.execute_values(
        cur,
        """
        INSERT INTO onedrive_file_index (
            graph_item_id, graph_parent_id, name, file_path,
            file_extension, file_size, mime_type, is_folder,
            remote_created_at, remote_modified_at, etag,
            sync_status, last_synced_at, updated_at
        )
        VALUES %s
        ON CONFLICT (graph_item_id) DO UPDATE SET
            graph_parent_id    = EXCLUDED.graph_parent_id,
            name               = EXCLUDED.name,
            file_path          = EXCLUDED.file_path,
            file_extension     = EXCLUDED.file_extension,
            file_size          = EXCLUDED.file_size,
            mime_type          = EXCLUDED.mime_type,
            is_folder          = EXCLUDED.is_folder,
            remote_created_at  = EXCLUDED.remote_created_at,
            remote_modified_at = EXCLUDED.remote_modified_at,
            etag               = EXCLUDED.etag,
            sync_status        = CASE
                WHEN onedrive_file_index.sync_status = 'deleted'
                THEN 'indexed'
                ELSE onedrive_file_index.sync_status
            END,
            last_synced_at     = NOW(),
            updated_at         = NOW()
        """,
        [
            (
                item[0], item[1], item[2], item[3],
                item[4], item[5], item[6], item[7],
                item[8], item[9], item[10],
                'indexed', datetime.now(timezone.utc), datetime.now(timezone.utc),
            )
            for item in batch
        ],
        page_size=BATCH_SIZE,
    )


def _mark_deleted(cur: Any, seen_ids: set[str]) -> int:
    """Đánh dấu items không còn tồn tại trên OneDrive là deleted."""
    # Tạo temp table chứa seen IDs
    cur.execute(
        "CREATE TEMP TABLE _seen_ids (graph_item_id TEXT PRIMARY KEY) ON COMMIT DROP"
    )
    psycopg2.extras.execute_values(
        cur,
        "INSERT INTO _seen_ids (graph_item_id) VALUES %s",
        [(gid,) for gid in seen_ids],
        page_size=1000,
    )

    cur.execute(
        """
        UPDATE onedrive_file_index
        SET sync_status = 'deleted', updated_at = NOW()
        WHERE sync_status != 'deleted'
          AND graph_item_id NOT IN (SELECT graph_item_id FROM _seen_ids)
        """
    )
    return cur.rowcount


def _create_sync_log(started_at: datetime) -> int:
    """Tạo bản ghi etl_sync_log cho crawl job."""
    conn = psycopg2.connect(SYNC_DSN)
    try:
        with conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO etl_sync_log (sync_type, started_at, status)
                VALUES ('file_index_crawl', %s, 'running')
                RETURNING id
                """,
                (started_at,),
            )
            row = cur.fetchone()
            return row[0] if row else 0
    finally:
        conn.close()


def _update_sync_log(log_id: int, status: str, result: dict[str, Any]) -> None:
    """Cập nhật etl_sync_log khi hoàn thành."""
    conn = psycopg2.connect(SYNC_DSN)
    try:
        with conn, conn.cursor() as cur:
            cur.execute(
                """
                UPDATE etl_sync_log SET
                    status = %s,
                    completed_at = NOW(),
                    files_processed = %s,
                    rows_inserted = %s,
                    error_message = %s
                WHERE id = %s
                """,
                (
                    status,
                    result.get("files_indexed", 0) + result.get("folders_indexed", 0),
                    result.get("files_indexed", 0),
                    result.get("error_message"),
                    log_id,
                ),
            )
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# WebSocket emit
# ---------------------------------------------------------------------------

def _emit_crawl_done(result: dict[str, Any]) -> None:
    """Emit 'file_index_crawl_done' qua Socket.IO."""
    try:
        from app.websocket import sio

        async def _emit():
            await sio.emit("file_index_crawl_done", result, room="role_admin")

        asyncio.run(_emit())
    except RuntimeError as exc:
        if "cannot be called from a running event loop" in str(exc):
            logger.debug("_emit_crawl_done: bỏ qua (event loop đang chạy)")
        else:
            logger.warning("_emit_crawl_done: RuntimeError: %s", exc)
    except Exception as exc:
        logger.warning("_emit_crawl_done: không thể emit WebSocket: %s", exc)
