"""
OCR Service API (M38) — Document OCR using Gemini Vision.

Endpoints:
  POST /extract                   — Upload image/PDF → extract structured data via Gemini Vision
  GET  /results                   — List OCR results (paginated)
  GET  /results/{id}              — OCR result detail
"""

from __future__ import annotations

import base64
import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import asyncpg
import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile

from app.core.database import get_db
from app.core.rbac import require_role
from app.core.security import TokenData

logger = logging.getLogger(__name__)
router = APIRouter()

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = "gemini-1.5-flash"
GEMINI_ENDPOINT = (
    f"https://generativelanguage.googleapis.com/v1beta/models/"
    f"{GEMINI_MODEL}:generateContent?key={GEMINI_API_KEY}"
)

OCR_DIR = Path("/data/files/ocr")
OCR_DIR.mkdir(parents=True, exist_ok=True)

ALLOWED_MIME_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "application/pdf",
}

MAX_FILE_SIZE_MB = 20

# Extraction prompt — instructs Gemini to return structured JSON
EXTRACTION_PROMPT = """
Bạn là chuyên gia trích xuất dữ liệu từ tài liệu thương mại.
Hãy phân tích hình ảnh/tài liệu và trích xuất thông tin có cấu trúc.

Trả về JSON với các trường sau (điền null nếu không tìm thấy):
{
  "document_type": "invoice|purchase_order|quotation|customs|delivery_note|other",
  "document_number": "...",
  "document_date": "YYYY-MM-DD",
  "vendor_name": "...",
  "vendor_tax_code": "...",
  "buyer_name": "...",
  "buyer_tax_code": "...",
  "total_amount": 0.0,
  "currency": "VND|USD|EUR|...",
  "tax_amount": 0.0,
  "line_items": [
    {
      "description": "...",
      "quantity": 0.0,
      "unit": "...",
      "unit_price": 0.0,
      "amount": 0.0
    }
  ],
  "notes": "...",
  "raw_text_summary": "Tóm tắt nội dung tài liệu"
}

CHỈ trả về JSON thuần túy, không có markdown, không có giải thích thêm.
"""


# ---------------------------------------------------------------------------
# Helper — call Gemini Vision API
# ---------------------------------------------------------------------------

async def _call_gemini_vision(
    file_bytes: bytes,
    mime_type: str,
) -> tuple[dict, str, float]:
    """
    Send file to Gemini Vision and return (extracted_data, raw_text, confidence).
    Raises HTTPException on API errors.
    """
    if not GEMINI_API_KEY:
        raise HTTPException(
            status_code=503,
            detail="Gemini API key chưa được cấu hình (GEMINI_API_KEY)",
        )

    b64_data = base64.b64encode(file_bytes).decode("utf-8")

    payload = {
        "contents": [
            {
                "parts": [
                    {"text": EXTRACTION_PROMPT},
                    {
                        "inlineData": {
                            "mimeType": mime_type,
                            "data": b64_data,
                        }
                    },
                ]
            }
        ],
        "generationConfig": {
            "temperature": 0.1,
            "maxOutputTokens": 4096,
        },
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        try:
            resp = await client.post(GEMINI_ENDPOINT, json=payload)
            resp.raise_for_status()
        except httpx.TimeoutException:
            raise HTTPException(status_code=504, detail="Gemini API timeout")
        except httpx.HTTPStatusError as exc:
            logger.error("Gemini API error: %s — %s", exc.response.status_code, exc.response.text)
            raise HTTPException(
                status_code=502,
                detail=f"Gemini API lỗi: {exc.response.status_code}",
            )

    result = resp.json()

    try:
        raw_text = result["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError):
        raise HTTPException(status_code=502, detail="Không đọc được kết quả từ Gemini API")

    # Parse JSON from response
    extracted_data: dict = {}
    clean_text = raw_text.strip()
    # Strip markdown code fences if present
    if clean_text.startswith("```"):
        lines = clean_text.split("\n")
        clean_text = "\n".join(lines[1:-1]) if len(lines) > 2 else clean_text

    try:
        extracted_data = json.loads(clean_text)
        confidence = 85.0  # baseline confidence for successful parse
    except json.JSONDecodeError:
        logger.warning("Gemini returned non-JSON: %s", raw_text[:200])
        extracted_data = {"raw_text_summary": raw_text}
        confidence = 40.0

    return extracted_data, raw_text, confidence


# ---------------------------------------------------------------------------
# POST /extract  — Upload and extract
# ---------------------------------------------------------------------------

@router.post("/extract")
async def extract_document(
    file: UploadFile = File(..., description="Hình ảnh hoặc PDF cần OCR"),
    document_id: Optional[int] = Form(None, description="ID tài liệu trong bảng documents (tuỳ chọn)"),
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """
    Tải lên file hình ảnh/PDF và trích xuất dữ liệu có cấu trúc qua Gemini Vision.
    Kết quả được lưu vào bảng ocr_results.
    """
    # Validate content type
    content_type = file.content_type or ""
    if content_type not in ALLOWED_MIME_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Loại file không hỗ trợ: {content_type}. Chấp nhận: {', '.join(sorted(ALLOWED_MIME_TYPES))}",
        )

    # Validate document_id exists if provided
    if document_id is not None:
        doc_exists = await conn.fetchval(
            "SELECT id FROM documents WHERE id = $1", document_id
        )
        if not doc_exists:
            raise HTTPException(status_code=404, detail="Không tìm thấy tài liệu với document_id đã cho")

    # Read file
    file_bytes = await file.read()
    file_size_mb = len(file_bytes) / (1024 * 1024)
    if file_size_mb > MAX_FILE_SIZE_MB:
        raise HTTPException(
            status_code=413,
            detail=f"File quá lớn ({file_size_mb:.1f} MB). Tối đa {MAX_FILE_SIZE_MB} MB",
        )

    file_name = file.filename or "unknown_file"

    # Create pending record first
    record = await conn.fetchrow(
        """
        INSERT INTO ocr_results (
            document_id, file_name, ocr_engine,
            extracted_data, status, created_by
        )
        VALUES ($1, $2, 'gemini_vision', '{}', 'processing', $3)
        RETURNING id, created_at
        """,
        document_id,
        file_name,
        token_data.user_id,
    )
    ocr_id = record["id"]

    # Call Gemini Vision
    try:
        extracted_data, raw_text, confidence = await _call_gemini_vision(
            file_bytes, content_type
        )
        status = "completed"
        error_message = None
    except HTTPException as exc:
        # Update record as failed and re-raise
        await conn.execute(
            """
            UPDATE ocr_results
            SET status = 'failed', error_message = $1, processed_at = NOW()
            WHERE id = $2
            """,
            exc.detail,
            ocr_id,
        )
        raise
    except Exception as exc:  # noqa: BLE001
        err_msg = str(exc)
        await conn.execute(
            """
            UPDATE ocr_results
            SET status = 'failed', error_message = $1, processed_at = NOW()
            WHERE id = $2
            """,
            err_msg,
            ocr_id,
        )
        logger.exception("OCR processing error for record %s", ocr_id)
        raise HTTPException(status_code=500, detail=f"Lỗi xử lý OCR: {err_msg}")

    # Update record with results
    updated = await conn.fetchrow(
        """
        UPDATE ocr_results
        SET
            extracted_data = $1,
            raw_text = $2,
            confidence = $3,
            status = $4,
            processed_at = NOW()
        WHERE id = $5
        RETURNING id, file_name, ocr_engine, extracted_data, confidence, status, processed_at, created_at
        """,
        json.dumps(extracted_data),
        raw_text,
        confidence,
        status,
        ocr_id,
    )

    result_dict = dict(updated)
    if isinstance(result_dict.get("extracted_data"), str):
        try:
            result_dict["extracted_data"] = json.loads(result_dict["extracted_data"])
        except (json.JSONDecodeError, TypeError):
            pass

    return {
        "data": result_dict,
        "message": f"OCR trích xuất thành công cho '{file_name}'",
    }


# ---------------------------------------------------------------------------
# GET /results  — List OCR results
# ---------------------------------------------------------------------------

@router.get("/results")
async def list_ocr_results(
    status: Optional[str] = Query(None, description="pending | processing | completed | failed"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Danh sách kết quả OCR đã xử lý."""
    offset = (page - 1) * page_size

    where = "WHERE 1=1"
    params: list = []
    idx = 1

    if status:
        valid_statuses = {"pending", "processing", "completed", "failed"}
        if status not in valid_statuses:
            raise HTTPException(status_code=400, detail=f"status không hợp lệ: {status}")
        where += f" AND status = ${idx}"
        params.append(status)
        idx += 1

    count_row = await conn.fetchrow(
        f"SELECT COUNT(*) AS total FROM ocr_results {where}", *params
    )
    total = count_row["total"]

    rows = await conn.fetch(
        f"""
        SELECT
            r.id,
            r.document_id,
            r.file_name,
            r.ocr_engine,
            r.confidence,
            r.status,
            r.error_message,
            r.processed_at,
            r.created_at,
            u.full_name AS created_by_name
        FROM ocr_results r
        LEFT JOIN users u ON u.id = r.created_by
        {where}
        ORDER BY r.created_at DESC
        LIMIT ${idx} OFFSET ${idx + 1}
        """,
        *(params + [page_size, offset]),
    )

    return {
        "data": {
            "items": [dict(r) for r in rows],
            "total": total,
            "page": page,
            "page_size": page_size,
            "pages": (total + page_size - 1) // page_size,
        },
        "message": "Lấy danh sách kết quả OCR thành công",
    }


# ---------------------------------------------------------------------------
# GET /results/{id}  — OCR result detail
# ---------------------------------------------------------------------------

@router.get("/results/{ocr_id}")
async def get_ocr_result(
    ocr_id: int,
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Chi tiết một kết quả OCR bao gồm dữ liệu trích xuất đầy đủ và raw text."""
    row = await conn.fetchrow(
        """
        SELECT
            r.id,
            r.document_id,
            r.file_name,
            r.ocr_engine,
            r.extracted_data,
            r.raw_text,
            r.confidence,
            r.status,
            r.error_message,
            r.processed_at,
            r.created_by,
            r.created_at,
            u.full_name AS created_by_name
        FROM ocr_results r
        LEFT JOIN users u ON u.id = r.created_by
        WHERE r.id = $1
        """,
        ocr_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Không tìm thấy kết quả OCR")

    result = dict(row)
    if isinstance(result.get("extracted_data"), str):
        try:
            result["extracted_data"] = json.loads(result["extracted_data"])
        except (json.JSONDecodeError, TypeError):
            pass

    return {
        "data": result,
        "message": "Lấy chi tiết OCR thành công",
    }
