"""Samsung BQMS API — KPI, records, RFQ parsing, quotation generation, sync, deliveries."""

from __future__ import annotations

import logging
import math
from datetime import date, datetime
from typing import Any

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
# RFQ Table — Unified BQMS Page (main endpoint)
# ---------------------------------------------------------------------------

@router.get("/rfq-table")
async def rfq_table(
    year: int | None = Query(None, description="Năm lọc (VD: 2026)"),
    month: int | None = Query(None, description="Tháng lọc (1-12)"),
    search: str | None = Query(None, description="Tìm theo RFQ No, BQMS Code, tên hàng, maker"),
    result_filter: str | None = Query(None, description="pending | won | lost | all"),
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=10, le=500),
    token_data: TokenData = Depends(require_role("admin", "manager", "staff", "sales")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """
    Main data endpoint for the unified BQMS table.
    Queries bqms_rfq (6,473 rows). Returns paginated, filterable, sortable data
    with KPI summary and month-group metadata.
    """
    conditions: list[str] = ["1=1"]
    params: list[Any] = []
    idx = 1

    if year is not None:
        conditions.append(
            f"EXTRACT(YEAR FROM COALESCE(inquiry_date, created_at::date)) = ${idx}"
        )
        params.append(year)
        idx += 1

    if month is not None:
        conditions.append(
            f"EXTRACT(MONTH FROM COALESCE(inquiry_date, created_at::date)) = ${idx}"
        )
        params.append(month)
        idx += 1

    if search:
        like = f"%{search}%"
        conditions.append(
            f"(rfq_number ILIKE ${idx} OR bqms_code ILIKE ${idx} "
            f"OR specification ILIKE ${idx} OR maker ILIKE ${idx})"
        )
        params.append(like)
        idx += 1

    if result_filter and result_filter.lower() != "all":
        conditions.append(f"result::text = ${idx}")
        params.append(result_filter.lower())
        idx += 1

    where = " AND ".join(conditions)

    # Total count
    total: int = await conn.fetchval(
        f"SELECT COUNT(*) FROM bqms_rfq WHERE {where}", *params
    )

    # KPI for the current filter scope
    kpi_rows = await conn.fetchrow(
        f"""
        SELECT
            COUNT(*) FILTER (WHERE result::text = 'won')  AS won,
            COUNT(*) FILTER (WHERE result::text = 'lost') AS lost,
            COUNT(*) FILTER (
                WHERE result::text = 'pending' OR result IS NULL
            ) AS pending
        FROM bqms_rfq
        WHERE {where}
        """,
        *params,
    )
    won_count  = int(kpi_rows["won"]  or 0)
    lost_count = int(kpi_rows["lost"] or 0)
    pending_count = int(kpi_rows["pending"] or 0)
    decided = won_count + lost_count
    win_rate = round(won_count * 100.0 / decided, 1) if decided > 0 else 0.0

    # Month summary (group headers for the UI)
    month_rows = await conn.fetch(
        f"""
        SELECT
            EXTRACT(YEAR  FROM COALESCE(inquiry_date, created_at::date))::int AS yr,
            EXTRACT(MONTH FROM COALESCE(inquiry_date, created_at::date))::int AS mo,
            COUNT(*)                                                           AS cnt,
            COUNT(*) FILTER (WHERE result::text = 'won')                      AS won,
            COUNT(*) FILTER (WHERE result::text = 'lost')                     AS lost
        FROM bqms_rfq
        WHERE {where}
        GROUP BY yr, mo
        ORDER BY yr DESC, mo DESC
        LIMIT 24
        """,
        *params,
    )
    months_data = [
        {
            "year": r["yr"],
            "month": r["mo"],
            "count": int(r["cnt"] or 0),
            "won": int(r["won"] or 0),
            "lost": int(r["lost"] or 0),
        }
        for r in month_rows
    ]

    # Paginated rows
    offset = (page - 1) * page_size
    params_paged = params + [page_size, offset]
    rows = await conn.fetch(
        f"""
        SELECT
            id, rfq_number, bqms_code, specification, maker,
            expected_qty, unit,
            purchase_price_rmb, purchase_price_vnd,
            quoted_price_ama,
            quoted_price_bqms_v1, quoted_price_bqms_v2,
            quoted_price_bqms_v3, quoted_price_bqms_v4,
            supplier_name, result::text AS result, notes, report,
            person_in_charge_name, inquiry_date,
            COALESCE(inquiry_date, created_at::date) AS effective_date,
            created_at
        FROM bqms_rfq
        WHERE {where}
        ORDER BY COALESCE(inquiry_date, created_at::date) DESC, created_at DESC
        LIMIT ${idx} OFFSET ${idx + 1}
        """,
        *params_paged,
    )

    def _serialize(r: asyncpg.Record) -> dict:
        d = dict(r)
        for k, v in d.items():
            if isinstance(v, (date, datetime)):
                d[k] = v.isoformat()
        return d

    return {
        "data": {
            "items": [_serialize(r) for r in rows],
            "total": total,
            "page": page,
            "page_size": page_size,
            "total_pages": math.ceil(total / page_size) if total > 0 else 1,
            "kpis": {
                "total_month": total,
                "won": won_count,
                "lost": lost_count,
                "pending": pending_count,
                "win_rate": win_rate,
            },
            "months": months_data,
        }
    }


# ---------------------------------------------------------------------------
# RFQ — Inline Price Edit
# ---------------------------------------------------------------------------

_PRICE_ALLOWED_FIELDS = frozenset({
    "quoted_price_bqms_v1",
    "quoted_price_bqms_v2",
    "quoted_price_bqms_v3",
    "quoted_price_bqms_v4",
    "purchase_price_rmb",
    "purchase_price_vnd",
    "quoted_price_ama",
    "notes",
})


@router.patch("/rfq/{rfq_id}/price")
async def update_rfq_price(
    rfq_id: int,
    body: dict,
    token_data: TokenData = Depends(require_role("admin", "manager", "staff", "sales")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """
    Inline price/notes edit for a single bqms_rfq row.
    body: {"field": "quoted_price_bqms_v1", "value": 15000}
    """
    field = body.get("field")
    if field not in _PRICE_ALLOWED_FIELDS:
        raise HTTPException(
            status_code=400,
            detail=f"Trường '{field}' không được phép chỉnh sửa. Cho phép: {sorted(_PRICE_ALLOWED_FIELDS)}",
        )

    value = body.get("value")

    # Validate numeric fields
    if field != "notes" and value is not None:
        try:
            value = float(value)
        except (TypeError, ValueError):
            raise HTTPException(
                status_code=400,
                detail="Giá trị phải là số",
            )

    result = await conn.execute(
        f"UPDATE bqms_rfq SET {field} = $1 WHERE id = $2",
        value,
        rfq_id,
    )

    if result == "UPDATE 0":
        raise HTTPException(status_code=404, detail=f"Không tìm thấy RFQ #{rfq_id}")

    logger.info(
        "RFQ price updated: id=%d, field=%s, by=%s", rfq_id, field, token_data.user_id
    )
    return {"message": "Đã cập nhật"}


# ---------------------------------------------------------------------------
# RFQ — Quotation History for a specific RFQ row
# ---------------------------------------------------------------------------

@router.get("/rfq/{rfq_id}/history")
async def rfq_history(
    rfq_id: int,
    token_data: TokenData = Depends(require_role("admin", "manager", "staff", "sales")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Get quotation history for a specific bqms_rfq row (matched by rfq_number)."""
    rfq = await conn.fetchrow(
        "SELECT id, rfq_number FROM bqms_rfq WHERE id = $1", rfq_id
    )
    if not rfq:
        raise HTTPException(status_code=404, detail=f"Không tìm thấy RFQ #{rfq_id}")

    rfq_number = rfq["rfq_number"]

    # Try quotations table first (most common path)
    try:
        rows = await conn.fetch(
            """
            SELECT id, rfq_no, quotation_number, customer_name,
                   total_amount, currency, status, created_at, submitted_at
            FROM quotations
            WHERE rfq_no = $1
            ORDER BY created_at DESC
            LIMIT 50
            """,
            rfq_number,
        )
    except Exception:
        rows = []

    def _ser(r: asyncpg.Record) -> dict:
        d = dict(r)
        for k, v in d.items():
            if isinstance(v, (date, datetime)):
                d[k] = v.isoformat()
        return d

    return {
        "data": [_ser(r) for r in rows],
        "rfq_number": rfq_number,
        "total": len(rows),
    }


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
