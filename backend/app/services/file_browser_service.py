"""
File Browser Service — business logic cho module duyệt file OneDrive.

Cung cấp:
- Folder listing (paginated)
- File search (pg_trgm + FTS)
- On-demand download & stream (cache-miss: download từ OneDrive)
- Preview data (Excel preview via python-calamine)
- Breadcrumbs (walk parent chain)
- Cache stats
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any

import aiofiles
import asyncpg

from app.core.config import settings

logger = logging.getLogger(__name__)

# Cache directory
CACHE_DIR = Path(settings.ONEDRIVE_CACHE_PATH)

# Preview type mapping
_PREVIEW_MAP: dict[str, str] = {
    ".pdf": "pdf",
    ".xlsx": "excel", ".xls": "excel", ".xlsm": "excel", ".csv": "excel",
    ".jpg": "image", ".jpeg": "image", ".png": "image",
    ".webp": "image", ".gif": "image", ".bmp": "image",
    ".doc": "word", ".docx": "word",
    ".step": "cad3d", ".stp": "cad3d",
    ".x_t": "cad3d", ".x_b": "cad3d",
    ".dwg": "cad2d",
    ".zip": "zip", ".rar": "zip", ".7z": "zip",
}


def get_preview_type(extension: str | None) -> str:
    """Xác định loại preview dựa trên file extension."""
    if not extension:
        return "unsupported"
    return _PREVIEW_MAP.get(extension.lower(), "unsupported")


async def get_folder_contents(
    conn: asyncpg.Connection,
    parent_id: str | None,
    page: int = 1,
    limit: int = 50,
    sort: str = "name",
    order: str = "asc",
    files_only: bool = False,
    folders_only: bool = False,
) -> dict[str, Any]:
    """
    Lấy nội dung thư mục (folders + files), paginated.

    Args:
        parent_id: graph_parent_id hoặc None/root cho thư mục gốc.
        files_only: Chỉ lấy files (không folder).
        folders_only: Chỉ lấy folders.
    """
    # Xác định parent
    conditions = ["sync_status != 'deleted'"]
    params: list[Any] = []
    idx = 1

    if parent_id and parent_id != "root":
        conditions.append(f"graph_parent_id = ${idx}")
        params.append(parent_id)
        idx += 1
    else:
        # Root: items không có parent hoặc parent là drive root
        # Tìm items mà graph_parent_id trỏ đến root của drive
        # Cách tiếp cận: items cấp 1 có file_path dạng /xxx (chỉ 1 level)
        conditions.append(
            "graph_parent_id IN ("
            "  SELECT graph_item_id FROM onedrive_file_index "
            "  WHERE graph_parent_id IS NULL AND is_folder = true"
            ") OR graph_parent_id IS NULL"
        )

    if files_only:
        conditions.append("is_folder = false")
    elif folders_only:
        conditions.append("is_folder = true")

    where = " AND ".join(conditions)

    # Validate sort column
    allowed_sorts = {"name", "file_size", "remote_modified_at", "file_extension"}
    if sort not in allowed_sorts:
        sort = "name"
    order_dir = "DESC" if order.lower() == "desc" else "ASC"

    # Folders first, then sorted
    order_clause = f"is_folder DESC, {sort} {order_dir}"

    # Count
    total = await conn.fetchval(
        f"SELECT COUNT(*) FROM onedrive_file_index WHERE {where}", *params
    )

    # Fetch
    offset = (page - 1) * limit
    params.extend([limit, offset])
    rows = await conn.fetch(
        f"""
        SELECT id, graph_item_id, graph_parent_id, name, file_path,
               file_extension, file_size, mime_type, is_folder,
               remote_created_at, remote_modified_at, is_cached,
               sync_status, etag, converted_path
        FROM onedrive_file_index
        WHERE {where}
        ORDER BY {order_clause}
        LIMIT ${idx} OFFSET ${idx + 1}
        """,
        *params,
    )

    items = []
    for row in rows:
        item = dict(row)
        item["preview_type"] = get_preview_type(item.get("file_extension"))
        items.append(item)

    return {
        "items": items,
        "total": int(total or 0),
        "page": page,
        "limit": limit,
    }


async def search_files(
    conn: asyncpg.Connection,
    query: str,
    page: int = 1,
    limit: int = 50,
) -> dict[str, Any]:
    """
    Tìm kiếm file theo tên bằng pg_trgm similarity + full-text search.
    """
    query_lower = query.lower().strip()
    offset = (page - 1) * limit

    total = await conn.fetchval(
        """
        SELECT COUNT(*) FROM onedrive_file_index
        WHERE sync_status != 'deleted'
          AND is_folder = false
          AND (
            name_trgm % $1
            OR to_tsvector('simple', name) @@ plainto_tsquery('simple', $1)
          )
        """,
        query_lower,
    )

    rows = await conn.fetch(
        """
        SELECT id, graph_item_id, graph_parent_id, name, file_path,
               file_extension, file_size, mime_type, is_folder,
               remote_created_at, remote_modified_at, is_cached,
               sync_status, converted_path,
               similarity(name_trgm, $1) AS score
        FROM onedrive_file_index
        WHERE sync_status != 'deleted'
          AND is_folder = false
          AND (
            name_trgm % $1
            OR to_tsvector('simple', name) @@ plainto_tsquery('simple', $1)
          )
        ORDER BY score DESC, remote_modified_at DESC NULLS LAST
        LIMIT $2 OFFSET $3
        """,
        query_lower, limit, offset,
    )

    items = []
    for row in rows:
        item = dict(row)
        item["preview_type"] = get_preview_type(item.get("file_extension"))
        items.append(item)

    return {
        "items": items,
        "total": int(total or 0),
        "page": page,
        "limit": limit,
    }


async def build_breadcrumbs(
    conn: asyncpg.Connection,
    item_id: str,
) -> list[dict[str, Any]]:
    """
    Build breadcrumb path từ item lên đến root.

    Returns:
        List of {id, graph_item_id, name} từ root → current item.
    """
    breadcrumbs: list[dict[str, Any]] = []
    current_id = item_id

    # Giới hạn 20 levels để tránh infinite loop
    for _ in range(20):
        row = await conn.fetchrow(
            """
            SELECT id, graph_item_id, graph_parent_id, name, is_folder
            FROM onedrive_file_index
            WHERE graph_item_id = $1
            """,
            current_id,
        )
        if not row:
            break

        breadcrumbs.append({
            "id": row["id"],
            "graph_item_id": row["graph_item_id"],
            "name": row["name"],
            "is_folder": row["is_folder"],
        })

        if not row["graph_parent_id"]:
            break
        current_id = row["graph_parent_id"]

    breadcrumbs.reverse()

    # Prepend root
    breadcrumbs.insert(0, {
        "id": None,
        "graph_item_id": "root",
        "name": "Gốc",
        "is_folder": True,
    })

    return breadcrumbs


async def get_file_record(
    conn: asyncpg.Connection,
    file_id: int,
) -> dict[str, Any] | None:
    """Lấy thông tin file từ DB."""
    row = await conn.fetchrow(
        """
        SELECT id, graph_item_id, graph_parent_id, name, file_path,
               file_extension, file_size, mime_type, is_folder,
               remote_created_at, remote_modified_at, is_cached, local_path,
               cached_at, cache_size, sync_status, etag,
               converted_path, converted_at
        FROM onedrive_file_index
        WHERE id = $1 AND sync_status != 'deleted'
        """,
        file_id,
    )
    if not row:
        return None

    item = dict(row)
    item["preview_type"] = get_preview_type(item.get("file_extension"))
    return item


async def ensure_file_cached(
    conn: asyncpg.Connection,
    file_record: dict[str, Any],
) -> str:
    """
    Đảm bảo file đã có trên local cache. Nếu chưa, download từ OneDrive.

    Returns:
        Đường dẫn local của file.

    Raises:
        HTTPException nếu không thể download.
    """
    from fastapi import HTTPException

    # Đã cached?
    if file_record["is_cached"] and file_record.get("local_path"):
        local = Path(file_record["local_path"])
        if local.exists():
            # Cập nhật cached_at (cho LRU tracking)
            await conn.execute(
                "UPDATE onedrive_file_index SET cached_at = NOW() WHERE id = $1",
                file_record["id"],
            )
            return str(local)

    # Download từ OneDrive
    graph_item_id = file_record["graph_item_id"]
    logger.info("Downloading file from OneDrive: %s (%s)", file_record["name"], graph_item_id)

    try:
        from app.etl.onedrive_client import OneDriveClient

        async with OneDriveClient() as client:
            content = await client.download_file(graph_item_id)
    except Exception as exc:
        logger.error("Download thất bại: %s", exc)
        raise HTTPException(
            status_code=502,
            detail=f"Không thể tải file từ OneDrive: {exc}",
        )

    # Lưu vào cache
    relative_path = file_record["file_path"].lstrip("/")
    local_path = CACHE_DIR / relative_path
    local_path.parent.mkdir(parents=True, exist_ok=True)

    async with aiofiles.open(str(local_path), "wb") as f:
        await f.write(content)

    file_size = len(content)

    # Cập nhật DB
    await conn.execute(
        """
        UPDATE onedrive_file_index SET
            is_cached = true,
            local_path = $2,
            cached_at = NOW(),
            cache_size = $3,
            sync_status = 'cached'
        WHERE id = $1
        """,
        file_record["id"], str(local_path), file_size,
    )

    logger.info(
        "File cached: %s → %s (%d bytes)",
        file_record["name"], local_path, file_size,
    )

    return str(local_path)


async def get_excel_preview(
    file_path: str,
    max_rows: int = 100,
) -> dict[str, Any]:
    """
    Parse Excel file bằng python-calamine, trả về header + rows.

    Returns:
        {"headers": [...], "rows": [[...], ...], "total_rows": N, "truncated": bool}
    """
    try:
        from python_calamine import CalamineWorkbook

        wb = CalamineWorkbook.from_path(file_path)
        sheet_names = wb.sheet_names
        if not sheet_names:
            return {"headers": [], "rows": [], "total_rows": 0, "truncated": False}

        # Lấy sheet đầu tiên
        data = wb.get_sheet_by_name(sheet_names[0]).to_python()

        if not data:
            return {"headers": [], "rows": [], "total_rows": 0, "truncated": False}

        headers = [str(cell) if cell is not None else "" for cell in data[0]]
        rows = []
        for row in data[1:max_rows + 1]:
            rows.append([str(cell) if cell is not None else "" for cell in row])

        total_rows = len(data) - 1  # Exclude header
        return {
            "headers": headers,
            "rows": rows,
            "total_rows": total_rows,
            "truncated": total_rows > max_rows,
            "sheet_names": sheet_names,
        }

    except Exception as exc:
        logger.warning("Excel preview thất bại (%s): %s", file_path, exc)
        return {"headers": [], "rows": [], "total_rows": 0, "error": str(exc)}


async def get_cache_stats(conn: asyncpg.Connection) -> dict[str, Any]:
    """Thống kê cache và index."""
    stats = {}

    row = await conn.fetchrow(
        """
        SELECT
            COUNT(*) AS total_items,
            COUNT(*) FILTER (WHERE is_folder = true) AS total_folders,
            COUNT(*) FILTER (WHERE is_folder = false) AS total_files,
            COUNT(*) FILTER (WHERE is_cached = true) AS cached_files,
            COALESCE(SUM(cache_size) FILTER (WHERE is_cached = true), 0) AS total_cache_bytes,
            COUNT(*) FILTER (WHERE sync_status = 'deleted') AS deleted_items
        FROM onedrive_file_index
        """
    )

    if row:
        stats = dict(row)
        stats["cache_max_bytes"] = settings.ONEDRIVE_CACHE_MAX_GB * 1024 * 1024 * 1024
        stats["cache_usage_pct"] = round(
            (stats["total_cache_bytes"] / stats["cache_max_bytes"]) * 100, 1
        ) if stats["cache_max_bytes"] > 0 else 0

    # Last crawl info
    last_crawl = await conn.fetchrow(
        """
        SELECT started_at, completed_at, status, files_processed, error_message
        FROM etl_sync_log
        WHERE sync_type = 'file_index_crawl'
        ORDER BY id DESC LIMIT 1
        """
    )
    stats["last_crawl"] = dict(last_crawl) if last_crawl else None

    return stats
