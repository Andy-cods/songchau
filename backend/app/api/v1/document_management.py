"""
Document Management API (M12) — Song Châu ERP

Manage uploaded files linked to business entities (contracts, invoices, POs,
RFQs, SOPs, etc.). Supports versioning, tagging, and full-text search.

Endpoints:
  GET  /                          — List documents with filters + pagination
  POST /upload                    — Upload file, create document record
  GET  /{id}                      — Document detail
  GET  /{id}/download             — Download file (FileResponse)
  DELETE /{id}                    — Delete document (admin only)
  GET  /by-entity/{ref_type}/{ref_id} — Documents linked to an entity
"""

from __future__ import annotations

import logging
import os
import uuid
from pathlib import Path
from typing import Optional

import aiofiles
import asyncpg
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse

from app.core.database import get_db
from app.core.rbac import require_role
from app.core.security import TokenData

logger = logging.getLogger(__name__)

router = APIRouter()

# ---------------------------------------------------------------------------
# Storage configuration
# ---------------------------------------------------------------------------

DOCS_DIR = Path("/data/files/documents")
DOCS_DIR.mkdir(parents=True, exist_ok=True)

ALLOWED_MIME_TYPES = {
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "text/plain",
    "text/csv",
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
}

VALID_CATEGORIES = {
    "contract", "invoice", "po", "rfq", "report", "sop", "general", "other"
}

MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MB


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def _doc_row_to_dict(row) -> dict:
    d = dict(row)
    # asyncpg returns arrays as lists; tags may be None
    if d.get("tags") is None:
        d["tags"] = []
    return d


# ---------------------------------------------------------------------------
# GET / — List documents
# ---------------------------------------------------------------------------

@router.get("")
async def list_documents(
    category: Optional[str] = Query(None, description="Loại tài liệu"),
    ref_type: Optional[str] = Query(None, description="Loại entity liên kết"),
    is_public: Optional[bool] = Query(None),
    search: Optional[str] = Query(None, description="Tìm theo tiêu đề"),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    conditions = ["1=1"]
    params: list = []
    idx = 1

    if category:
        if category not in VALID_CATEGORIES:
            raise HTTPException(
                status_code=400,
                detail=f"Danh mục không hợp lệ. Chấp nhận: {', '.join(sorted(VALID_CATEGORIES))}",
            )
        conditions.append(f"d.category = ${idx}")
        params.append(category)
        idx += 1

    if ref_type:
        conditions.append(f"d.ref_type = ${idx}")
        params.append(ref_type)
        idx += 1

    if is_public is not None:
        conditions.append(f"d.is_public = ${idx}")
        params.append(is_public)
        idx += 1

    if search:
        conditions.append(f"d.title ILIKE ${idx}")
        params.append(f"%{search}%")
        idx += 1

    where = " AND ".join(conditions)
    offset = (page - 1) * limit

    total = await conn.fetchval(
        f"SELECT COUNT(*) FROM documents d WHERE {where}", *params
    )

    params.extend([limit, offset])
    rows = await conn.fetch(
        f"""
        SELECT d.*,
               u.full_name AS uploaded_by_name,
               u.email     AS uploaded_by_email
        FROM documents d
        LEFT JOIN users u ON u.id = d.uploaded_by
        WHERE {where}
        ORDER BY d.created_at DESC
        LIMIT ${idx} OFFSET ${idx + 1}
        """,
        *params,
    )

    return {
        "data": {
            "items": [_doc_row_to_dict(r) for r in rows],
            "total": int(total or 0),
            "page": page,
            "limit": limit,
        }
    }


# ---------------------------------------------------------------------------
# POST /upload — Upload file and create document record
# ---------------------------------------------------------------------------

@router.post("/upload", status_code=201)
async def upload_document(
    file: UploadFile = File(..., description="File cần upload"),
    title: str = Form(..., description="Tiêu đề tài liệu"),
    description: Optional[str] = Form(None),
    category: str = Form("general"),
    tags: Optional[str] = Form(None, description="Tags ngăn cách bởi dấu phẩy"),
    is_public: bool = Form(False),
    ref_type: Optional[str] = Form(None),
    ref_id: Optional[int] = Form(None),
    parent_id: Optional[int] = Form(None, description="ID tài liệu cha (để versioning)"),
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    # --- Validate category ---
    if category not in VALID_CATEGORIES:
        raise HTTPException(
            status_code=400,
            detail=f"Danh mục không hợp lệ. Chấp nhận: {', '.join(sorted(VALID_CATEGORIES))}",
        )

    # --- Validate MIME type ---
    content_type = file.content_type or "application/octet-stream"
    if content_type not in ALLOWED_MIME_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Loại file không được hỗ trợ: {content_type}",
        )

    # --- Read file content ---
    file_bytes = await file.read()
    file_size = len(file_bytes)

    if file_size == 0:
        raise HTTPException(status_code=400, detail="File không được rỗng")

    if file_size > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=413,
            detail=f"File vượt quá giới hạn 50MB (kích thước: {file_size / (1024*1024):.1f}MB)",
        )

    # --- Determine version if this is a new version of existing doc ---
    version = 1
    if parent_id:
        parent = await conn.fetchrow(
            "SELECT id, version FROM documents WHERE id = $1", parent_id
        )
        if not parent:
            raise HTTPException(status_code=404, detail="Tài liệu cha không tồn tại")
        version = parent["version"] + 1

    # --- Build unique file path ---
    original_name = file.filename or "document"
    ext = Path(original_name).suffix.lower()
    unique_name = f"{uuid.uuid4().hex}{ext}"
    sub_dir = DOCS_DIR / category
    sub_dir.mkdir(parents=True, exist_ok=True)
    file_path = sub_dir / unique_name
    relative_path = f"documents/{category}/{unique_name}"

    # --- Save to disk ---
    try:
        async with aiofiles.open(file_path, "wb") as f:
            await f.write(file_bytes)
    except OSError as exc:
        logger.error("Failed to save document file: %s", exc)
        raise HTTPException(status_code=500, detail="Lỗi lưu file lên server")

    # --- Parse tags ---
    tag_list: list[str] = []
    if tags:
        tag_list = [t.strip() for t in tags.split(",") if t.strip()]

    # --- Insert DB record ---
    try:
        doc = await conn.fetchrow(
            """
            INSERT INTO documents
                (title, description, file_path, file_name, file_size, mime_type,
                 category, tags, uploaded_by, is_public, version, parent_id,
                 ref_type, ref_id)
            VALUES ($1, $2, $3, $4, $5, $6,
                    $7, $8, $9::uuid, $10, $11, $12,
                    $13, $14)
            RETURNING *
            """,
            title,
            description,
            relative_path,
            original_name,
            file_size,
            content_type,
            category,
            tag_list,
            token_data.user_id,
            is_public,
            version,
            parent_id,
            ref_type,
            ref_id,
        )
    except Exception as exc:
        # Clean up the saved file if DB insert failed
        try:
            os.remove(file_path)
        except OSError:
            pass
        logger.error("DB insert failed for document: %s", exc)
        raise HTTPException(status_code=500, detail="Lỗi lưu thông tin tài liệu vào database")

    return {
        "data": _doc_row_to_dict(doc),
        "message": f"Đã tải lên tài liệu '{title}' thành công",
    }


# ---------------------------------------------------------------------------
# GET /{id} — Document detail
# ---------------------------------------------------------------------------

@router.get("/{doc_id}")
async def get_document(
    doc_id: int,
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    row = await conn.fetchrow(
        """
        SELECT d.*,
               u.full_name AS uploaded_by_name,
               u.email     AS uploaded_by_email,
               parent.title AS parent_title
        FROM documents d
        LEFT JOIN users u ON u.id = d.uploaded_by
        LEFT JOIN documents parent ON parent.id = d.parent_id
        WHERE d.id = $1
        """,
        doc_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Tài liệu không tồn tại")
    return {"data": _doc_row_to_dict(row)}


# ---------------------------------------------------------------------------
# GET /{id}/download — Download file
# ---------------------------------------------------------------------------

@router.get("/{doc_id}/download")
async def download_document(
    doc_id: int,
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    row = await conn.fetchrow(
        "SELECT file_path, file_name, mime_type, is_public FROM documents WHERE id = $1",
        doc_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Tài liệu không tồn tại")

    abs_path = Path("/data/files") / row["file_path"]
    if not abs_path.exists():
        logger.error("Document file missing on disk: %s", abs_path)
        raise HTTPException(
            status_code=404,
            detail="File vật lý không tìm thấy trên server. Vui lòng liên hệ IT.",
        )

    return FileResponse(
        path=str(abs_path),
        filename=row["file_name"],
        media_type=row["mime_type"] or "application/octet-stream",
    )


# ---------------------------------------------------------------------------
# DELETE /{id} — Delete document (admin only)
# ---------------------------------------------------------------------------

@router.delete("/{doc_id}", status_code=200)
async def delete_document(
    doc_id: int,
    token_data: TokenData = Depends(require_role("admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    row = await conn.fetchrow(
        "SELECT id, file_path, title FROM documents WHERE id = $1", doc_id
    )
    if not row:
        raise HTTPException(status_code=404, detail="Tài liệu không tồn tại")

    # Check if any child versions reference this document
    child_count = await conn.fetchval(
        "SELECT COUNT(*) FROM documents WHERE parent_id = $1", doc_id
    )
    if child_count:
        raise HTTPException(
            status_code=409,
            detail=f"Không thể xoá: tài liệu này có {child_count} phiên bản con. Xoá các phiên bản con trước.",
        )

    await conn.execute("DELETE FROM documents WHERE id = $1", doc_id)

    # Remove physical file
    abs_path = Path("/data/files") / row["file_path"]
    try:
        if abs_path.exists():
            os.remove(abs_path)
    except OSError as exc:
        logger.warning("Could not delete document file %s: %s", abs_path, exc)

    return {"data": {"id": doc_id}, "message": f"Đã xoá tài liệu '{row['title']}'"}


# ---------------------------------------------------------------------------
# GET /by-entity/{ref_type}/{ref_id} — Documents linked to an entity
# ---------------------------------------------------------------------------

@router.get("/by-entity/{ref_type}/{ref_id}")
async def documents_by_entity(
    ref_type: str,
    ref_id: int,
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    rows = await conn.fetch(
        """
        SELECT d.*,
               u.full_name AS uploaded_by_name
        FROM documents d
        LEFT JOIN users u ON u.id = d.uploaded_by
        WHERE d.ref_type = $1 AND d.ref_id = $2
        ORDER BY d.version DESC, d.created_at DESC
        """,
        ref_type,
        ref_id,
    )
    return {
        "data": {
            "items": [_doc_row_to_dict(r) for r in rows],
            "total": len(rows),
            "ref_type": ref_type,
            "ref_id": ref_id,
        }
    }
