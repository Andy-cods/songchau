"""
OneDrive Periodic Sync Task — chạy mỗi 4 giờ.

Quy trình:
1. Đọc delta_token cuối cùng từ etl_sync_log.
2. Gọi Microsoft Graph delta query để lấy file Excel đã thay đổi.
3. Download file mới/cập nhật về /data/onedrive-staging/.
4. Chạy import_all_data cho các file đã thay đổi (UPSERT).
5. Lưu delta_token mới vào etl_sync_log.
6. Emit websocket event 'onedrive_sync_done'.

Database access dùng psycopg2 sync connection — Procrastinate worker
chạy ngoài async event loop.

Yêu cầu env vars: M365_TENANT_ID, M365_CLIENT_ID, M365_CLIENT_SECRET, M365_DRIVE_ID
"""

from __future__ import annotations

import json
import logging
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import psycopg2
import psycopg2.extras

from app.core.config import settings
from app.core.procrastinate_app import app, SYNC_DSN

logger = logging.getLogger(__name__)

# Thư mục staging cho file OneDrive
STAGING_DIR = Path(os.getenv("ONEDRIVE_STAGING_PATH", "/data/onedrive-staging"))
EXCEL_EXTENSIONS = {".xlsx", ".xls", ".xlsm"}


# ---------------------------------------------------------------------------
# Periodic task — mỗi 4 giờ (0:00, 4:00, 8:00, 12:00, 16:00, 20:00)
# ---------------------------------------------------------------------------

@app.periodic(cron="0 */4 * * *")
@app.task(name="onedrive_delta_sync", queue="etl")
def onedrive_delta_sync(timestamp: int = 0) -> dict[str, Any]:
    """
    Delta sync từ OneDrive — chỉ tải và import file đã thay đổi.

    Returns summary dict, cũng được gửi qua WebSocket.
    """
    started_at = datetime.now(timezone.utc)
    logger.info("onedrive_delta_sync: bắt đầu (utc=%s)", started_at.isoformat())

    result: dict[str, Any] = {
        "files_downloaded": 0,
        "files_processed": 0,
        "rows_inserted": 0,
        "rows_updated": 0,
        "errors": 0,
        "duration_seconds": 0.0,
        "synced_at": started_at.isoformat(),
    }

    t0 = time.monotonic()

    # Kiểm tra env vars
    if not all([
        settings.M365_TENANT_ID,
        settings.M365_CLIENT_ID,
        settings.M365_CLIENT_SECRET,
        settings.M365_DRIVE_ID,
    ]):
        logger.warning(
            "onedrive_delta_sync: thiếu M365_* env vars — bỏ qua."
        )
        result["errors"] += 1
        result["error_message"] = "Missing M365 environment variables"
        result["duration_seconds"] = round(time.monotonic() - t0, 2)
        return result

    sync_log_id = None

    try:
        # ------------------------------------------------------------------
        # 1. Đọc delta_token cuối cùng từ etl_sync_log
        # ------------------------------------------------------------------
        delta_token = _get_last_delta_token()
        logger.info(
            "onedrive_delta_sync: delta_token=%s",
            "có" if delta_token else "không (full sync)",
        )

        # ------------------------------------------------------------------
        # 2. Ghi bản ghi sync log (status=running)
        # ------------------------------------------------------------------
        sync_log_id = _create_sync_log(started_at)

        # ------------------------------------------------------------------
        # 3. Delta query OneDrive
        # ------------------------------------------------------------------
        from scripts.download_onedrive import OneDriveClient

        client = OneDriveClient(
            tenant_id=settings.M365_TENANT_ID,
            client_id=settings.M365_CLIENT_ID,
            client_secret=settings.M365_CLIENT_SECRET,
            drive_id=settings.M365_DRIVE_ID,
        )
        client.authenticate()

        changed_files, new_delta_token = client.list_delta(delta_token)
        logger.info(
            "onedrive_delta_sync: %d file thay đổi",
            len(changed_files),
        )

        # ------------------------------------------------------------------
        # 4. Download changed files
        # ------------------------------------------------------------------
        STAGING_DIR.mkdir(parents=True, exist_ok=True)
        downloaded_paths: list[Path] = []

        for f in changed_files:
            if f.get("deleted"):
                # File bị xóa trên OneDrive — bỏ qua
                continue

            relative_path = f["path"].lstrip("/")
            local_path = STAGING_DIR / relative_path

            try:
                client.download_file(f["id"], local_path)
                downloaded_paths.append(local_path)
                result["files_downloaded"] += 1
            except Exception as exc:
                logger.warning(
                    "onedrive_delta_sync: lỗi download %s: %s",
                    relative_path, exc,
                )
                result["errors"] += 1

        logger.info(
            "onedrive_delta_sync: đã tải %d file",
            result["files_downloaded"],
        )

        # ------------------------------------------------------------------
        # 5. Import changed files (UPSERT)
        # ------------------------------------------------------------------
        if downloaded_paths:
            import_result = _process_changed_files(downloaded_paths)
            result["files_processed"] = import_result.get("files_processed", 0)
            result["rows_inserted"] = import_result.get("rows_inserted", 0)
            result["rows_updated"] = import_result.get("rows_updated", 0)
            result["errors"] += import_result.get("errors", 0)

        # ------------------------------------------------------------------
        # 6. Lưu delta_token mới
        # ------------------------------------------------------------------
        if new_delta_token:
            _save_delta_token(new_delta_token, sync_log_id)
            logger.info("onedrive_delta_sync: đã lưu delta_token mới")

    except Exception as exc:
        logger.exception("onedrive_delta_sync: lỗi không mong đợi: %s", exc)
        result["errors"] += 1
        result["error_message"] = str(exc)[:500]

    finally:
        result["duration_seconds"] = round(time.monotonic() - t0, 2)

        # Cập nhật sync log
        if sync_log_id:
            status = "success" if result["errors"] == 0 else "error"
            _update_sync_log(sync_log_id, status, result)

    # ------------------------------------------------------------------
    # 7. Emit WebSocket event
    # ------------------------------------------------------------------
    _emit_sync_done(result)

    logger.info(
        "onedrive_delta_sync: xong — downloaded=%d processed=%d "
        "inserted=%d updated=%d errors=%d duration=%.1fs",
        result["files_downloaded"], result["files_processed"],
        result["rows_inserted"], result["rows_updated"],
        result["errors"], result["duration_seconds"],
    )
    return result


# ---------------------------------------------------------------------------
# Database helpers (psycopg2 sync)
# ---------------------------------------------------------------------------

def _get_last_delta_token() -> str | None:
    """Đọc delta_token cuối cùng từ etl_sync_log."""
    conn = psycopg2.connect(SYNC_DSN)
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT delta_token FROM etl_sync_log
                WHERE sync_type = 'onedrive_delta'
                  AND delta_token IS NOT NULL
                ORDER BY id DESC LIMIT 1
                """
            )
            row = cur.fetchone()
            return row[0] if row else None
    finally:
        conn.close()


def _create_sync_log(started_at: datetime) -> int:
    """Tạo bản ghi etl_sync_log với status=running. Trả về ID."""
    conn = psycopg2.connect(SYNC_DSN)
    try:
        with conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO etl_sync_log (sync_type, started_at, status)
                VALUES ('onedrive_delta', %s, 'running')
                RETURNING id
                """,
                (started_at,),
            )
            row = cur.fetchone()
            return row[0] if row else 0
    finally:
        conn.close()


def _update_sync_log(
    log_id: int,
    status: str,
    result: dict[str, Any],
) -> None:
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
                    rows_updated = %s,
                    error_message = %s
                WHERE id = %s
                """,
                (
                    status,
                    result.get("files_processed", 0),
                    result.get("rows_inserted", 0),
                    result.get("rows_updated", 0),
                    result.get("error_message"),
                    log_id,
                ),
            )
    finally:
        conn.close()


def _save_delta_token(token: str, sync_log_id: int | None) -> None:
    """Lưu delta_token vào etl_sync_log (cập nhật bản ghi hiện tại)."""
    conn = psycopg2.connect(SYNC_DSN)
    try:
        with conn, conn.cursor() as cur:
            if sync_log_id:
                cur.execute(
                    "UPDATE etl_sync_log SET delta_token = %s WHERE id = %s",
                    (token, sync_log_id),
                )
            else:
                cur.execute(
                    """
                    INSERT INTO etl_sync_log (sync_type, status, delta_token, completed_at)
                    VALUES ('onedrive_delta', 'success', %s, NOW())
                    """,
                    (token,),
                )
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Import changed files
# ---------------------------------------------------------------------------

def _process_changed_files(
    file_paths: list[Path],
) -> dict[str, int]:
    """
    Import các file Excel đã thay đổi vào database.
    Sử dụng IMPORT_MAP từ import_all_data để xác định bảng đích.
    """
    import asyncio

    result = {
        "files_processed": 0,
        "rows_inserted": 0,
        "rows_updated": 0,
        "errors": 0,
    }

    try:
        # Import mapping từ script
        from scripts.import_all_data import (
            IMPORT_MAP,
            import_file_sheet,
            DATA_SOURCE,
        )
        import asyncpg

        async def _run_imports():
            dsn = SYNC_DSN
            conn = await asyncpg.connect(dsn)
            try:
                for fpath in file_paths:
                    fname = fpath.name.lower()

                    # Tìm config phù hợp trong IMPORT_MAP
                    for config in IMPORT_MAP:
                        matched = False
                        for pattern_file in config["files"]:
                            pattern_name = Path(pattern_file).name.lower()
                            if fname == pattern_name or fname.startswith(
                                pattern_name.split(".")[0]
                            ):
                                matched = True
                                break

                        if not matched:
                            continue

                        # Xác định sheets
                        sheet_config = config.get("sheet")
                        if isinstance(sheet_config, list):
                            sheets = sheet_config
                        elif sheet_config is None:
                            sheets = [None]
                        else:
                            sheets = [sheet_config]

                        for sheet_name in sheets:
                            try:
                                r = await import_file_sheet(
                                    conn, str(fpath), sheet_name,
                                    config, dry_run=False,
                                )
                                result["rows_inserted"] += r.get("inserted", 0)
                                result["rows_updated"] += r.get("updated", 0)
                                result["errors"] += r.get("errors", 0)
                                result["files_processed"] += 1
                            except Exception as exc:
                                logger.warning(
                                    "onedrive_sync: lỗi import %s/%s: %s",
                                    fpath.name, sheet_name, exc,
                                )
                                result["errors"] += 1
            finally:
                await conn.close()

        asyncio.run(_run_imports())

    except Exception as exc:
        logger.exception("onedrive_sync: lỗi process: %s", exc)
        result["errors"] += 1

    return result


# ---------------------------------------------------------------------------
# WebSocket emit
# ---------------------------------------------------------------------------

def _emit_sync_done(result: dict[str, Any]) -> None:
    """Emit 'onedrive_sync_done' qua Socket.IO."""
    import asyncio

    try:
        from app.websocket import sio

        async def _emit():
            await sio.emit(
                "onedrive_sync_done",
                result,
                room="role_admin",
            )
            await sio.emit(
                "onedrive_sync_done",
                result,
                room="role_manager",
            )

        asyncio.run(_emit())
    except RuntimeError as exc:
        if "cannot be called from a running event loop" in str(exc):
            logger.debug("_emit_sync_done: bỏ qua (event loop đang chạy)")
        else:
            logger.warning("_emit_sync_done: RuntimeError: %s", exc)
    except Exception as exc:
        logger.warning("_emit_sync_done: không thể emit WebSocket: %s", exc)
