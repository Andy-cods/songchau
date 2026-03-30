"""
File Service — handle file uploads with validation, storage, and metadata tracking.

Files are stored on disk under settings.FILES_BASE_PATH and tracked in the
file_meta table with SHA-256 checksums.
"""

from __future__ import annotations

import hashlib
import logging
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import aiofiles
import asyncpg
from fastapi import UploadFile

from app.core.config import settings

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

ALLOWED_MIME_TYPES: set[str] = {
    # PDF
    "application/pdf",
    # Excel
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",  # .xlsx
    "application/vnd.ms-excel",  # .xls
    "application/vnd.ms-excel.sheet.macroEnabled.12",  # .xlsm
    # CSV
    "text/csv",
    # Images
    "image/jpeg",
    "image/png",
    "image/webp",
}

# Additional extension-based validation
ALLOWED_EXTENSIONS: set[str] = {
    ".pdf", ".xlsx", ".xls", ".xlsm", ".csv",
    ".jpg", ".jpeg", ".png", ".webp",
}

MAX_FILE_SIZE: int = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024  # Default: 50 MB


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------

class FileValidationError(Exception):
    """Lỗi validation khi upload file."""


class FileStorageError(Exception):
    """Lỗi khi lưu file lên disk."""


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

def _get_extension(filename: str) -> str:
    """Extract lowercase file extension."""
    return Path(filename).suffix.lower()


def _validate_file(filename: str, content_type: str | None, file_size: int) -> None:
    """
    Validate file before saving.

    Raises:
        FileValidationError: If any validation fails.
    """
    if not filename or not filename.strip():
        raise FileValidationError("Tên file không được để trống")

    # Extension check
    ext = _get_extension(filename)
    if ext not in ALLOWED_EXTENSIONS:
        raise FileValidationError(
            f"Loại file '{ext}' không được hỗ trợ. "
            f"Chấp nhận: {', '.join(sorted(ALLOWED_EXTENSIONS))}"
        )

    # MIME type check (if provided)
    if content_type and content_type not in ALLOWED_MIME_TYPES:
        # Be lenient: some browsers send wrong MIME types
        logger.warning(
            "MIME type '%s' không trong danh sách cho phép, nhưng extension '%s' hợp lệ",
            content_type, ext,
        )

    # Size check
    if file_size > MAX_FILE_SIZE:
        max_mb = settings.MAX_UPLOAD_SIZE_MB
        actual_mb = round(file_size / (1024 * 1024), 1)
        raise FileValidationError(
            f"File quá lớn ({actual_mb} MB). Giới hạn tối đa: {max_mb} MB"
        )

    if file_size == 0:
        raise FileValidationError("File trống (0 bytes)")


def _compute_checksum(data: bytes) -> str:
    """Compute SHA-256 checksum of file content."""
    return hashlib.sha256(data).hexdigest()


# ---------------------------------------------------------------------------
# Storage
# ---------------------------------------------------------------------------

def _build_storage_path(ref_type: str, stored_filename: str) -> str:
    """Build the storage path relative to FILES_BASE_PATH."""
    # Organize files by ref_type and date
    today = datetime.now(timezone.utc).strftime("%Y/%m")
    return os.path.join(ref_type, today, stored_filename)


async def _save_to_disk(relative_path: str, content: bytes) -> str:
    """
    Save file content to disk.

    Returns:
        Absolute path of the saved file.
    """
    absolute_path = os.path.join(settings.FILES_BASE_PATH, relative_path)
    dir_path = os.path.dirname(absolute_path)

    try:
        os.makedirs(dir_path, exist_ok=True)
    except OSError as e:
        raise FileStorageError(f"Không thể tạo thư mục {dir_path}: {e}") from e

    try:
        async with aiofiles.open(absolute_path, "wb") as f:
            await f.write(content)
    except IOError as e:
        raise FileStorageError(f"Không thể ghi file {absolute_path}: {e}") from e

    logger.debug("File saved: %s (%d bytes)", absolute_path, len(content))
    return absolute_path


# ---------------------------------------------------------------------------
# Main service function
# ---------------------------------------------------------------------------

async def save_upload(
    file: UploadFile,
    ref_type: str,
    ref_id: int,
    user_id: str,
    conn: asyncpg.Connection,
) -> dict[str, Any]:
    """
    Validate, save uploaded file to disk, and create file_meta record.

    Args:
        file: FastAPI UploadFile from the request.
        ref_type: Reference context (e.g. 'bqms_rfq', 'po', 'product').
        ref_id: ID of the referenced entity.
        user_id: UUID string of the uploading user.
        conn: Database connection.

    Returns:
        Dict with file metadata including id, filename, file_path, etc.

    Raises:
        FileValidationError: If the file fails validation.
        FileStorageError: If the file cannot be saved to disk.
    """
    original_filename = file.filename or "untitled"
    content_type = file.content_type or ""

    logger.info(
        "Upload file: name=%s, type=%s, ref=%s/%d, user=%s",
        original_filename, content_type, ref_type, ref_id, user_id,
    )

    # Read content
    content = await file.read()
    file_size = len(content)

    # Validate
    _validate_file(original_filename, content_type, file_size)

    # Generate unique stored filename
    ext = _get_extension(original_filename)
    stored_filename = f"{uuid.uuid4().hex}{ext}"

    # Compute checksum
    checksum = _compute_checksum(content)

    # Check for duplicate by checksum
    existing = await conn.fetchrow(
        """
        SELECT id, filename, file_path FROM file_meta
        WHERE checksum = $1 AND ref_type = $2 AND ref_id = $3
        """,
        checksum, ref_type, ref_id,
    )
    if existing:
        logger.info(
            "File trùng lặp phát hiện: checksum=%s, existing_id=%d",
            checksum[:16], existing["id"],
        )
        return {
            "id": existing["id"],
            "filename": existing["filename"],
            "file_path": existing["file_path"],
            "duplicate": True,
            "message": "File đã tồn tại (cùng nội dung)",
        }

    # Save to disk
    relative_path = _build_storage_path(ref_type, stored_filename)
    absolute_path = await _save_to_disk(relative_path, content)

    # Insert metadata record
    row = await conn.fetchrow(
        """
        INSERT INTO file_meta (
            filename, stored_filename, file_path, mime_type,
            file_size, checksum, ref_type, ref_id, uploaded_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::uuid)
        RETURNING id, filename, stored_filename, file_path, mime_type,
                  file_size, checksum, ref_type, ref_id, created_at
        """,
        original_filename,
        stored_filename,
        relative_path,
        content_type or "application/octet-stream",
        file_size,
        checksum,
        ref_type,
        ref_id,
        user_id,
    )

    result = dict(row)
    result["duplicate"] = False

    logger.info(
        "File uploaded: id=%d, name=%s, size=%d bytes, path=%s",
        result["id"], original_filename, file_size, relative_path,
    )

    return result


# ---------------------------------------------------------------------------
# File retrieval
# ---------------------------------------------------------------------------

async def get_file_info(
    conn: asyncpg.Connection,
    file_id: int,
) -> dict[str, Any] | None:
    """
    Get file metadata by ID.

    Returns:
        File metadata dict or None if not found.
    """
    row = await conn.fetchrow(
        """
        SELECT fm.*, u.full_name AS uploaded_by_name
        FROM file_meta fm
        LEFT JOIN users u ON u.id = fm.uploaded_by
        WHERE fm.id = $1
        """,
        file_id,
    )
    if not row:
        return None

    result = dict(row)

    # Build download URL
    if settings.FILES_BASE_URL:
        result["download_url"] = f"{settings.FILES_BASE_URL}/{result['file_path']}"
    else:
        result["download_url"] = f"/api/v1/files/{file_id}/download"

    return result


async def get_file_content(
    conn: asyncpg.Connection,
    file_id: int,
) -> tuple[dict[str, Any], bytes] | None:
    """
    Get file metadata and content by ID.

    Returns:
        Tuple of (metadata_dict, content_bytes) or None if not found.
    """
    info = await get_file_info(conn, file_id)
    if not info:
        return None

    absolute_path = os.path.join(settings.FILES_BASE_PATH, info["file_path"])

    if not os.path.exists(absolute_path):
        logger.error("File not found on disk: %s (id=%d)", absolute_path, file_id)
        return None

    async with aiofiles.open(absolute_path, "rb") as f:
        content = await f.read()

    return info, content
