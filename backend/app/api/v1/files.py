"""Files API — upload and retrieve files with validation and metadata tracking."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile
from fastapi.exceptions import HTTPException
from fastapi.responses import Response
import asyncpg

from app.core.database import get_db
from app.core.rbac import require_role
from app.core.security import TokenData
from app.services.file_service import (
    FileStorageError,
    FileValidationError,
    get_file_content,
    get_file_info,
    save_upload,
)

logger = logging.getLogger(__name__)
router = APIRouter()


# ---------------------------------------------------------------------------
# Upload
# ---------------------------------------------------------------------------

@router.post("/upload")
async def upload_file(
    file: UploadFile = File(..., description="File cần upload"),
    ref_type: str = Form(..., description="Loại tham chiếu: bqms_rfq, po, product, ..."),
    ref_id: int = Form(..., description="ID của entity tham chiếu"),
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """
    Upload a file with validation.

    Supports: PDF, Excel (.xlsx, .xls, .xlsm), CSV, Images (JPEG, PNG, WebP).
    Maximum size: 50 MB (configurable).

    The file is stored on disk and tracked in the file_meta table with a SHA-256 checksum.
    Duplicate files (same content for the same ref_type/ref_id) are detected and returned
    without re-saving.
    """
    valid_ref_types = {
        "bqms_rfq", "bqms_submission", "bqms_delivery",
        "purchase_order", "po", "product", "supplier",
        "general",
    }
    if ref_type not in valid_ref_types:
        raise HTTPException(
            status_code=400,
            detail=f"ref_type không hợp lệ. Chấp nhận: {', '.join(sorted(valid_ref_types))}",
        )

    try:
        result = await save_upload(
            file=file,
            ref_type=ref_type,
            ref_id=ref_id,
            user_id=token_data.user_id,
            conn=conn,
        )
    except FileValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except FileStorageError as e:
        logger.error("File storage error: %s", e)
        raise HTTPException(status_code=500, detail=f"Lỗi lưu file: {e}")
    except Exception as e:
        logger.exception("Unexpected file upload error")
        raise HTTPException(status_code=500, detail=f"Lỗi không xác định: {e}")

    status_code = 200 if result.get("duplicate") else 201

    return {
        "data": result,
        "message": (
            "File đã tồn tại (cùng nội dung)"
            if result.get("duplicate")
            else "Upload thành công"
        ),
    }


# ---------------------------------------------------------------------------
# Get file info
# ---------------------------------------------------------------------------

@router.get("/{file_id}")
async def get_file(
    file_id: int,
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """
    Get file metadata and download URL.
    """
    info = await get_file_info(conn, file_id)
    if not info:
        raise HTTPException(status_code=404, detail=f"Không tìm thấy file #{file_id}")

    return {"data": info}


# ---------------------------------------------------------------------------
# Download file
# ---------------------------------------------------------------------------

@router.get("/{file_id}/download")
async def download_file(
    file_id: int,
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """
    Download file content by ID.

    Returns the raw file bytes with appropriate Content-Type and Content-Disposition headers.
    """
    result = await get_file_content(conn, file_id)
    if not result:
        raise HTTPException(status_code=404, detail=f"Không tìm thấy file #{file_id}")

    info, content = result

    return Response(
        content=content,
        media_type=info.get("mime_type", "application/octet-stream"),
        headers={
            "Content-Disposition": f'attachment; filename="{info["filename"]}"',
            "Content-Length": str(len(content)),
        },
    )
