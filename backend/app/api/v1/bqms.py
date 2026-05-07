"""Samsung BQMS API — KPI, records, RFQ parsing, quotation generation, sync, deliveries."""

from __future__ import annotations

import io
import logging
import math
from datetime import date, datetime
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, File, Query, UploadFile
from fastapi.exceptions import HTTPException
from fastapi.responses import StreamingResponse
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

    # Check for already-running sync
    running = await conn.fetchval(
        "SELECT id FROM etl_sync_log WHERE sync_type = 'bqms_po' AND status = 'running' LIMIT 1"
    )
    if running:
        raise HTTPException(400, f"Đồng bộ đang chạy (job #{running}). Vui lòng đợi hoàn thành.")

    logger.info(
        "BQMS sync triggered: job_id=%d, range=%s→%s, by=%s",
        sync_id, date_from, date_to, token_data.user_id,
    )

    # Run Playwright sync in a separate thread (Playwright needs its own event loop)
    import threading

    def _thread_sync(sid: int):
        """Run Playwright sync in a dedicated thread with its own asyncio loop."""
        import asyncio as _aio

        async def _do_sync():
            import asyncpg as apg
            from app.etl.bqms_playwright import playwright_fetch_pos
            from app.tasks.bqms_sync import _upsert_pos, _update_sync_log
            from app.core.config import settings as cfg

            db_url = str(cfg.DATABASE_URL).replace("+asyncpg", "").replace("postgresql+asyncpg", "postgresql")
            bconn = await apg.connect(db_url)
            try:
                await bconn.execute(
                    "UPDATE etl_sync_log SET status = 'running', started_at = NOW() WHERE id = $1", sid
                )
            finally:
                await bconn.close()

            result = {"new_pos": 0, "updated_pos": 0, "status": "running"}
            try:
                po_list = await playwright_fetch_pos()
                new_list, upd = _upsert_pos(po_list)
                result["new_pos"] = len(new_list)
                result["updated_pos"] = upd
                result["status"] = "success"

                # Bridge: tất cả PO → bqms_deliveries (trang Giao Hàng)
                from app.tasks.bqms_sync import _bridge_po_to_deliveries
                new_del, upd_del = _bridge_po_to_deliveries(po_list)
                result["deliveries_created"] = new_del
                result["deliveries_updated"] = upd_del
            except Exception as exc:
                result["status"] = "error"
                result["error_message"] = str(exc)[:500]

            _update_sync_log(sid, result)

        _aio.run(_do_sync())

    t = threading.Thread(target=_thread_sync, args=(sync_id,), daemon=True)
    t.start()

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


@router.get("/sync/latest")
async def sync_latest(
    token_data: TokenData = Depends(require_role("admin", "manager", "staff")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Lấy kết quả đồng bộ gần nhất."""
    row = await conn.fetchrow(
        """
        SELECT id, sync_type, status, started_at, completed_at,
               rows_inserted, rows_updated, rows_skipped, error_message,
               EXTRACT(EPOCH FROM (COALESCE(completed_at, NOW()) - started_at))::int AS duration_seconds
        FROM etl_sync_log
        WHERE sync_type = 'bqms_po'
        ORDER BY started_at DESC
        LIMIT 1
        """
    )
    if not row:
        return {"data": None}

    result = dict(row)
    for key in ("started_at", "completed_at"):
        if result.get(key) and isinstance(result[key], datetime):
            result[key] = result[key].isoformat()

    return {"data": result}


@router.get("/sync/circuit")
async def sync_circuit_status(
    token_data: TokenData = Depends(require_role("admin", "manager")),
):
    """Trạng thái circuit breaker Samsung BQMS — bảo vệ tài khoản khỏi bị khóa."""
    from app.etl.bqms_playwright import _load_circuit, _BACKOFF_SECONDS
    import time as _time
    circuit = _load_circuit()
    failures = circuit.get("failures", 0)
    last_fail = circuit.get("last_failure_at", 0)

    if failures == 0:
        state = "closed"
        wait_remaining = 0
    else:
        idx = min(failures - 1, len(_BACKOFF_SECONDS) - 1)
        wait_total = _BACKOFF_SECONDS[idx]
        elapsed = _time.time() - last_fail
        if elapsed < wait_total:
            state = "open"
            wait_remaining = int(wait_total - elapsed)
        else:
            state = "half-open"
            wait_remaining = 0

    return {
        "state": state,
        "failures": failures,
        "last_error": circuit.get("last_error", ""),
        "wait_remaining_seconds": wait_remaining,
        "wait_remaining_minutes": wait_remaining // 60,
    }


@router.post("/sync/circuit/reset")
async def reset_circuit_breaker(
    token_data: TokenData = Depends(require_role("admin")),
):
    """Admin reset circuit breaker — cho phép thử login lại ngay."""
    from app.etl.bqms_playwright import _record_success
    _record_success()
    return {"message": "Circuit breaker đã reset. Có thể thử đồng bộ lại."}


@router.get("/sync/steps")
async def sync_steps(
    token_data: TokenData = Depends(require_role("admin", "manager", "staff")),
):
    """Trạng thái từng bước của đồng bộ Samsung — poll real-time."""
    from app.etl.bqms_playwright import get_sync_steps, STEP_DEFINITIONS
    data = get_sync_steps()
    data["definitions"] = STEP_DEFINITIONS
    return data


@router.get("/sync/history")
async def sync_history(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    token_data: TokenData = Depends(require_role("admin", "manager", "staff")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Lịch sử đồng bộ Samsung BQMS."""
    total = await conn.fetchval(
        "SELECT COUNT(*) FROM etl_sync_log WHERE sync_type = 'bqms_po'"
    )
    rows = await conn.fetch(
        """
        SELECT id, sync_type, status, started_at, completed_at,
               rows_inserted, rows_updated, rows_skipped, error_message,
               EXTRACT(EPOCH FROM (COALESCE(completed_at, NOW()) - started_at))::int AS duration_seconds
        FROM etl_sync_log
        WHERE sync_type = 'bqms_po'
        ORDER BY started_at DESC
        LIMIT $1 OFFSET $2
        """,
        limit, offset,
    )

    data = []
    for r in rows:
        d = dict(r)
        for key in ("started_at", "completed_at"):
            if d.get(key) and isinstance(d[key], datetime):
                d[key] = d[key].isoformat()
        data.append(d)

    return {"data": data, "total": total}


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

    # Group RFQs by maker — Pareto on supplier mix.
    # bqms_records does not have category/defect_qty cols; use bqms_rfq.maker
    # which is the meaningful dimension for our supplier-side workflow.
    where_rfq = where.replace('br.synced_at', 'r.created_at').replace('br.', 'r.')
    rows = await conn.fetch(
        f"""
        SELECT COALESCE(NULLIF(TRIM(r.maker), ''), 'Khong xac dinh') AS category,
               COUNT(*) AS count,
               SUM(COALESCE(r.expected_qty, 0))::numeric AS total_qty,
               ROUND(
                   100.0 * COUNT(*) / NULLIF(SUM(COUNT(*)) OVER (), 0), 2
               ) AS percentage
        FROM bqms_rfq r
        WHERE {where_rfq.replace('1=1', 'TRUE')}
        GROUP BY 1
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
        ORDER BY id DESC
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
        f"UPDATE bqms_rfq SET {field} = $1, updated_at = NOW() WHERE id = $2",
        value,
        rfq_id,
    )

    if result == "UPDATE 0":
        raise HTTPException(status_code=404, detail=f"Không tìm thấy RFQ #{rfq_id}")

    # Write to bqms_quote_log for vN price fields (round audit trail)
    # This powers the daily morning report's "báo giá hôm nay" counts.
    _ROUND_FIELDS = {
        "quoted_price_bqms_v1": 1,
        "quoted_price_bqms_v2": 2,
        "quoted_price_bqms_v3": 3,
        "quoted_price_bqms_v4": 4,
    }
    if field in _ROUND_FIELDS and value is not None:
        try:
            # Fetch current item_type so log captures TM/GC snapshot
            item_type = await conn.fetchval(
                "SELECT item_type FROM bqms_rfq WHERE id = $1", rfq_id
            )
            await conn.execute(
                """
                INSERT INTO bqms_quote_log
                  (rfq_id, round, quoted_price, quoted_currency, item_type, quoted_by, notes)
                VALUES ($1, $2, $3, 'USD', $4, $5, 'inline-edit from RFQ table')
                """,
                rfq_id, _ROUND_FIELDS[field], float(value), item_type, token_data.user_id,
            )
        except Exception as exc:
            logger.warning("quote_log insert failed for rfq=%s: %s", rfq_id, exc)

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

    # Query quotations table — include file paths for download/preview
    try:
        rows = await conn.fetch(
            """
            SELECT id, rfq_no, status, total_items, filled_items,
                   output_xlsx, output_pdf, created_at
            FROM quotations
            WHERE rfq_no = $1
            ORDER BY created_at DESC
            LIMIT 50
            """,
            rfq_number,
        )
    except Exception:
        rows = []

    import os

    def _ser(r: asyncpg.Record) -> dict:
        d = dict(r)
        for k, v in d.items():
            if isinstance(v, (date, datetime)):
                d[k] = v.isoformat()

        # Build file list from output directory
        files = []
        pdf_path = d.get("output_pdf")
        xlsx_path = d.get("output_xlsx")
        qid = d["id"]

        if pdf_path and os.path.exists(os.path.dirname(pdf_path)):
            out_dir = os.path.dirname(pdf_path)
            for fname in sorted(os.listdir(out_dir)):
                fpath = os.path.join(out_dir, fname)
                fsize = os.path.getsize(fpath) if os.path.isfile(fpath) else 0
                is_pdf = fname.endswith(".pdf")
                is_cam_ket = "cam_ket" in fname.lower()
                ftype = ("cam_ket_" if is_cam_ket else "quotation_") + ("pdf" if is_pdf else "xlsx")
                files.append({
                    "type": ftype,
                    "filename": fname,
                    "size": fsize,
                    "path": fpath,
                    "download_url": f"/api/v1/quotations/download/{qid}/{ftype}",
                    "preview_url": f"/api/v1/quotations/preview/{qid}/{ftype}" if is_pdf else None,
                })

        d["files"] = files
        return d

    return {
        "data": [_ser(r) for r in rows],
        "rfq_number": rfq_number,
        "total": len(rows),
    }


# ---------------------------------------------------------------------------
# Deliveries
# ---------------------------------------------------------------------------

# Status normalization: Vietnamese → English
_STATUS_NORM = {
    "chua_giao": "pending",
    "dang_giao": "in_transit",
    "da_giao": "delivered",
    "hoan_tat": "completed",
    "giao_mot_phan": "partial",
}

# Reverse map for DB queries: group → all DB enum values
_STATUS_GROUPS = {
    "pending": ("chua_giao", "pending"),
    "in_transit": ("dang_giao", "in_transit", "picked_up", "customs_clearance"),
    "delivered": ("da_giao", "delivered", "completed", "hoan_tat"),
}


def _build_delivery_filters(
    status: str | None, month: int | None, year: int | None,
    date_from: date | None = None, date_to: date | None = None,
) -> tuple[str, list]:
    """Build WHERE clause for delivery queries. Returns (where_sql, params)."""
    conditions = ["1=1"]
    params: list = []
    idx = 1

    if status:
        group = _STATUS_GROUPS.get(status)
        if group:
            placeholders = ", ".join(f"${idx + i}" for i in range(len(group)))
            conditions.append(f"d.delivery_status::text IN ({placeholders})")
            params.extend(group)
            idx += len(group)
        else:
            conditions.append(f"d.delivery_status::text = ${idx}")
            params.append(status)
            idx += 1
    if date_from:
        conditions.append(f"COALESCE(d.po_date, d.delivery_date) >= ${idx}")
        params.append(date_from)
        idx += 1
    if date_to:
        conditions.append(f"COALESCE(d.po_date, d.delivery_date) <= ${idx}")
        params.append(date_to)
        idx += 1
    if month:
        conditions.append(f"EXTRACT(MONTH FROM COALESCE(d.po_date, d.delivery_date)) = ${idx}")
        params.append(month)
        idx += 1
    if year:
        conditions.append(f"EXTRACT(YEAR FROM COALESCE(d.po_date, d.delivery_date)) = ${idx}")
        params.append(year)
        idx += 1

    return " AND ".join(conditions), params


@router.get("/deliveries/kpi")
async def delivery_kpi(
    status: str | None = Query(None),
    month: int | None = Query(None, ge=1, le=12),
    year: int | None = Query(None, ge=2020, le=2099),
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """KPI thống kê giao hàng — tính trên toàn bộ dữ liệu đã lọc (không phân trang)."""
    where, params = _build_delivery_filters(status, month, year)

    row = await conn.fetchrow(
        f"""
        SELECT
            COUNT(*)::int AS total_orders,
            COUNT(*) FILTER (
                WHERE d.delivery_status::text IN ('da_giao','delivered','completed','hoan_tat')
            )::int AS delivered_count,
            COUNT(*) FILTER (
                WHERE d.delivery_status::text IN ('dang_giao','in_transit','picked_up','customs_clearance')
            )::int AS in_transit_count,
            COUNT(*) FILTER (
                WHERE d.delivery_status::text IN ('chua_giao','pending')
            )::int AS pending_count,
            COALESCE(SUM(d.total_delivered_value_vnd) FILTER (
                WHERE d.delivery_status::text IN ('da_giao','delivered','completed','hoan_tat')
            ), 0)::bigint AS total_delivered_vnd,
            COALESCE(SUM(d.amount), 0)::bigint AS total_order_value
        FROM bqms_deliveries d
        WHERE {where}
        """,
        *params,
    )
    return dict(row)


@router.get("/deliveries/export")
async def export_deliveries_excel(
    status: str | None = Query(None),
    month: int | None = Query(None, ge=1, le=12),
    year: int | None = Query(None, ge=2020, le=2099),
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Xuất danh sách giao hàng ra Excel giống format THỐNG KÊ PO."""
    import openpyxl
    from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

    where, params = _build_delivery_filters(status, month, year)

    rows = await conn.fetch(
        f"""
        SELECT d.*
        FROM bqms_deliveries d
        WHERE {where}
        ORDER BY d.po_date DESC NULLS LAST, d.id DESC
        LIMIT 10000
        """,
        *params,
    )
    if len(rows) == 10000:
        raise HTTPException(400, "Quá nhiều bản ghi (>10,000). Vui lòng lọc theo tháng/năm/trạng thái.")

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "THỐNG KÊ PO"

    # Column mapping: DB column → Vietnamese header
    COL_MAP = [
        ("po_date", "Ngày PO"),
        ("po_number", "Số PO"),
        ("shipping_no", "Shipping No"),
        ("quotation_no", "Số QT"),
        ("bqms_code", "BQMS code"),
        ("specification", "Spec"),
        ("quantity", "SL"),
        ("unit", "Đơn vị"),
        ("unit_price", "Đơn giá"),
        ("amount", "Thành tiền"),
        ("sev_type", "SEV/T"),
        ("buyer_email", "MAIL PUR"),
        ("recipient_name", "TÊN NGƯỜI NHẬN"),
        ("receiving_warehouse", "KHO NHẬN"),
        ("buyer_phone", "SĐT PUR"),
        ("delivery_status", "TÌNH TRẠNG"),
        ("delivery_date", "NGÀY GIAO HÀNG"),
        ("actual_delivered_qty", "SL GIAO THỰC TẾ"),
        ("delivery_info", "THÔNG TIN GIAO HÀNG"),
        ("delivery_method", "CÁCH THỨC GIAO HÀNG"),
        ("country_origin", "XUẤT XỨ"),
        ("total_delivered_value_vnd", "TỔNG GIÁ TRỊ ĐÃ GIAO\n(VND)"),
    ]

    # Status display mapping
    STATUS_DISPLAY = {
        "chua_giao": "chưa giao", "pending": "chưa giao",
        "dang_giao": "đang giao", "in_transit": "đang giao",
        "picked_up": "đã lấy hàng", "customs_clearance": "thông quan",
        "da_giao": "đã giao", "delivered": "đã giao",
        "completed": "hoàn tất", "hoan_tat": "hoàn tất",
    }

    # Header styles
    header_font = Font(bold=True, size=11)
    header_fill = PatternFill(start_color="D6E4F0", end_color="D6E4F0", fill_type="solid")
    header_align = Alignment(horizontal="center", vertical="center", wrap_text=True)
    thin_border = Border(
        left=Side(style="thin"), right=Side(style="thin"),
        top=Side(style="thin"), bottom=Side(style="thin"),
    )

    # Write header
    for col_idx, (_, header) in enumerate(COL_MAP, 1):
        cell = ws.cell(row=1, column=col_idx, value=header)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = header_align
        cell.border = thin_border

    # Write data rows
    for row_idx, record in enumerate(rows, 2):
        rec = dict(record)
        for col_idx, (db_col, _) in enumerate(COL_MAP, 1):
            value = rec.get(db_col)
            if db_col == "delivery_status" and value:
                value = STATUS_DISPLAY.get(str(value), str(value))
            if db_col in ("po_date", "delivery_date") and value:
                if hasattr(value, "strftime"):
                    value = value.strftime("%d/%m/%Y")
            cell = ws.cell(row=row_idx, column=col_idx, value=value)
            cell.border = thin_border
            if db_col in ("quantity", "unit_price", "amount", "actual_delivered_qty", "total_delivered_value_vnd"):
                cell.number_format = "#,##0"
                cell.alignment = Alignment(horizontal="right")

    # Auto-fit column widths
    COL_WIDTHS = [12, 14, 14, 14, 18, 30, 8, 8, 12, 14, 8, 14, 18, 25, 14, 12, 14, 10, 25, 16, 10, 18]
    for col_idx, width in enumerate(COL_WIDTHS, 1):
        ws.column_dimensions[openpyxl.utils.get_column_letter(col_idx)].width = width

    # Freeze header row
    ws.freeze_panes = "A2"

    # Write to buffer
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)

    filename = f"Giao_hang_{month or 'all'}_{year or 'all'}.xlsx"
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/deliveries")
async def delivery_tracking(
    status: str | None = Query(None),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    month: int | None = Query(None, ge=1, le=12),
    year: int | None = Query(None, ge=2020, le=2099),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    where, params = _build_delivery_filters(status, month, year, date_from, date_to)
    idx = len(params) + 1

    total = await conn.fetchval(
        f"SELECT COUNT(*) FROM bqms_deliveries d WHERE {where}", *params
    )

    actual_offset = (page - 1) * limit if page > 1 else offset

    params.extend([limit, actual_offset])
    rows = await conn.fetch(
        f"""
        SELECT d.*
        FROM bqms_deliveries d
        WHERE {where}
        ORDER BY d.po_date DESC NULLS LAST, d.id DESC
        LIMIT ${idx} OFFSET ${idx + 1}
        """,
        *params,
    )

    # Normalize status for frontend
    data = []
    for r in rows:
        d = dict(r)
        raw_status = str(d.get("delivery_status", ""))
        d["delivery_status_normalized"] = _STATUS_NORM.get(raw_status, raw_status)
        data.append(d)

    return {"data": data, "total": total}


@router.post("/deliveries")
async def create_delivery(
    body: dict[str, Any],
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Tạo mới delivery record."""
    required = ["po_number", "bqms_code", "specification"]
    for f in required:
        if not body.get(f):
            raise HTTPException(400, f"Trường '{f}' là bắt buộc")

    row = await conn.fetchrow(
        """
        INSERT INTO bqms_deliveries (
            po_number, bqms_code, specification, quantity, unit,
            unit_price, delivery_status, delivery_date,
            shipping_no, sev_type, buyer_email, recipient_name,
            delivery_method, notes, data_source
        ) VALUES (
            $1, $2, $3, $4, $5,
            $6, $7::delivery_status, $8,
            $9, $10, $11, $12,
            $13, $14, 'manual'
        )
        RETURNING *
        """,
        body.get("po_number"),
        body.get("bqms_code"),
        body.get("specification"),
        body.get("quantity"),
        body.get("unit", "EA"),
        body.get("unit_price"),
        body.get("delivery_status", "chua_giao"),
        body.get("delivery_date"),
        body.get("shipping_no"),
        body.get("sev_type"),
        body.get("buyer_email"),
        body.get("recipient_name"),
        body.get("delivery_method"),
        body.get("notes"),
    )
    return {"data": dict(row), "message": "Đã tạo đơn giao hàng"}


@router.put("/deliveries/{delivery_id}")
async def update_delivery(
    delivery_id: int,
    body: dict[str, Any],
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Cập nhật delivery record với optimistic lock."""
    from app.core.concurrency import emit_record_changed

    existing = await conn.fetchrow(
        "SELECT id, version FROM bqms_deliveries WHERE id = $1", delivery_id
    )
    if not existing:
        raise HTTPException(404, "Đơn giao hàng không tồn tại")

    # Optimistic lock check (if client sends version)
    expected_version = body.pop("version", None)
    if expected_version is not None and existing["version"] != expected_version:
        raise HTTPException(
            409,
            f"Người khác vừa cập nhật đơn này (version DB: {existing['version']}, "
            f"client gửi: {expected_version}). Vui lòng tải lại."
        )

    ALLOWED_FIELDS = {
        "po_number", "bqms_code", "specification", "quantity", "unit",
        "unit_price", "delivery_status", "delivery_date", "shipping_no",
        "sev_type", "buyer_email", "recipient_name", "delivery_method",
        "notes", "actual_delivered_at", "actual_delivered_qty", "delivery_info",
    }

    sets = []
    params: list[Any] = []
    idx = 1
    for key, value in body.items():
        if key in ALLOWED_FIELDS:
            if key == "delivery_status":
                sets.append(f"{key} = ${idx}::delivery_status")
            else:
                sets.append(f"{key} = ${idx}")
            params.append(value)
            idx += 1

    if not sets:
        raise HTTPException(400, "Không có trường nào để cập nhật")

    sets.append("updated_at = NOW()")
    params.append(delivery_id)

    row = await conn.fetchrow(
        f"UPDATE bqms_deliveries SET {', '.join(sets)} WHERE id = ${idx} RETURNING *",
        *params,
    )

    # Emit real-time event
    await emit_record_changed("bqms_delivery", delivery_id, "updated", token_data.user_id)

    return {"data": dict(row), "message": "Đã cập nhật đơn giao hàng"}


@router.patch("/deliveries/{delivery_id}/status")
async def update_delivery_status(
    delivery_id: int,
    body: dict[str, Any],
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Cập nhật trạng thái giao hàng."""
    new_status = body.get("status")
    if not new_status:
        raise HTTPException(400, "Trường 'status' là bắt buộc")

    VALID_STATUSES = {
        "chua_giao", "dang_giao", "da_giao", "hoan_tat",
        "pending", "picked_up", "in_transit", "customs_clearance", "delivered", "completed",
    }
    if new_status not in VALID_STATUSES:
        raise HTTPException(400, f"Trạng thái không hợp lệ: {new_status}")

    existing = await conn.fetchrow(
        "SELECT id, delivery_status FROM bqms_deliveries WHERE id = $1", delivery_id
    )
    if not existing:
        raise HTTPException(404, "Đơn giao hàng không tồn tại")

    update_fields = "delivery_status = $2::delivery_status, updated_at = NOW()"
    params: list[Any] = [delivery_id, new_status]

    # Auto-set actual_delivered_at when marking as delivered/completed
    if new_status in ("da_giao", "delivered", "completed", "hoan_tat"):
        update_fields += ", actual_delivered_at = COALESCE(actual_delivered_at, NOW())"

    row = await conn.fetchrow(
        f"UPDATE bqms_deliveries SET {update_fields} WHERE id = $1 RETURNING *",
        *params,
    )

    # Real-time sync
    from app.core.concurrency import emit_record_changed
    await emit_record_changed("bqms_delivery", delivery_id, "status_changed", token_data.user_id,
                              metadata={"new_status": new_status})

    # Event-driven notification for manager + warehouse
    try:
        from app.services.event_notifications import dispatch_delivery_status_change
        await dispatch_delivery_status_change(
            conn, delivery_id, new_status, actor_user_id=str(token_data.user_id),
        )
    except Exception as exc:
        logger.warning("delivery-status notification failed: %s", exc)

    return {"data": dict(row), "message": f"Đã cập nhật trạng thái: {new_status}"}


# ---------------------------------------------------------------------------
# Contacts (DANH BẠ)
# ---------------------------------------------------------------------------

@router.get("/contacts")
async def list_contacts(
    q: str | None = Query(None),
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Danh bạ liên hệ Samsung — 1,028 contacts từ DANH BẠ sheet."""
    if q:
        rows = await conn.fetch(
            """
            SELECT * FROM bqms_contacts
            WHERE full_name ILIKE $1 OR email_username ILIKE $1 OR phone ILIKE $1
            ORDER BY full_name
            """,
            f"%{q}%",
        )
    else:
        rows = await conn.fetch("SELECT * FROM bqms_contacts ORDER BY full_name")
    return {"data": [dict(r) for r in rows], "total": len(rows)}


# ---------------------------------------------------------------------------
# Direct PO API — /bqms/po/* (sitemap-derived endpoints, item 1+2)
#
# Plan: BQMS_SITEMAP/BQMS_SITEMAP.md §2.2 / §2.3
# ---------------------------------------------------------------------------

from pydantic import BaseModel as _BaseModel, Field as _Field


class _POInfoItem(_BaseModel):
    poNo: str
    poSeq: str
    poStatus: str = "PO2"
    secureKey: str


class _ConfirmRequest(_BaseModel):
    pos: list[_POInfoItem] = _Field(..., min_length=1, max_length=200)


@router.get("/po/all")
async def fetch_all_pos_endpoint(
    date_from: str = Query(..., description="YYYYMMDD or YYYY-MM-DD"),
    date_to: str = Query(..., description="YYYYMMDD or YYYY-MM-DD"),
    status: str = Query("", description="'Y'=confirmed, 'N'=not, '' = both"),
    company_code: str = Query("", description="C5H0 / C5H2 / ..."),
    page_size: int = Query(99999, ge=10, le=99999),
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
):
    """Fetch ALL POs from Samsung BQMS for a date range (item 1).

    Read-only — calls Samsung selectPOAcceptList.do directly. Logs in via
    Playwright session, then issues a single httpx POST.
    """
    from app.etl.bqms_po_api import fetch_all_pos
    statuses = [s for s in (status or "").split(",") if s.strip()] or None
    pos = await fetch_all_pos(
        date_from=date_from,
        date_to=date_to,
        status_codes=statuses,
        company_code=company_code,
        page_size=page_size,
    )
    return {
        "data": {
            "items": pos,
            "total": len(pos),
            "confirmed": sum(1 for p in pos if p.get("SP_CONFIRM_FLAG") == "Y"),
            "not_confirmed": sum(1 for p in pos if p.get("SP_CONFIRM_FLAG") == "N"),
        }
    }


@router.post("/po/confirm")
async def confirm_pos_endpoint(
    body: _ConfirmRequest,
    token_data: TokenData = Depends(require_role("manager", "admin")),
):
    """Confirm a batch of POs on Samsung BQMS (item 2 — PRODUCTION WRITE).

    Manager / admin only. Each PO must include the latest secureKey from a
    fresh /po/all fetch — Samsung rejects stale tokens.
    """
    from app.etl.bqms_po_api import confirm_pos
    payload = [p.model_dump() for p in body.pos]
    try:
        result = await confirm_pos(payload)
    except Exception as exc:
        logger.exception("BQMS confirm_pos failed")
        raise HTTPException(status_code=502, detail=f"BQMS confirm error: {exc}")
    return {"data": result, "message": f"Đã gửi confirm cho {len(payload)} PO"}


@router.post("/po/cancel-confirm")
async def cancel_confirm_pos_endpoint(
    body: _ConfirmRequest,
    token_data: TokenData = Depends(require_role("admin")),
):
    """Cancel previously-confirmed POs (admin recovery — undoes /po/confirm)."""
    from app.etl.bqms_po_api import cancel_confirm_pos
    payload = [p.model_dump() for p in body.pos]
    try:
        result = await cancel_confirm_pos(payload)
    except Exception as exc:
        logger.exception("BQMS cancel_confirm_pos failed")
        raise HTTPException(status_code=502, detail=f"BQMS cancel-confirm error: {exc}")
    return {"data": result, "message": f"Đã hủy confirm cho {len(payload)} PO"}
