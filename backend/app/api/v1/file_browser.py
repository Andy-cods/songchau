"""
File Browser API — Song Châu ERP

Duyệt file OneDrive giống Windows Explorer:
- Folder navigation (breadcrumbs, child listing)
- File search (pg_trgm fuzzy + FTS)
- On-demand download (auto-cache từ OneDrive)
- Preview (PDF iframe, Excel table, Image, CAD, ZIP)
- Cache stats (admin)

Endpoints:
  GET  /folders                    — List child folders
  GET  /files                      — List files in folder (paginated)
  GET  /search                     — Search files by name
  GET  /files/{id}/download        — Download/stream file
  GET  /files/{id}/preview         — Preview metadata + data
  GET  /breadcrumbs/{graph_item_id} — Path from root to item
  GET  /stats                      — Cache + index stats (admin)
  POST /crawl                      — Trigger re-crawl (admin)
"""

from __future__ import annotations

import logging
from typing import Optional

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse

from app.core.database import get_db
from app.core.rbac import require_role
from app.core.security import TokenData
from app.services import file_browser_service as svc

logger = logging.getLogger(__name__)

router = APIRouter()


# ---------------------------------------------------------------------------
# GET /folders — List child folders
# ---------------------------------------------------------------------------

@router.get("/folders")
async def list_folders(
    parent_id: Optional[str] = Query(None, description="graph_item_id của thư mục cha (mặc định: root)"),
    token_data: TokenData = Depends(require_role("staff", "warehouse", "sales", "accountant", "manager", "director", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Liệt kê thư mục con của một thư mục."""
    data = await svc.get_folder_contents(
        conn, parent_id, page=1, limit=500, sort="name", order="asc",
        folders_only=True,
    )

    # Build breadcrumbs cho parent
    breadcrumbs = []
    if parent_id and parent_id != "root":
        breadcrumbs = await svc.build_breadcrumbs(conn, parent_id)
    else:
        breadcrumbs = [{
            "id": None,
            "graph_item_id": "root",
            "name": "Gốc",
            "is_folder": True,
        }]

    return {
        "data": {
            "items": data["items"],
            "total": data["total"],
            "breadcrumbs": breadcrumbs,
        }
    }


# ---------------------------------------------------------------------------
# GET /files — List files in folder (paginated)
# ---------------------------------------------------------------------------

@router.get("/files")
async def list_files(
    parent_id: Optional[str] = Query(None, description="graph_item_id của thư mục cha"),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    sort: str = Query("name", description="Sắp xếp: name, file_size, remote_modified_at"),
    order: str = Query("asc", description="asc hoặc desc"),
    token_data: TokenData = Depends(require_role("staff", "warehouse", "sales", "accountant", "manager", "director", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Liệt kê files + folders trong một thư mục, paginated."""
    data = await svc.get_folder_contents(
        conn, parent_id, page=page, limit=limit, sort=sort, order=order,
    )
    return {"data": data}


# ---------------------------------------------------------------------------
# GET /search — Search files by name
# ---------------------------------------------------------------------------

@router.get("/search")
async def search_files(
    q: str = Query(..., min_length=1, description="Từ khóa tìm kiếm"),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    token_data: TokenData = Depends(require_role("staff", "warehouse", "sales", "accountant", "manager", "director", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Tìm kiếm file theo tên (fuzzy + full-text)."""
    data = await svc.search_files(conn, q, page=page, limit=limit)
    return {"data": data}


# ---------------------------------------------------------------------------
# GET /files/{id}/download — Download/stream file
# ---------------------------------------------------------------------------

@router.get("/files/{file_id}/download")
async def download_file(
    file_id: int,
    token_data: TokenData = Depends(require_role("staff", "warehouse", "sales", "accountant", "manager", "director", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """
    Download file. Nếu chưa cached, tự động download từ OneDrive.
    Hỗ trợ ?token= query param cho iframe/img src.
    """
    record = await svc.get_file_record(conn, file_id)
    if not record:
        raise HTTPException(status_code=404, detail="File không tồn tại")

    if record["is_folder"]:
        raise HTTPException(status_code=400, detail="Không thể download thư mục")

    # Ensure file is cached locally
    local_path = await svc.ensure_file_cached(conn, record)

    return FileResponse(
        path=local_path,
        filename=record["name"],
        media_type=record.get("mime_type") or "application/octet-stream",
    )


# ---------------------------------------------------------------------------
# GET /files/{id}/preview — Preview metadata + data
# ---------------------------------------------------------------------------

@router.get("/files/{file_id}/preview")
async def preview_file(
    file_id: int,
    token_data: TokenData = Depends(require_role("staff", "warehouse", "sales", "accountant", "manager", "director", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """
    Trả về metadata cho preview panel + dữ liệu preview (nếu có).
    - Excel: header + 100 rows đầu tiên
    - PDF/Image/Word: download_url (frontend tự render)
    - CAD: conversion status
    """
    record = await svc.get_file_record(conn, file_id)
    if not record:
        raise HTTPException(status_code=404, detail="File không tồn tại")

    preview_type = svc.get_preview_type(record.get("file_extension"))
    download_url = f"/api/v1/file-browser/files/{file_id}/download"

    response: dict = {
        "id": record["id"],
        "name": record["name"],
        "file_path": record["file_path"],
        "file_extension": record["file_extension"],
        "file_size": record["file_size"],
        "mime_type": record["mime_type"],
        "preview_type": preview_type,
        "download_url": download_url,
        "is_cached": record["is_cached"],
        "remote_modified_at": record.get("remote_modified_at"),
    }

    # Excel preview: parse first 100 rows
    if preview_type == "excel":
        try:
            local_path = await svc.ensure_file_cached(conn, record)
            preview_data = await svc.get_excel_preview(local_path)
            response["preview_data"] = preview_data
        except Exception as exc:
            logger.warning("Excel preview thất bại: %s", exc)
            response["preview_data"] = {"error": str(exc)}

    # CAD conversion status
    elif preview_type == "cad3d":
        ext = (record.get("file_extension") or "").lower()
        if ext in (".x_t", ".x_b"):
            # Cần convert X_T → STEP
            if record.get("converted_path"):
                response["converted_url"] = f"/api/v1/file-browser/files/{file_id}/download?converted=1"
                response["conversion_status"] = "ready"
            else:
                response["conversion_status"] = "pending"
        else:
            # STEP/STP — trực tiếp render
            response["conversion_status"] = "ready"

    return {"data": response}


# ---------------------------------------------------------------------------
# GET /breadcrumbs/{graph_item_id} — Path from root to item
# ---------------------------------------------------------------------------

@router.get("/breadcrumbs/{graph_item_id}")
async def get_breadcrumbs(
    graph_item_id: str,
    token_data: TokenData = Depends(require_role("staff", "warehouse", "sales", "accountant", "manager", "director", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Trả về đường dẫn từ root đến item (breadcrumbs)."""
    crumbs = await svc.build_breadcrumbs(conn, graph_item_id)
    return {"data": crumbs}


# ---------------------------------------------------------------------------
# GET /stats — Cache + index stats (admin only)
# ---------------------------------------------------------------------------

@router.get("/stats")
async def get_stats(
    token_data: TokenData = Depends(require_role("admin", "manager", "director")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Thống kê cache và index (chỉ admin/manager)."""
    stats = await svc.get_cache_stats(conn)
    return {"data": stats}


# ---------------------------------------------------------------------------
# POST /crawl — Trigger manual re-crawl (admin only)
# ---------------------------------------------------------------------------

@router.post("/crawl", status_code=202)
async def trigger_crawl(
    token_data: TokenData = Depends(require_role("admin")),
):
    """Trigger quét lại metadata OneDrive (chạy background)."""
    try:
        from app.tasks.file_index_crawler import file_index_crawl
        await file_index_crawl.defer_async()
        return {"message": "Đang bắt đầu quét file OneDrive..."}
    except Exception as exc:
        logger.error("Trigger crawl thất bại: %s", exc)
        raise HTTPException(
            status_code=500,
            detail=f"Không thể trigger crawl: {exc}",
        )
