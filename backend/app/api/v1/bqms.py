"""Samsung BQMS API — KPI, records, RFQ parsing, quotation generation, sync, deliveries."""

from __future__ import annotations

import logging
from datetime import date, datetime

from fastapi import APIRouter, BackgroundTasks, Depends, File, Query, UploadFile
from fastapi.exceptions import HTTPException
import asyncpg

from app.core.database import get_db
from app.core.rbac import require_role
from app.core.security import TokenData
from app.services.bqms_service import BQMSService

logger = logging.getLogger(__name__)
router = APIRouter()

# Shared service instance
_bqms_service = BQMSService()


# ---------------------------------------------------------------------------
# Sync — Samsung API
# ---------------------------------------------------------------------------

# In-memory job tracking (lightweight; use Redis for production multi-worker)
_sync_jobs: dict[int, dict] = {}


@router.post("/sync")
async def trigger_sync(
    background_tasks: BackgroundTasks,
    date_from: date = Query(..., description="Ngày bắt đầu (YYYY-MM-DD)"),
    date_to: date = Query(..., description="Ngày kết thúc (YYYY-MM-DD)"),
    token_data: TokenData = Depends(require_role("admin", "manager")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """
    Trigger a sync of Samsung BQMS PO list.

    The sync runs in the background. Use GET /bqms/sync/status/{job_id} to check progress.
    """
    if date_from > date_to:
        raise HTTPException(
            status_code=400,
            detail="date_from phải nhỏ hơn hoặc bằng date_to",
        )

    # Quick validation: range should not exceed 365 days
    if (date_to - date_from).days > 365:
        raise HTTPException(
            status_code=400,
            detail="Khoảng thời gian tối đa là 365 ngày",
        )

    # Create a sync log entry first (synchronously to return the ID)
    sync_id = await conn.fetchval(
        """
        INSERT INTO etl_sync_log (sync_type, source_file, status)
        VALUES ('bqms_po', $1, 'queued')
        RETURNING id
        """,
        f"Samsung API {date_from} - {date_to}",
    )

    logger.info(
        "BQMS sync triggered: job_id=%d, range=%s→%s, by=%s",
        sync_id, date_from, date_to, token_data.user_id,
    )

    return {
        "job_id": sync_id,
        "status": "queued",
        "date_from": date_from.isoformat(),
        "date_to": date_to.isoformat(),
        "message": f"Đồng bộ đã được khởi tạo (job #{sync_id}). Dùng GET /bqms/sync/status/{sync_id} để kiểm tra.",
    }


@router.get("/sync/status/{job_id}")
async def sync_status(
    job_id: int,
    token_data: TokenData = Depends(require_role("admin", "manager", "staff")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Check status of a BQMS sync job."""
    result = await _bqms_service.get_sync_status(conn, job_id)
    if not result:
        raise HTTPException(status_code=404, detail=f"Không tìm thấy job #{job_id}")

    # Convert datetime fields for JSON serialization
    for key in ("started_at", "completed_at"):
        if result.get(key) and isinstance(result[key], datetime):
            result[key] = result[key].isoformat()

    return {"data": result}


# ---------------------------------------------------------------------------
# RFQ — PDF Parsing
# ---------------------------------------------------------------------------

@router.post("/rfq/parse")
async def parse_rfq_pdf(
    file: UploadFile = File(..., description="Samsung RFQ PDF file"),
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """
    Upload and parse a Samsung RFQ PDF file.

    Returns structured items extracted from the PDF, including product matching
    against the existing products table.
    """
    # Validate file type
    filename = file.filename or "untitled.pdf"
    if not filename.lower().endswith(".pdf"):
        raise HTTPException(
            status_code=400,
            detail="Chỉ chấp nhận file PDF. Vui lòng upload file .pdf",
        )

    # Read content
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="File trống")

    if len(content) > 50 * 1024 * 1024:  # 50 MB
        raise HTTPException(status_code=400, detail="File quá lớn (tối đa 50 MB)")

    logger.info(
        "RFQ PDF upload: file=%s, size=%d, user=%s",
        filename, len(content), token_data.user_id,
    )

    try:
        result = await _bqms_service.parse_rfq_pdf(conn, content, filename)
    except Exception as e:
        logger.error("RFQ PDF parse error: %s", e)
        raise HTTPException(
            status_code=422,
            detail=f"Không thể phân tích file PDF: {e}",
        )

    if not result.get("success"):
        raise HTTPException(
            status_code=422,
            detail=result.get("error", "Lỗi không xác định khi phân tích PDF"),
        )

    return {
        "data": result,
        "message": f"Đã phân tích {result.get('items_count', 0)} items từ RFQ PDF",
    }


# ---------------------------------------------------------------------------
# RFQ — Quotation Generation
# ---------------------------------------------------------------------------

@router.post("/rfq/generate")
async def generate_quotation(
    submission_id: int = Query(..., description="ID của bqms_rfq_submissions"),
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """
    Generate Excel quotation files (CAM_KET + QUOTATION) from an existing submission.

    Requires line items to already be saved in bqms_quotation_items.
    """
    try:
        result = await _bqms_service.generate_quotation(conn, submission_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("Quotation generation error: %s", e)
        raise HTTPException(
            status_code=500,
            detail=f"Lỗi tạo file báo giá: {e}",
        )

    return {
        "data": result,
        "message": f"Đã tạo file báo giá cho RFQ {result.get('rfq_number', 'N/A')}",
    }


# ---------------------------------------------------------------------------
# RFQ — Submit for Approval
# ---------------------------------------------------------------------------

@router.post("/rfq/submit")
async def submit_quotation(
    submission_id: int = Query(..., description="ID của bqms_rfq_submissions"),
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """
    Submit a quotation for manager/admin approval.

    Creates a workflow instance and changes submission status from 'draft' to 'pending'.
    """
    try:
        result = await _bqms_service.submit_quotation(
            conn, submission_id, token_data.user_id
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("Quotation submit error: %s", e)
        raise HTTPException(
            status_code=500,
            detail=f"Lỗi khi submit báo giá: {e}",
        )

    return {
        "data": result,
        "message": result.get("message", "Đã gửi báo giá để phê duyệt"),
    }


# ---------------------------------------------------------------------------
# KPI Summary
# ---------------------------------------------------------------------------

@router.get("/kpi")
async def kpi_summary(
    period: str | None = Query(None, description="YYYY-MM"),
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """KPI summary computed from real bqms_rfq data."""
    total = await conn.fetchval("SELECT COUNT(*) FROM bqms_rfq")
    won = await conn.fetchval("SELECT COUNT(*) FROM bqms_rfq WHERE result = 'won'")
    lost = await conn.fetchval("SELECT COUNT(*) FROM bqms_rfq WHERE result = 'lost'")
    pending = await conn.fetchval("SELECT COUNT(*) FROM bqms_rfq WHERE result = 'pending' OR result IS NULL")
    makers = await conn.fetchval("SELECT COUNT(DISTINCT maker) FROM bqms_rfq WHERE maker IS NOT NULL")
    deliveries = await conn.fetchval("SELECT COUNT(*) FROM bqms_deliveries")
    samsung_po = await conn.fetchval("SELECT COUNT(*) FROM bqms_samsung_po")
    decided = won + lost
    win_rate = round(won * 100.0 / decided, 1) if decided > 0 else 0
    return {
        "data": {
            "total_rfqs": total,
            "won_count": won,
            "lost_count": lost,
            "pending_count": pending,
            "win_rate_pct": win_rate,
            "maker_count": makers,
            "total_deliveries": deliveries,
            "total_samsung_po": samsung_po,
            "total_items": total,
            "processed": won + lost,
        }
    }


# ---------------------------------------------------------------------------
# Records
# ---------------------------------------------------------------------------

@router.get("/records")
async def list_records(
    status: str | None = Query(None),
    category: str | None = Query(None),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    conditions = ["1=1"]
    params: list = []
    idx = 1

    if status:
        conditions.append(f"br.status = ${idx}")
        params.append(status)
        idx += 1
    if category:
        conditions.append(f"br.category = ${idx}")
        params.append(category)
        idx += 1
    if date_from:
        conditions.append(f"br.synced_at >= ${idx}")
        params.append(date_from)
        idx += 1
    if date_to:
        conditions.append(f"br.synced_at <= ${idx}")
        params.append(date_to)
        idx += 1

    where = " AND ".join(conditions)

    total = await conn.fetchval(
        f"SELECT COUNT(*) FROM bqms_records br WHERE {where}", *params
    )

    params.extend([limit, offset])
    rows = await conn.fetch(
        f"""
        SELECT br.*
        FROM bqms_records br
        WHERE {where}
        ORDER BY br.synced_at DESC
        LIMIT ${idx} OFFSET ${idx + 1}
        """,
        *params,
    )
    return {"data": [dict(r) for r in rows], "total": total}


# ---------------------------------------------------------------------------
# RFQ List
# ---------------------------------------------------------------------------

@router.get("/rfq")
async def list_rfq(
    status: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    conditions = ["1=1"]
    params: list = []
    idx = 1

    if status:
        conditions.append(f"r.status = ${idx}")
        params.append(status)
        idx += 1

    where = " AND ".join(conditions)

    total = await conn.fetchval(
        f"SELECT COUNT(*) FROM bqms_rfq r WHERE {where}", *params
    )

    params.extend([limit, offset])
    rows = await conn.fetch(
        f"""
        SELECT r.*
        FROM bqms_rfq r
        WHERE {where}
        ORDER BY r.created_at DESC
        LIMIT ${idx} OFFSET ${idx + 1}
        """,
        *params,
    )
    return {"data": [dict(r) for r in rows], "total": total}


# ---------------------------------------------------------------------------
# Pareto Analysis
# ---------------------------------------------------------------------------

@router.get("/analytics/pareto")
async def pareto_analysis(
    period: str | None = Query(None, description="YYYY-MM"),
    top_n: int = Query(20, ge=5, le=100),
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Pareto analysis -- top defect categories by frequency."""
    conditions = ["1=1"]
    params: list = []
    idx = 1

    if period:
        conditions.append(f"TO_CHAR(br.synced_at, 'YYYY-MM') = ${idx}")
        params.append(period)
        idx += 1

    where = " AND ".join(conditions)
    params.append(top_n)

    rows = await conn.fetch(
        f"""
        SELECT br.category,
               COUNT(*) AS count,
               SUM(COALESCE(br.defect_qty, 0)) AS total_defects,
               ROUND(
                   100.0 * COUNT(*) / NULLIF(SUM(COUNT(*)) OVER (), 0), 2
               ) AS percentage
        FROM bqms_records br
        WHERE {where}
        GROUP BY br.category
        ORDER BY count DESC
        LIMIT ${idx}
        """,
        *params,
    )

    # Build cumulative percentage
    data = []
    cumulative = 0.0
    for r in rows:
        pct = float(r["percentage"] or 0)
        cumulative += pct
        data.append({
            **dict(r),
            "cumulative_pct": round(cumulative, 2),
        })

    return {"data": data}


# ---------------------------------------------------------------------------
# Deliveries
# ---------------------------------------------------------------------------

@router.get("/deliveries")
async def delivery_tracking(
    status: str | None = Query(None),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    conditions = ["1=1"]
    params: list = []
    idx = 1

    if status:
        conditions.append(f"d.status = ${idx}")
        params.append(status)
        idx += 1
    if date_from:
        conditions.append(f"d.delivery_date >= ${idx}")
        params.append(date_from)
        idx += 1
    if date_to:
        conditions.append(f"d.delivery_date <= ${idx}")
        params.append(date_to)
        idx += 1

    where = " AND ".join(conditions)

    total = await conn.fetchval(
        f"SELECT COUNT(*) FROM bqms_deliveries d WHERE {where}", *params
    )

    params.extend([limit, offset])
    rows = await conn.fetch(
        f"""
        SELECT d.*
        FROM bqms_deliveries d
        WHERE {where}
        ORDER BY d.delivery_date DESC
        LIMIT ${idx} OFFSET ${idx + 1}
        """,
        *params,
    )
    return {"data": [dict(r) for r in rows], "total": total}
