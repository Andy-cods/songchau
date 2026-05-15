"""Samsung BQMS API — KPI, records, RFQ parsing, quotation generation, sync, deliveries."""

from __future__ import annotations

import io
import json as _json
import logging
import math
import time

from pydantic import BaseModel
from datetime import date, datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, Query, UploadFile
from fastapi.exceptions import HTTPException
from fastapi.responses import StreamingResponse
import asyncpg

from app.core.database import get_db
from app.core.rbac import require_role
from app.core.security import TokenData
from app.services.bqms_service import BQMSService

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# BQMS user-edit guard (Thang 2026-05-15): when `bqms_user_edit_disabled` flag
# is true in app_config, ALL endpoints that mutate BQMS data return 403.
# Use as a single-line guard at top of each edit endpoint:
#     await _assert_bqms_edit_enabled(conn)
# Read-only endpoints are NOT affected.
# ─────────────────────────────────────────────────────────────────────────────

_BQMS_EDIT_DISABLED_MSG = (
    "BQMS user editing is currently disabled. Data is sourced from Samsung "
    "scrape only. Toggle app_config.bqms_user_edit_disabled=false to re-enable."
)


async def _assert_bqms_edit_enabled(conn: asyncpg.Connection) -> None:
    """Raise 403 nếu BQMS user-edit bị tắt qua app_config flag."""
    try:
        val = await conn.fetchval(
            "SELECT value FROM app_config WHERE key='bqms_user_edit_disabled'"
        )
    except Exception:
        return  # If app_config table or row missing, allow (fail-open)
    # jsonb value can be Python bool/str/dict — normalize to bool
    disabled = False
    if isinstance(val, bool):
        disabled = val
    elif isinstance(val, str):
        disabled = val.strip().strip('"').lower() in ("true", "1", "yes")
    if disabled:
        raise HTTPException(status_code=403, detail=_BQMS_EDIT_DISABLED_MSG)
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
    source_filter: str | None = Query(None, description="excel_import | etl | onedrive_sync | manual | all"),
    loai_hang: str | None = Query(None, description="TM | GC | all (Drawing detection)"),
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=10, le=500),
    token_data: TokenData = Depends(require_role("admin", "manager", "staff", "sales", "procurement", "warehouse", "accountant")),
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
        # Search bao gồm description từ staging.raw_json._detail.items
        # (e.g. "CNC BRUSH", "BLADE") — bqms_rfq không có cột description
        # nên cần subquery. Per Thang 2026-05-15.
        conditions.append(
            f"(rfq_number ILIKE ${idx} OR bqms_code ILIKE ${idx} "
            f"OR specification ILIKE ${idx} OR maker ILIKE ${idx} "
            f"OR EXISTS (SELECT 1 FROM bqms_vendor_portal_staging s "
            f"  WHERE s.module='bidding' AND s.rfq_number = bqms_rfq.rfq_number "
            f"  AND s.raw_json::text ILIKE ${idx}))"
        )
        params.append(like)
        idx += 1

    if result_filter and result_filter.lower() != "all":
        conditions.append(f"result::text = ${idx}")
        params.append(result_filter.lower())
        idx += 1

    if source_filter and source_filter.lower() != "all":
        conditions.append(f"data_source = ${idx}")
        params.append(source_filter.lower())
        idx += 1

    if loai_hang and loai_hang.upper() != "ALL":
        # Drawing classification stored in notes as 'classification=GC' or 'classification=TM'
        # for etl rows. For excel rows, fall back to spec keyword heuristic.
        if loai_hang.upper() == "GC":
            conditions.append(
                f"(notes ILIKE '%classification=GC%' OR specification ILIKE '%gia c_ng%')"
            )
        elif loai_hang.upper() == "TM":
            conditions.append(
                f"(notes ILIKE '%classification=TM%' OR "
                f"(notes NOT ILIKE '%classification=GC%' "
                f"AND specification NOT ILIKE '%gia c_ng%'))"
            )

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
    # Phase 2 per Thang 2026-05-12: include requester/department/assigned_to.
    # Phase E (Thang 2026-05-13): include classification_override for user-edit support.
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
            created_at, version, data_source,
            requester, department,
            assigned_to::text AS assigned_to,
            classification_override,
            quote_unlocked
        FROM bqms_rfq
        WHERE {where}
        ORDER BY COALESCE(inquiry_date, created_at::date) DESC NULLS LAST, id DESC
        LIMIT ${idx} OFFSET ${idx + 1}
        """,
        *params_paged,
    )

    # Per Thang 2026-05-11: enrich approved rows with bidding metadata
    # (MOQ/CIS/Part No/maker/deadline/classification/...) by post-query
    # JOIN with bqms_vendor_portal_staging.raw_json. This avoids fragile
    # SQL alias-rewriting in the main WHERE clause.
    rfq_numbers = {r["rfq_number"] for r in rows if r["rfq_number"]}
    staging_meta: dict[str, dict] = {}
    if rfq_numbers:
        # FIX duplicate (Thang 2026-05-14): include staging.id so bqms_rfq rows
        # can carry staging_id → button "Báo giá" trên approved row vẫn gọi
        # /vendor-staging/{staging_id}/quote được.
        meta_rows = await conn.fetch(
            """
            SELECT DISTINCT ON (rfq_number)
                rfq_number, id AS staging_id, raw_json
            FROM bqms_vendor_portal_staging
            WHERE module='bidding' AND rfq_number = ANY($1::text[])
            ORDER BY rfq_number, id DESC
            """,
            list(rfq_numbers),
        )
        for mr in meta_rows:
            raw = mr["raw_json"] or {}
            if isinstance(raw, str):
                try:
                    raw = _json.loads(raw)
                except Exception:
                    raw = {}
            detail = raw.get("_detail") or {}
            items_arr = detail.get("items") or []
            staging_meta[mr["rfq_number"]] = {
                "staging_id": int(mr["staging_id"]),
                "raw": raw,
                "detail": detail,
                "items_arr": items_arr,
                "deadline_dt": (raw.get("deadlineDt") or "").strip() or None,
                "reg_dt": (raw.get("regDt") or "").strip() or None,
                "bd_status": (raw.get("progressStatusName") or "").strip() or None,
                "psincharge_name": (raw.get("psinchargeName") or "").strip() or None,
                "ctr_type_nm": (raw.get("ctrTypeNm") or "").strip() or None,
                "currency": (raw.get("criteriaCurrency") or "").strip() or None,
                "dday_html": (raw.get("dday") or "").strip() or None,
                "req_name": (raw.get("reqName") or "").strip() or None,
                "classification": detail.get("classification"),
                "detail_version": detail.get("version"),
                "items_count": len(items_arr),
                "attachments_count": len(detail.get("attachments") or []),
            }

    # Per Thang 2026-05-11: Merge Bidding pending rows into BQMS table.
    # Pending bidding rows live in bqms_vendor_portal_staging (status=pending_review)
    # and aren't yet in bqms_rfq. We surface them here with `is_pending=true`
    # so the user can see + Báo giá from a single unified table.
    # Only include on first page + when no result_filter (or filter='pending').
    pending_bidding: list[dict] = []
    if page == 1 and (not result_filter or result_filter.lower() in ("all", "pending")):
        # FIX duplicate (Thang 2026-05-14): Sau Phase H, auto-drill UPSERT vào
        # bqms_rfq nhưng staging vẫn status='pending_review' → rfq-table merge
        # cả 2 source → 1 RFQ hiện 2 dòng (staging với nút "Báo giá" + bqms_rfq
        # với VP badge). Filter: chỉ surface staging nếu rfq_number chưa có
        # trong bqms_rfq. bqms_rfq row sẽ tự cõng nút "Báo giá" qua staging_id_map.
        pending_rows = await conn.fetch(
            """
            SELECT
                s.id AS staging_id,
                s.rfq_number,
                s.created_at,
                s.raw_json
            FROM bqms_vendor_portal_staging s
            WHERE s.module = 'bidding' AND s.status = 'pending_review'
              AND NOT EXISTS (
                  SELECT 1 FROM bqms_rfq r WHERE r.rfq_number = s.rfq_number
              )
            ORDER BY s.id DESC
            LIMIT 200
            """,
        )
        for r in pending_rows:
            raw = r["raw_json"] or {}
            if isinstance(raw, str):
                try:
                    raw = _json.loads(raw)
                except Exception:
                    raw = {}
            detail = raw.get("_detail") or {}
            items = detail.get("items") or []

            # Per Thang 2026-05-11: expand to 1 row per item so user sees
            # each bqms_code with its own Description + Specification.
            # Fallback: if no items drilled yet, show a single placeholder row.
            iter_items = items if items else [{}]
            # Phase 2 (Thang 2026-05-13): parse Requester/Department từ
            # psinchargeName format "Name/Department/Company"
            _pic_full = (raw.get("psinchargeName") or "").strip()
            _pic_parts = [p.strip() for p in _pic_full.split("/") if p.strip()] if _pic_full else []
            _row_requester = _pic_parts[0] if _pic_parts else None
            _row_department = _pic_parts[1] if len(_pic_parts) >= 2 else None
            for idx_it, it in enumerate(iter_items):
                bqms_code = (it.get("item_code") or "").strip() or None
                description = (it.get("description") or "").strip() or None
                specification = (it.get("specification") or "").strip() or None
                pending_bidding.append({
                    # Negative ID composite: -(staging_id*100 + idx) so multiple
                    # items per staging row stay unique without colliding w/ bqms_rfq IDs.
                    "id": -(int(r["staging_id"]) * 100 + idx_it),
                    "staging_id": int(r["staging_id"]),
                    "is_pending": True,
                    "rfq_number": r["rfq_number"],
                    "bqms_code": bqms_code,
                    "description": description,
                    "specification": specification or (raw.get("reqName") or "").strip() or None,
                    "maker": (it.get("maker") or "").strip() or None,
                    "expected_qty": it.get("qty"),
                    "unit": (it.get("unit") or "").strip() or None,
                    "purchase_price_rmb": None,
                    "purchase_price_vnd": None,
                    "quoted_price_ama": None,
                    "quoted_price_bqms_v1": None,
                    "quoted_price_bqms_v2": None,
                    "quoted_price_bqms_v3": None,
                    "quoted_price_bqms_v4": None,
                    "supplier_name": None,
                    "result": "pending",
                    "notes": None,
                    "report": None,
                    "person_in_charge_name": (raw.get("psinchargeName") or "").split("/")[0].strip() or None,
                    "inquiry_date": None,
                    "effective_date": r["created_at"].date() if r["created_at"] else None,
                    "created_at": r["created_at"],
                    "version": None,
                    "data_source": "bidding_pending",
                    "req_name": (raw.get("reqName") or "").strip() or None,
                    "reg_dt": (raw.get("regDt") or "").strip() or None,
                    "deadline_dt": (raw.get("deadlineDt") or "").strip() or None,
                    "submit_dt": (raw.get("submitDt") or "").strip() or None,
                    "bd_status": (raw.get("progressStatusName") or raw.get("submitGb") or "").strip() or None,
                    "psincharge_name": (raw.get("psinchargeName") or "").strip() or None,
                    "currency": (raw.get("criteriaCurrency") or "").strip() or None,
                    "item_cnt_text": (raw.get("itemCnt") or "").strip() or None,
                    "dday_html": (raw.get("dday") or "").strip() or None,
                    "ctr_type_nm": (raw.get("ctrTypeNm") or "").strip() or None,
                    "classification": detail.get("classification"),
                    "detail_version": detail.get("version"),
                    "items_count": len(items),
                    "attachments_count": len(detail.get("attachments") or []),
                    "detail_error": (detail.get("error") or "").strip() or None,
                    # Per-item enriched fields (renamed from "first_*" since now
                    # per-row, not per-RFQ).
                    "first_maker": (it.get("maker") or "").strip() or None,
                    "first_part_no": (it.get("part_no") or "").strip() or None,
                    "first_cis_code": (it.get("cis_code") or "").strip() or None,
                    "first_moq": (it.get("moq") or "").strip() or None,
                    # Phase 2 (Thang 2026-05-13): cũng hiển thị cho pending
                    "requester": _row_requester,
                    "department": _row_department,
                    "assigned_to": None,
                    "assigned_to_name": None,
                })

    def _serialize(r) -> dict:
        d = dict(r) if not isinstance(r, dict) else r
        for k, v in d.items():
            if isinstance(v, (date, datetime)):
                d[k] = v.isoformat()
        return d

    def _enrich_with_staging(d: dict) -> dict:
        """Mix bidding metadata from staging (matched by rfq_number)
        into an approved row. Per-item fields (maker/moq/cis_code/part_no)
        are looked up by bqms_code. Only adds keys that aren't set."""
        if d.get("is_pending"):
            return d
        rfq_no = d.get("rfq_number")
        meta = staging_meta.get(rfq_no)
        if not meta:
            return d
        # FIX duplicate (Thang 2026-05-14): inject staging_id so button "Báo giá"
        # trên bqms_rfq row vẫn gọi được endpoint /vendor-staging/{id}/quote.
        d["staging_id"] = meta.get("staging_id")
        # Per-RFQ fields
        for k in ("deadline_dt", "reg_dt", "bd_status", "psincharge_name",
                  "ctr_type_nm", "currency", "dday_html", "req_name",
                  "classification", "detail_version",
                  "items_count", "attachments_count"):
            if not d.get(k):
                d[k] = meta.get(k)
        # Per-item fields — lookup row's bqms_code in items array
        bqms = (d.get("bqms_code") or "").strip()
        if bqms:
            for it in meta.get("items_arr", []):
                if (it.get("item_code") == bqms or it.get("cis_code") == bqms):
                    if not d.get("first_maker"):
                        d["first_maker"] = (it.get("maker") or "").strip() or None
                    if not d.get("first_moq"):
                        d["first_moq"] = (it.get("moq") or "").strip() or None
                    if not d.get("first_cis_code"):
                        d["first_cis_code"] = (it.get("cis_code") or "").strip() or None
                    if not d.get("first_part_no"):
                        d["first_part_no"] = (it.get("part_no") or "").strip() or None
                    # Per Thang 2026-05-11: surface item-level description
                    # ('JIG-MEASUREMENT', 'Pipe Fitting', ...) so the
                    # frontend cell shows it BESIDES specification.
                    if not d.get("description"):
                        d["description"] = (it.get("description") or "").strip() or None
                    # Override specification with the per-item one if available
                    item_spec = (it.get("specification") or "").strip()
                    if item_spec and (not d.get("specification") or len(d.get("specification") or "") < len(item_spec)):
                        d["specification"] = item_spec
                    break
        return d

    # Phase 2 per Thang 2026-05-12: post-lookup users.full_name for assigned_to
    # so frontend can show "Người PT" without changing the WHERE/JOIN above.
    assigned_user_ids = {r["assigned_to"] for r in rows if r["assigned_to"]}
    assigned_name_map: dict[str, str] = {}
    if assigned_user_ids:
        u_rows = await conn.fetch(
            "SELECT id::text AS id, full_name FROM users WHERE id = ANY($1::uuid[])",
            list(assigned_user_ids),
        )
        assigned_name_map = {u["id"]: u["full_name"] for u in u_rows}

    def _add_assigned_name(d: dict) -> dict:
        uid = d.get("assigned_to")
        d["assigned_to_name"] = assigned_name_map.get(uid) if uid else None
        # Phase E (Thang 2026-05-13): classification_override > auto
        # Frontend expects `classification` field; we preserve override info
        # separately so UI can show "user-edited" badge.
        ovr = d.get("classification_override")
        if ovr:
            d["classification_auto"] = d.get("classification")
            d["classification"] = ovr
            d["classification_is_override"] = True
        else:
            d["classification_is_override"] = False
        return d

    # Phase F (Thang 2026-05-13): User muốn thứ tự match sec-bqms — QT mới
    # nhất (regDt mới nhất) lên đầu, KHÔNG quan trọng là pending hay approved.
    # Sort key priority: reg_dt → inquiry_date → effective_date → created_at.
    items_serialized = (
        [_serialize(p) for p in pending_bidding]
        + [_add_assigned_name(_enrich_with_staging(_serialize(r))) for r in rows]
    )

    def _parse_reg_dt(s: str | None) -> datetime | None:
        """Parse sec-bqms regDt strings like '(GMT+07:00) 5/15/2026 17:00' or
        '5/15/2026 17:00' or '5/15/2026'. Returns datetime or None."""
        if not s:
            return None
        import re as _re_local
        m = _re_local.search(
            r"(\d{1,2})/(\d{1,2})/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?",
            s,
        )
        if not m:
            return None
        try:
            mo, dd, yr = int(m.group(1)), int(m.group(2)), int(m.group(3))
            hh = int(m.group(4) or 0)
            mn = int(m.group(5) or 0)
            return datetime(yr, mo, dd, hh, mn)
        except Exception:
            return None

    def _date_part(it: dict) -> datetime:
        """Primary date: reg_dt → inquiry_date → effective_date → created_at."""
        rd = _parse_reg_dt(it.get("reg_dt"))
        if rd:
            return rd
        for fld in ("inquiry_date", "effective_date"):
            v = it.get(fld)
            if isinstance(v, str) and v:
                try:
                    return datetime.fromisoformat(v.replace("Z", "+00:00").split("+")[0])
                except Exception:
                    pass
        ca = it.get("created_at")
        if isinstance(ca, str) and ca:
            try:
                return datetime.fromisoformat(ca.replace("Z", "+00:00").split("+")[0])
            except Exception:
                pass
        return datetime.min

    def _sort_key(it: dict) -> tuple:
        """Sort by (date DESC, rfq_number DESC). reg_dt thường chỉ có ngày
        không kèm giờ → cần tiebreaker. sec-bqms registers QT theo thứ tự
        tăng dần (QT26062664 > QT26062316 nghĩa là 664 đăng ký SAU 316),
        nên dùng rfq_number DESC làm tiebreaker để khớp UI sec-bqms."""
        return (_date_part(it), it.get("rfq_number") or "")

    items_serialized.sort(key=_sort_key, reverse=True)

    return {
        "data": {
            "items": items_serialized,
            "total": total + len(pending_bidding),
            "pending_bidding_count": len(pending_bidding),
            "page": page,
            "page_size": page_size,
            "total_pages": math.ceil(total / page_size) if total > 0 else 1,
            "kpis": {
                "total_month": total,
                "won": won_count,
                "lost": lost_count,
                "pending": pending_count + len(pending_bidding),
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


# Phase E (Thang 2026-05-13): User-editable classification override
@router.patch("/rfq/{rfq_id}/classification")
async def update_rfq_classification(
    rfq_id: int,
    body: dict,
    token_data: TokenData = Depends(require_role(
        "admin", "manager", "staff", "sales",
        "procurement", "warehouse", "accountant",
    )),
    conn: asyncpg.Connection = Depends(get_db),
):
    """User override TM/GC classification. body = {classification: 'TM'|'GC'|null}.
    null hoặc 'auto' = revert về auto-detect (set classification_override=NULL).
    """
    val = body.get("classification")
    if isinstance(val, str):
        val = val.strip().upper()
        if val in ("AUTO", ""):
            val = None
        elif val not in ("TM", "GC"):
            raise HTTPException(400, "classification phải là 'TM', 'GC', hoặc null/auto")
    elif val is not None:
        raise HTTPException(400, "classification phải là string hoặc null")

    row = await conn.fetchrow(
        "UPDATE bqms_rfq SET classification_override = $1, updated_at = NOW() "
        "WHERE id = $2 RETURNING id, classification_override, notes",
        val, rfq_id,
    )
    if not row:
        raise HTTPException(404, f"RFQ #{rfq_id} không tồn tại")

    # Audit
    try:
        await conn.execute(
            """
            INSERT INTO audit_log (user_id, action, table_name, record_id, new_data, created_at)
            VALUES ($1::uuid, 'bqms.classification_override', 'bqms_rfq', $2, $3::jsonb, NOW())
            """,
            token_data.user_id, str(rfq_id),
            _json.dumps({"classification_override": val}),
        )
    except Exception as _exc:
        logger.warning("audit_log classification failed: %s", _exc)

    return {
        "data": {
            "id": row["id"],
            "classification_override": row["classification_override"],
            "classification_is_override": row["classification_override"] is not None,
        },
        "message": f"Classification đã set = {val or 'auto'}",
    }


@router.patch("/rfq/{rfq_id}/price")
async def update_rfq_price(
    rfq_id: int,
    body: dict,
    token_data: TokenData = Depends(require_role("admin", "manager", "staff", "sales", "procurement", "warehouse", "accountant")),
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
# RFQ — Skip / Unskip (per Thang 2026-05-11)
# Mark a bqms_rfq row as 'skipped' (= "không báo giá nữa"). Also propagates
# to bqms_vendor_portal_staging if a matching staging row exists, so the
# row stops appearing in pending lists.
# ---------------------------------------------------------------------------

@router.post("/rfq/{rfq_id}/skip")
async def skip_rfq(
    rfq_id: int,
    body: dict | None = None,
    token_data: TokenData = Depends(require_role("admin", "manager", "staff", "sales", "procurement", "warehouse", "accountant")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Mark RFQ as 'skipped' (set result='skipped' on bqms_rfq + staging.status='skipped').
    Pass {\"unskip\": true} in body to revert: result='pending' + staging.status='pending_review'.
    """
    body = body or {}
    unskip = bool(body.get("unskip"))

    rfq = await conn.fetchrow(
        "SELECT id, rfq_number, result::text AS result FROM bqms_rfq WHERE id = $1",
        rfq_id,
    )
    if not rfq:
        raise HTTPException(404, f"RFQ #{rfq_id} không tồn tại")

    new_result = "pending" if unskip else "skipped"
    new_staging_status = "pending_review" if unskip else "skipped"

    await conn.execute(
        "UPDATE bqms_rfq SET result = $1::rfq_result, result_updated_by = $2::uuid, "
        "result_date = CURRENT_DATE, updated_at = NOW() WHERE id = $3",
        new_result, token_data.user_id, rfq_id,
    )

    # Propagate to staging row(s) for the same rfq_number, if any
    affected = 0
    if rfq["rfq_number"]:
        result = await conn.execute(
            "UPDATE bqms_vendor_portal_staging SET status = $1, "
            "reviewed_by = $2::uuid, reviewed_at = NOW() "
            "WHERE rfq_number = $3 AND module = 'bidding'",
            new_staging_status, token_data.user_id, rfq["rfq_number"],
        )
        try:
            affected = int(result.split()[-1]) if result else 0
        except Exception:
            affected = 0

    logger.info(
        "RFQ %sskip: rfq_id=%d rfq_number=%s by=%s staging_affected=%d",
        "un-" if unskip else "", rfq_id, rfq["rfq_number"], token_data.user_id, affected,
    )
    return {
        "message": "Đã bỏ skip" if unskip else "Đã skip RFQ",
        "data": {
            "rfq_id": rfq_id,
            "rfq_number": rfq["rfq_number"],
            "result": new_result,
            "staging_affected": affected,
        },
    }


# ---------------------------------------------------------------------------
# RFQ — Generate Báo giá round 2/3/4 files (per Thang 2026-05-11)
# ---------------------------------------------------------------------------

@router.post("/rfq/{rfq_id}/generate-round")
async def generate_quote_round(
    rfq_id: int,
    round_n: int = Query(..., ge=1, le=4, description="Round number 1-4"),
    flow_type: str = Query("tm", description="tm | gc"),
    new_price: float | None = Query(None, description="Optional: V_n price to set"),
    token_data: TokenData = Depends(require_role("admin", "manager", "staff", "sales", "procurement", "warehouse", "accountant")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Generate quotation files for round N (1-4) using current bqms_rfq data.

    Per Thang 2026-05-11: lần 1 dùng /quote (drill detail). Lần 2-4 reuse
    bqms_rfq data + price V_n + write into [QT]_AMA BAC NINH_L{n} subfolder.

    If `new_price` provided: also UPDATE bqms_rfq.quoted_price_bqms_v{n} first.
    """
    if round_n not in (1, 2, 3, 4):
        raise HTTPException(400, "round must be 1-4")

    # 1. Optionally update the V_n price
    if new_price is not None:
        await conn.execute(
            f"UPDATE bqms_rfq SET quoted_price_bqms_v{round_n} = $1, updated_at = NOW() "
            "WHERE id = $2",
            float(new_price), rfq_id,
        )
        # Phase G (Thang 2026-05-13): log lịch sử báo giá để Detail page hiện
        # đầy đủ V1→V4 timeline. Trước đây thiếu INSERT này → bqms_quote_log
        # rỗng cho mọi báo giá từ generate-round → user không có history.
        try:
            await conn.execute(
                """
                INSERT INTO bqms_quote_log
                    (rfq_id, round, quoted_price, quoted_currency, item_type, quoted_by, notes)
                VALUES ($1, $2, $3, 'VND', $4, $5, $6)
                """,
                rfq_id, round_n, float(new_price),
                'GC' if (flow_type or 'tm').lower() == 'gc' else 'TM',
                token_data.user_id,
                f"L{round_n} from generate-round endpoint (flow={flow_type})",
            )
        except Exception as exc:
            logger.warning("quote_log insert failed for rfq=%s round=%d: %s",
                           rfq_id, round_n, exc)

    # 2. Fetch all items for this RFQ (group by rfq_number)
    rfq = await conn.fetchrow(
        "SELECT rfq_number FROM bqms_rfq WHERE id = $1", rfq_id,
    )
    if not rfq:
        raise HTTPException(404, f"RFQ #{rfq_id} not found")
    rfq_number = rfq["rfq_number"]

    rows = await conn.fetch(
        """
        SELECT id, rfq_number, bqms_code, specification, maker,
               expected_qty, unit, supplier_name, person_in_charge_name,
               quoted_price_bqms_v1, quoted_price_bqms_v2,
               quoted_price_bqms_v3, quoted_price_bqms_v4,
               notes
        FROM bqms_rfq
        WHERE rfq_number = $1
        ORDER BY id
        """,
        rfq_number,
    )
    if not rows:
        raise HTTPException(404, f"No items for RFQ {rfq_number}")

    # Build items in autofill_service shape
    price_field = f"quoted_price_bqms_v{round_n}"
    items = []
    for r in rows:
        # Detect TM/GC from notes (etl rows store classification=TM/GC there)
        loai = "GC" if "classification=GC" in (r["notes"] or "") else "TM"
        v_n = r[price_field]
        items.append({
            "don_hang": r["rfq_number"],
            "bqms": r["bqms_code"],
            "spec": r["specification"],
            "short_name": (r["specification"] or "")[:40],
            "maker": r["maker"],
            "so_luong": r["expected_qty"],
            "don_vi": r["unit"],
            "loai_hang": loai,
            "unit_price": v_n,
            "suggested_price": v_n,
        })

    # 3. Run autofill_job with round_n in output_dir name
    from app.services.tools.autofill_service import run_autofill_job

    cam_ket_tpl = await conn.fetchval(
        "SELECT file_path FROM quotation_templates "
        "WHERE template_type = 'cam_ket' AND is_default = true LIMIT 1"
    )
    commercial_tpl = await conn.fetchval(
        "SELECT file_path FROM quotation_templates "
        "WHERE template_type = 'commercial' AND is_default = true LIMIT 1"
    )

    # Insert quotation row first to get quotation_id
    quotation_id = await conn.fetchval(
        """
        INSERT INTO quotations
            (rfq_no, source_type, items, total_items, created_by, status, flow_type, quote_level)
        VALUES ($1, 'excel', $2::jsonb, $3, $4::uuid, 'processing', $5, $6)
        RETURNING id
        """,
        rfq_number,
        _json.dumps(items, default=str, ensure_ascii=False),
        len(items),
        token_data.user_id,
        flow_type,
        round_n,
    )

    # Patch the autofill_service to write into L{round_n} subfolder.
    # We do this by passing a custom round_n via items metadata that
    # quote_round_subfolder picks up. Simpler: override after generation
    # by moving files to L{round_n} (autofill_service hardcodes round_n=1).
    # Cleanest: patch run_autofill_job to accept round_n. For now, do post-move.

    result = await run_autofill_job(
        conn=conn,
        quotation_id=quotation_id,
        items=items,
        cam_ket_template=cam_ket_tpl,
        commercial_template=commercial_tpl,
        flow_type=flow_type,
    )

    # Post-process: rename L1 → L{round_n} folder if round != 1
    if round_n != 1 and result.get("success"):
        from pathlib import Path
        import shutil
        for f in result.get("files", []):
            old_path = f.get("path")
            if not old_path or "_AMA BAC NINH_L1/" not in old_path:
                continue
            new_path = old_path.replace(
                "_AMA BAC NINH_L1/", f"_AMA BAC NINH_L{round_n}/",
            )
            new_dir = Path(new_path).parent
            new_dir.mkdir(parents=True, exist_ok=True)
            try:
                shutil.move(old_path, new_path)
                f["path"] = new_path
            except Exception as exc:
                logger.warning("L%d move failed: %s", round_n, exc)
        # Clean up empty L1 dir
        try:
            l1_dir = Path(result["files"][0]["path"]).parent.parent / f"{rfq_number}_AMA BAC NINH_L1"
            if l1_dir.exists() and not any(l1_dir.iterdir()):
                l1_dir.rmdir()
        except Exception:
            pass

    return {
        "data": {
            "quotation_id": quotation_id,
            "rfq_id": rfq_id,
            "rfq_number": rfq_number,
            "round_n": round_n,
            "flow_type": flow_type,
            "new_price_set": new_price,
            "files": result.get("files", []),
            "errors": result.get("errors", []),
        },
        "message": f"Đã tạo file báo giá lần {round_n} cho {rfq_number}",
    }


# ---------------------------------------------------------------------------
# GC Quote Wizard — per Thang 2026-05-11
# ---------------------------------------------------------------------------

from pydantic import BaseModel as _WizardBase, Field as _WizardField  # noqa: E402


@router.get("/rfq/{rfq_id}/wizard-items")
async def rfq_wizard_items(
    rfq_id: int,
    token_data: TokenData = Depends(require_role("admin", "manager", "staff", "sales", "procurement", "warehouse", "accountant")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """List the items belonging to the same rfq_number as `rfq_id`.
    Used by the GC wizard step 1 to show all mã hàng of the RFQ."""
    rfq = await conn.fetchrow(
        "SELECT rfq_number FROM bqms_rfq WHERE id = $1", rfq_id,
    )
    if not rfq:
        raise HTTPException(404, f"RFQ #{rfq_id} not found")
    rows = await conn.fetch(
        "SELECT bqms_code, specification, expected_qty "
        "FROM bqms_rfq WHERE rfq_number = $1 ORDER BY id",
        rfq["rfq_number"],
    )
    return {
        "data": [
            {
                "bqms_code": r["bqms_code"] or "",
                "spec": r["specification"] or "",
                "qty": int(r["expected_qty"] or 1),
            }
            for r in rows
        ],
    }


class WizardMaterialIn(_WizardBase):
    name: str
    w: float | None = None
    l: float | None = None
    h: float | None = None
    qty: float = 1
    unit_price: float = 0


class WizardPartIn(_WizardBase):
    name: str
    qty: float = 1
    unit_price: float = 0


class WizardOtherIn(_WizardBase):
    description: str = ""
    qty: float = 1
    unit_price: float = 0


class WizardProcessIn(_WizardBase):
    name: str
    time_hr: float = 0
    unit_price: float = 0


class WizardItemIn(_WizardBase):
    bqms_code: str
    jig_name: str
    spec: str = ""
    qty: float = 1
    materials: list[WizardMaterialIn] = _WizardField(default_factory=list)
    parts: list[WizardPartIn] = _WizardField(default_factory=list)
    others: list[WizardOtherIn] = _WizardField(default_factory=list)
    processes: list[WizardProcessIn] = _WizardField(default_factory=list)
    nego: float = 0


class WizardFinalizeIn(_WizardBase):
    rfq_id: int
    round_n: int = _WizardField(..., ge=1, le=4)
    items: list[WizardItemIn] = _WizardField(..., min_length=1)


@router.post("/quote-wizard/finalize-gc")
async def quote_wizard_finalize_gc(
    payload: WizardFinalizeIn,
    token_data: TokenData = Depends(require_role("admin", "manager", "staff", "sales", "procurement", "warehouse", "accountant")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Build a GC quotation xlsx from wizard data (materials + processes per item).

    Per Thang 2026-05-11: before this, GC quote was auto-generated from
    bqms_rfq data (no material/process detail). Wizard lets user fill in
    real values which get injected into the QUOTATION_GC.xlsx template.
    """
    rfq = await conn.fetchrow(
        "SELECT rfq_number FROM bqms_rfq WHERE id = $1", payload.rfq_id,
    )
    if not rfq:
        raise HTTPException(404, f"RFQ #{payload.rfq_id} not found")
    rfq_number = rfq["rfq_number"]

    # Compute totals per item for storing back into bqms_rfq.quoted_price_bqms_v{n}
    def _calc_total(it: WizardItemIn) -> float:
        mat = sum((m.qty or 0) * (m.unit_price or 0) for m in it.materials)
        parts = sum((p.qty or 0) * (p.unit_price or 0) for p in it.parts)
        others = sum((o.qty or 0) * (o.unit_price or 0) for o in it.others)
        proc = sum((p.time_hr or 0) * (p.unit_price or 0) for p in it.processes)
        sub = mat + parts + others + proc
        mgmt = sub * 0.05
        profit = mgmt
        return sub + mgmt + profit - (it.nego or 0)

    item_totals = {it.bqms_code: _calc_total(it) for it in payload.items}

    # Locate GC template
    gc_template = await conn.fetchval(
        "SELECT file_path FROM quotation_templates "
        "WHERE template_type = 'gc' AND is_default = true LIMIT 1"
    )
    if not gc_template:
        raise HTTPException(500, "GC template not configured in DB")

    # Find or create the per-RFQ folder + L{round_n} subfolder
    from app.etl.bqms_bidding_scraper import (
        find_existing_rfq_folder, quote_round_subfolder, ensure_rfq_folder_on_scrape,
    )
    parent = find_existing_rfq_folder(rfq_number) or ensure_rfq_folder_on_scrape(
        rfq_number, {},
    )
    if parent is None:
        raise HTTPException(500, f"Could not create folder for {rfq_number}")
    out_dir = quote_round_subfolder(parent, rfq_number, payload.round_n)

    # Build the GC xlsx using template + wizard data
    from app.services.tools.gc_template_quotation import (
        fill_gc_quotation_from_wizard,
    )
    import os
    out_xlsx = os.path.join(out_dir, f"QUOTATION_GC_{rfq_number}.xlsx")

    # Discover images for the selected bqms codes:
    #  1) Phase D (Thang 2026-05-12): check /data/quote-overrides/{rfq}/{code}__product_photo.png
    #     first — user-uploaded override has HIGHEST priority
    #  2) Fallback: auto-discovery from RFQ folder images/ subfolder.
    images_map: dict[str, bytes] = {}
    override_dir = Path(f"/data/quote-overrides/{rfq_number}")

    for it in payload.items:
        code = (it.bqms_code or "").strip()
        if not code:
            continue
        # Check override first
        for ext in (".png", ".jpg", ".jpeg"):
            ovr = override_dir / f"{code}__product_photo{ext}"
            if ovr.exists():
                try:
                    images_map[code] = ovr.read_bytes()
                    logger.info("GC wizard image OVERRIDE: %s → %s (%d B)",
                                code, ovr.name, len(images_map[code]))
                except Exception as exc:
                    logger.warning("GC override read failed %s: %s", ovr, exc)
                break

    # Fallback: auto-discover from images/ for codes without override
    images_dir = parent / "images"
    if images_dir.exists():
        codes = sorted(
            (it.bqms_code.strip() for it in payload.items
             if it.bqms_code and it.bqms_code.strip() not in images_map),
            key=lambda s: -len(s),
        )
        used_files: set[str] = set()
        for img_path in sorted(images_dir.glob("*.png")):
            if img_path.name in used_files:
                continue
            for code in codes:
                if code and img_path.stem.startswith(code) and code not in images_map:
                    try:
                        images_map[code] = img_path.read_bytes()
                        used_files.add(img_path.name)
                        logger.info(
                            "GC wizard image: %s → %s (%d B)",
                            code, img_path.name, len(images_map[code]),
                        )
                    except Exception as exc:
                        logger.warning("GC wizard image read failed %s: %s", img_path, exc)
                    break
    logger.info(
        "GC wizard images_map: %d/%d items have images",
        len(images_map), len(payload.items),
    )

    result = fill_gc_quotation_from_wizard(
        template_path=gc_template,
        wizard_items=[it.model_dump() for it in payload.items],
        images_map=images_map,
        rfq_no=rfq_number,
        output_path=out_xlsx,
    )

    # Per Thang 2026-05-11: each item → its own PDF (not 1 combined PDF).
    # The result has `per_item_files = [{bqms_code, xlsx}]` — render PDF per item.
    from app.services.gotenberg_service import convert_xlsx_to_pdf
    per_item_outputs: list[dict[str, str]] = []
    for entry in (result.get("per_item_files") or []):
        per_xlsx = entry["xlsx"]
        per_pdf = per_xlsx.replace(".xlsx", ".pdf")
        try:
            await convert_xlsx_to_pdf(per_xlsx, per_pdf)
            entry["pdf"] = per_pdf
        except Exception as exc:
            logger.warning("Gotenberg per-item conversion failed for %s: %s", per_xlsx, exc)
            entry["pdf"] = None
        per_item_outputs.append(entry)

    # Also render the combined xlsx as a single PDF (optional, for review).
    out_pdf = out_xlsx.replace(".xlsx", ".pdf")
    try:
        await convert_xlsx_to_pdf(out_xlsx, out_pdf)
    except Exception as exc:
        logger.warning("Gotenberg combined PDF conversion failed: %s", exc)
        out_pdf = None

    # INSERT quotation row
    import json as _j
    quotation_id = await conn.fetchval(
        """
        INSERT INTO quotations
            (rfq_no, source_type, items, total_items, created_by, status, flow_type, quote_level,
             output_xlsx, output_pdf)
        VALUES ($1, 'excel', $2::jsonb, $3, $4::uuid, 'completed', 'gc', $5, $6, $7)
        RETURNING id
        """,
        rfq_number,
        _j.dumps([it.model_dump() for it in payload.items], default=str, ensure_ascii=False),
        len(payload.items),
        token_data.user_id,
        payload.round_n,
        out_xlsx,
        out_pdf,
    )

    # Update bqms_rfq.quoted_price_bqms_v{round_n} per item + auto-tracklog
    # current user as the assignee (Phase 2 per Thang 2026-05-12). The "Người PT"
    # column on the BQMS table reads users.full_name via assigned_to.
    for bqms_code, total in item_totals.items():
        await conn.execute(
            f"UPDATE bqms_rfq "
            f"SET quoted_price_bqms_v{payload.round_n} = $1, "
            f"    assigned_to = COALESCE(assigned_to, $4::uuid), "
            f"    updated_at = NOW() "
            f"WHERE rfq_number = $2 AND bqms_code = $3",
            float(total), rfq_number, bqms_code, token_data.user_id,
        )

    files = [{"type": "gc_quotation_xlsx", "path": out_xlsx}]
    if out_pdf:
        files.append({"type": "gc_quotation_pdf", "path": out_pdf})
    # Add per-item files so frontend can list them too
    for e in per_item_outputs:
        files.append({
            "type": "gc_quotation_xlsx_item",
            "path": e["xlsx"],
            "bqms_code": e["bqms_code"],
        })
        if e.get("pdf"):
            files.append({
                "type": "gc_quotation_pdf_item",
                "path": e["pdf"],
                "bqms_code": e["bqms_code"],
            })

    # Audit log per item — dashboard "Tổng quan" reads these to show
    # today's quoting activity. Per Thang 2026-05-11 + Phase 4.1 (Thang 2026-05-12):
    # ALSO insert into bqms_quote_log so daily_report.morning_report() picks up
    # GC submissions (currently it only sees inline-edit quote logs).
    try:
        for bqms_code, total in item_totals.items():
            await conn.execute(
                """
                INSERT INTO audit_log
                    (user_id, action, table_name, record_id, new_data, created_at)
                VALUES ($1::uuid, 'bqms.quote.gc', 'bqms_rfq', $2, $3::jsonb, NOW())
                """,
                token_data.user_id, f"{rfq_number}:{bqms_code}",
                _json.dumps({
                    "rfq_number": rfq_number,
                    "bqms_code": bqms_code,
                    "round_n": payload.round_n,
                    "total": float(total),
                    "flow": "gc",
                    "quotation_id": quotation_id,
                }),
            )
            # Phase 4.1: link to BQMS via bqms_quote_log so daily report shows
            # GC quotes in "SL báo giá được" breakdown (not just inline edits).
            try:
                rfq_row = await conn.fetchrow(
                    "SELECT id FROM bqms_rfq WHERE rfq_number = $1 AND bqms_code = $2 LIMIT 1",
                    rfq_number, bqms_code,
                )
                if rfq_row:
                    await conn.execute(
                        """
                        INSERT INTO bqms_quote_log
                          (rfq_id, round, quoted_price, quoted_currency, item_type, quoted_by, notes)
                        VALUES ($1, $2, $3, 'VND', 'GC', $4::uuid, $5)
                        """,
                        rfq_row["id"], payload.round_n, float(total),
                        token_data.user_id,
                        f"GC wizard finalize quotation_id={quotation_id}",
                    )
            except Exception as qexc:
                logger.warning("bqms_quote_log insert failed for %s/%s: %s",
                               rfq_number, bqms_code, qexc)
    except Exception as exc:
        logger.warning("audit_log insert failed: %s", exc)

    # Phase 6 (Thang 2026-05-12 "Full Vision"): award +1 EXP per quoted item
    # to user's primary pet. Best-effort — pet bug must NOT fail the quote.
    try:
        from app.services.pet_service import award_exp as _award_pet_exp
        for bqms_code in item_totals.keys():
            await _award_pet_exp(
                conn, str(token_data.user_id),
                "quote_submitted", delta=1,
                source_ref=f"{rfq_number}:{bqms_code}",
            )
    except Exception as exc:
        logger.warning("pet award_exp failed: %s", exc)

    return {
        "data": {
            "quotation_id": quotation_id,
            "rfq_id": payload.rfq_id,
            "rfq_number": rfq_number,
            "round_n": payload.round_n,
            "files": files,
            "totals": item_totals,
            "errors": result.get("errors", []),
        },
        "message": f"Đã tạo báo giá GC lần {payload.round_n} cho {rfq_number} ({len(payload.items)} mã)",
    }


# ---------------------------------------------------------------------------
# Quote file management: re-render PDF after manual xlsx edit
# Per Thang 2026-05-11: allow user to edit saved xlsx and re-export PDF.
# ---------------------------------------------------------------------------

class _RegenPdfIn(_WizardBase):
    xlsx_path: str = _WizardField(..., description="Absolute path to the xlsx file under /data/onedrive-staging/")


@router.post("/quote-file/regen-pdf")
async def quote_file_regen_pdf(
    body: _RegenPdfIn,
    token_data: TokenData = Depends(require_role("admin", "manager", "staff", "sales", "procurement", "warehouse", "accountant")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Re-render PDF from a (possibly user-edited) xlsx file.

    User flow: download xlsx → edit locally → upload via /file-browser → click
    "Tạo lại PDF" on the table row → this endpoint regenerates the .pdf
    next to the .xlsx using Gotenberg (same converter as initial generation).
    """
    import os
    from pathlib import Path

    # Security: only allow paths under onedrive-staging
    p = Path(body.xlsx_path).resolve()
    allowed_root = Path("/data/onedrive-staging").resolve()
    try:
        p.relative_to(allowed_root)
    except ValueError:
        raise HTTPException(403, "path outside allowed root")
    if not p.exists():
        raise HTTPException(404, f"xlsx not found: {p}")
    if p.suffix.lower() != ".xlsx":
        raise HTTPException(400, "only .xlsx allowed")

    out_pdf = str(p.with_suffix(".pdf"))
    from app.services.gotenberg_service import convert_xlsx_to_pdf
    try:
        await convert_xlsx_to_pdf(str(p), out_pdf)
    except Exception as exc:
        raise HTTPException(500, f"Gotenberg conversion failed: {exc}")

    try:
        await conn.execute(
            """
            INSERT INTO audit_log
                (user_id, action, table_name, record_id, new_data, created_at)
            VALUES ($1::uuid, 'bqms.quote.regen_pdf', 'quotations', $2, $3::jsonb, NOW())
            """,
            token_data.user_id, str(p),
            _json.dumps({"xlsx": str(p), "pdf": out_pdf}),
        )
    except Exception as exc:
        logger.warning("regen audit log failed: %s", exc)

    return {
        "data": {"xlsx": str(p), "pdf": out_pdf, "regenerated": True},
        "message": "Đã render lại PDF",
    }


@router.get("/scrape-control/status")
async def scrape_control_status(
    token_data: TokenData = Depends(require_role("admin", "manager", "staff", "sales", "procurement", "warehouse", "accountant")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Read the bqms_periodic_scrape on/off flag."""
    row = await conn.fetchrow(
        "SELECT value::text AS value_text, updated_at "
        "FROM app_config WHERE key='bqms_periodic_scrape_enabled'"
    )
    enabled = False
    if row:
        # value_text is the JSON literal: 'true' or 'false' (lowercase, no quotes)
        v = (row["value_text"] or "").strip().lower()
        enabled = v == "true"
    return {
        "data": {
            "enabled": enabled,
            "updated_at": row["updated_at"].isoformat() if row and row["updated_at"] else None,
        }
    }


@router.post("/scrape-control/toggle")
async def scrape_control_toggle(
    enabled: bool = Query(..., description="true=enable, false=disable"),
    token_data: TokenData = Depends(require_role("admin", "manager")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Turn the BQMS periodic scrape on/off at runtime."""
    val = "true" if enabled else "false"
    await conn.execute(
        """
        INSERT INTO app_config (key, value, updated_at, updated_by)
        VALUES ('bqms_periodic_scrape_enabled', $1::jsonb, NOW(), $2::uuid)
        ON CONFLICT (key) DO UPDATE SET
            value = EXCLUDED.value,
            updated_at = EXCLUDED.updated_at,
            updated_by = EXCLUDED.updated_by
        """,
        val, token_data.user_id,
    )
    # Audit log
    try:
        await conn.execute(
            """
            INSERT INTO audit_log
                (user_id, action, table_name, record_id, new_data, created_at)
            VALUES ($1::uuid, 'bqms.scrape_toggle', 'app_config', 'bqms_periodic_scrape_enabled', $2::jsonb, NOW())
            """,
            token_data.user_id,
            _json.dumps({"enabled": enabled}),
        )
    except Exception as exc:
        logger.warning("audit log toggle failed: %s", exc)
    return {"data": {"enabled": enabled}, "message": f"Cron scrape đã {'BẬT' if enabled else 'TẮT'}"}


# Phase F (Thang 2026-05-13): Data-gap tracking — thống kê RFQ còn thiếu detail
# + endpoint quét bù manual để user theo dõi tiến độ auto-drill.
@router.get("/data-gaps")
async def bqms_data_gaps(
    token_data: TokenData = Depends(require_role(
        "admin", "manager", "staff", "sales",
        "procurement", "warehouse", "accountant",
    )),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Thống kê RFQ pending còn thiếu data (items grid / folder / images).

    Trả về:
      - by_state: count theo trạng thái (has_items / empty_items / no_detail / missing_folder)
      - missing_list: top 50 RFQ thiếu items chi tiết (rfq_number, samsung_item_cnt, scraped_at)
      - last_cron: thông tin cron run cuối (timestamp, duration, drilled_count)
    """
    # 1) State breakdown — count by data completeness state
    state_rows = await conn.fetch(
        """
        SELECT
            CASE
                WHEN raw_json->'_detail' IS NULL THEN 'no_detail'
                WHEN jsonb_array_length(COALESCE(raw_json->'_detail'->'items','[]'::jsonb)) > 0 THEN 'has_items'
                ELSE 'empty_items'
            END AS state,
            COUNT(*) AS n
        FROM bqms_vendor_portal_staging
        WHERE module = 'bidding' AND status = 'pending_review'
        GROUP BY state
        """
    )
    by_state = {r["state"]: int(r["n"]) for r in state_rows}
    total_pending = sum(by_state.values())

    # 2) List of RFQs missing items (Samsung says >0 items but our _detail.items empty)
    missing_rows = await conn.fetch(
        """
        SELECT
            id,
            rfq_number,
            raw_json->>'itemCnt' AS samsung_item_cnt,
            raw_json->>'regDt'   AS reg_dt,
            raw_json->>'reqName' AS req_name,
            scraped_at,
            jsonb_array_length(COALESCE(raw_json->'_detail'->'items','[]'::jsonb)) AS our_items
        FROM bqms_vendor_portal_staging
        WHERE module = 'bidding' AND status = 'pending_review'
          AND jsonb_array_length(COALESCE(raw_json->'_detail'->'items','[]'::jsonb)) = 0
        ORDER BY id DESC
        LIMIT 50
        """
    )
    missing_list = [
        {
            "id": int(r["id"]),
            "rfq_number": r["rfq_number"],
            "samsung_item_cnt": (r["samsung_item_cnt"] or "").strip() or None,
            "reg_dt": (r["reg_dt"] or "").strip() or None,
            "req_name": (r["req_name"] or "").strip()[:80] or None,
            "scraped_at": r["scraped_at"].isoformat() if r["scraped_at"] else None,
            "our_items": int(r["our_items"] or 0),
        }
        for r in missing_rows
    ]

    # 3) Last periodic-scrape run from app_config (cron may write summary here)
    last_cron_row = await conn.fetchrow(
        "SELECT value::text AS v, updated_at FROM app_config "
        "WHERE key = 'bqms_periodic_scrape_last_run'"
    )
    last_cron = None
    if last_cron_row:
        try:
            last_cron = {
                "summary": _json.loads(last_cron_row["v"]),
                "updated_at": last_cron_row["updated_at"].isoformat() if last_cron_row["updated_at"] else None,
            }
        except Exception:
            last_cron = {"summary": last_cron_row["v"], "updated_at": None}

    # 4) Smart-rescan state (Phase F Thang 2026-05-13)
    rescan_state_row = await conn.fetchrow(
        "SELECT value::text AS v, updated_at FROM app_config "
        "WHERE key = 'bqms_smart_rescan_state'"
    )
    rescan_state = None
    if rescan_state_row:
        try:
            rescan_state = _json.loads(rescan_state_row["v"])
            rescan_state["updated_at"] = (
                rescan_state_row["updated_at"].isoformat() if rescan_state_row["updated_at"] else None
            )
        except Exception:
            rescan_state = None

    # Smart-rescan enabled flag (default true)
    rescan_enabled_row = await conn.fetchrow(
        "SELECT value::text AS v FROM app_config WHERE key = 'bqms_smart_rescan_enabled'"
    )
    rescan_enabled = True
    if rescan_enabled_row:
        try:
            v = rescan_enabled_row["v"].strip().lower().strip('"')
            rescan_enabled = v in ("true", "1", "yes")
        except Exception:
            pass

    # 5) Total scope across all sources (for context)
    total_rfq = await conn.fetchval("SELECT COUNT(*) FROM bqms_rfq")

    # Phase G (Thang 2026-05-13): Smart Code-Track state + gap breakdown
    ct_state_row = await conn.fetchrow(
        "SELECT value::text AS v, updated_at FROM app_config "
        "WHERE key = 'bqms_code_track_state'"
    )
    ct_state = None
    if ct_state_row:
        try:
            ct_state = _json.loads(ct_state_row["v"])
            ct_state["updated_at"] = (
                ct_state_row["updated_at"].isoformat() if ct_state_row["updated_at"] else None
            )
        except Exception:
            ct_state = None
    ct_enabled_row = await conn.fetchrow(
        "SELECT value::text AS v FROM app_config WHERE key = 'bqms_code_track_enabled'"
    )
    ct_enabled = True  # default ON
    if ct_enabled_row:
        try:
            v = ct_enabled_row["v"].strip().lower().strip('"')
            ct_enabled = v in ("true", "1", "yes")
        except Exception:
            pass
    ct_breakdown_rows = await conn.fetch(
        "SELECT gap_type, COUNT(*) AS n FROM bqms_row_gaps "
        "WHERE healed_at IS NULL GROUP BY gap_type"
    )
    ct_breakdown = {r["gap_type"]: int(r["n"]) for r in ct_breakdown_rows}
    ct_healed_today = await conn.fetchval(
        "SELECT COUNT(*) FROM bqms_row_gaps WHERE healed_at >= CURRENT_DATE"
    )
    ct_cooldown_count = await conn.fetchval(
        "SELECT COUNT(DISTINCT rfq_number) FROM bqms_row_gaps "
        "WHERE last_attempt_at > NOW() - INTERVAL '10 minutes' AND healed_at IS NULL"
    )

    return {
        "data": {
            "total_pending": total_pending,
            "total_rfq_db": int(total_rfq or 0),
            "by_state": by_state,
            "missing_list": missing_list,
            "last_cron": last_cron,
            "smart_rescan": {
                "enabled": rescan_enabled,
                "state": rescan_state,  # {status, gaps_before, processed, finished_at, ...}
            },
            "code_track": {
                "enabled": ct_enabled,
                "last_run": ct_state,
                "gap_breakdown": ct_breakdown,
                "healed_today": int(ct_healed_today or 0),
                "pending_cooldown": int(ct_cooldown_count or 0),
            },
        }
    }


@router.post("/data-gaps/toggle-code-track")
async def toggle_code_track(
    enabled: bool = Query(...),
    token_data: TokenData = Depends(require_role("admin", "manager")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Bật/tắt Smart Code-Track engine (chạy mỗi 3 phút, self-healing 10 loại gap)."""
    val = "true" if enabled else "false"
    await conn.execute(
        """
        INSERT INTO app_config (key, value, updated_at, updated_by)
        VALUES ('bqms_code_track_enabled', $1::jsonb, NOW(), $2::uuid)
        ON CONFLICT (key) DO UPDATE SET
            value = EXCLUDED.value,
            updated_at = EXCLUDED.updated_at,
            updated_by = EXCLUDED.updated_by
        """,
        val, token_data.user_id,
    )
    return {"data": {"enabled": enabled},
            "message": f"Smart Code-Track đã {'BẬT' if enabled else 'TẮT'}"}


@router.get("/data-gaps/healing-log")
async def healing_log(
    limit: int = Query(50, ge=1, le=200),
    kind: str | None = Query(None, description="Filter by gap_type"),
    only_healed: bool = Query(False, description="Only show healed_at IS NOT NULL"),
    token_data: TokenData = Depends(require_role(
        "admin", "manager", "staff", "sales", "procurement",
    )),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Recent heal attempts/outcomes for the UI 'Lịch sử heal' tab."""
    rows = await conn.fetch(
        """
        SELECT id, rfq_number, rfq_id, staging_id, gap_type, evidence,
               detected_at, last_attempt_at, drill_attempts, healed_at, last_error
        FROM bqms_row_gaps
        WHERE ($1::text IS NULL OR gap_type = $1)
          AND ($2 = false OR healed_at IS NOT NULL)
        ORDER BY COALESCE(healed_at, last_attempt_at, detected_at) DESC
        LIMIT $3
        """,
        kind, only_healed, limit,
    )
    out = []
    for r in rows:
        d = dict(r)
        for k, v in d.items():
            if isinstance(v, (date, datetime)):
                d[k] = v.isoformat()
        out.append(d)
    return {"data": out, "total": len(out)}


@router.post("/data-gaps/toggle-smart-rescan")
async def toggle_smart_rescan(
    enabled: bool = Query(...),
    token_data: TokenData = Depends(require_role("admin", "manager")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Bật/tắt smart auto-rescan task (chạy mỗi 5 phút, drill khi có gap)."""
    val = "true" if enabled else "false"
    await conn.execute(
        """
        INSERT INTO app_config (key, value, updated_at, updated_by)
        VALUES ('bqms_smart_rescan_enabled', $1::jsonb, NOW(), $2::uuid)
        ON CONFLICT (key) DO UPDATE SET
            value = EXCLUDED.value,
            updated_at = EXCLUDED.updated_at,
            updated_by = EXCLUDED.updated_by
        """,
        val, token_data.user_id,
    )
    return {"data": {"enabled": enabled}, "message": f"Smart auto-rescan đã {'BẬT' if enabled else 'TẮT'}"}


@router.post("/data-gaps/rescan")
async def bqms_data_gaps_rescan(
    max_rfqs: int = Query(50, ge=1, le=200, description="Max RFQs to drill this run"),
    budget_seconds: int = Query(1800, ge=60, le=3600, description="Hard time cap"),
    token_data: TokenData = Depends(require_role("admin", "manager")),
):
    """Quét bù: drill detail cho các RFQ pending còn thiếu items.

    Chạy synchronous (block tới khi xong hoặc hết budget). Trả về số RFQ
    đã drill + số file tải. Dùng cùng logic với periodic cron — chỉ khác
    là user trigger ngay thay vì chờ 30 phút tiếp theo.
    """
    import asyncpg
    from app.tasks.bqms_periodic_scrape import _auto_drill_new_rfqs
    from app.core.config import settings as _settings

    db_url = (
        str(_settings.DATABASE_URL)
        .replace("+asyncpg", "")
        .replace("postgresql+asyncpg", "postgresql")
    )
    pool = await asyncpg.create_pool(db_url, min_size=1, max_size=2)
    try:
        processed, total_files = await _auto_drill_new_rfqs(
            pool, max_per_cycle=max_rfqs, budget_seconds=budget_seconds,
        )
        return {
            "data": {
                "rfqs_processed": int(processed),
                "files_downloaded": int(total_files),
            },
            "message": f"Quét bù xong — {processed} RFQ đã drill, {total_files} file tải",
        }
    finally:
        await pool.close()


@router.get("/stats/win-lost")
async def stats_win_lost(
    period: str = Query("week", description="day | week | month"),
    weeks: int = Query(8, ge=1, le=52, description="how many periods back"),
    token_data: TokenData = Depends(require_role("admin", "manager", "staff", "sales", "procurement", "warehouse", "accountant")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Win/Lost statistics by period — reads directly from Selection Result
    staging (module='selection_result'). Per Thang 2026-05-11:
      - selectionResultName='Selected'   → won
      - selectionResultName='Unselected' → lost
    Grouped by week/month of deadlineDt (closing date)."""
    if period not in ("day", "week", "month"):
        raise HTTPException(400, "period must be day|week|month")

    trunc = {"day": "day", "week": "week", "month": "month"}[period]

    # Pull all selection results + parse date in Python (format varies)
    # Use both selectionResult (RES01=won, RES02=lost) AND selectionResultName
    # to be robust against text variations ("Selected" vs "Selection").
    rows = await conn.fetch(
        """
        SELECT
            id,
            rfq_number,
            raw_json->>'selectionResult'     AS result_code,
            raw_json->>'selectionResultName' AS result_name,
            raw_json->>'deadlineDt' AS deadline_dt,
            raw_json->>'regDt'      AS reg_dt,
            scraped_at::date         AS scraped_date
        FROM bqms_vendor_portal_staging
        WHERE module = 'selection_result'
        """,
    )

    from datetime import datetime as _dt, timedelta as _td
    import re as _re

    def _parse_date(s: str | None) -> _dt | None:
        if not s: return None
        # Strip "(GMT+xx:xx) " prefix
        s2 = _re.sub(r"\(GMT[+\-]\d{2}:\d{2}\)\s*", "", s).strip()
        for fmt in ("%m/%d/%Y %H:%M", "%m/%d/%Y", "%Y-%m-%d"):
            try:
                return _dt.strptime(s2.split(" ")[0] if fmt == "%m/%d/%Y" else s2[:len(_dt.now().strftime(fmt))], fmt)
            except (ValueError, TypeError):
                try:
                    return _dt.strptime(s2, fmt)
                except (ValueError, TypeError):
                    continue
        return None

    def _trunc_date(d: _dt) -> _dt:
        if period == "day":
            return d.replace(hour=0, minute=0, second=0, microsecond=0)
        if period == "week":
            return (d - _td(days=d.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
        # month
        return d.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    cutoff = _dt.now() - _td(days=weeks * (7 if period == "week" else (1 if period == "day" else 30)))

    by_period: dict[str, dict[str, int]] = {}
    seen_rfq: dict[str, str] = {}  # dedup: keep first result per rfq_number
    for r in rows:
        # Use selectionResult code first (more reliable): RES01=won, RES02=lost
        code = (r["result_code"] or "").strip().upper()
        name = (r["result_name"] or "").strip().lower()
        if code == "RES01" or name.startswith("select"):
            key = "won"
        elif code == "RES02" or name.startswith("unselect"):
            key = "lost"
        else:
            continue
        rfq = r["rfq_number"] or ""
        if rfq and rfq in seen_rfq:
            continue
        seen_rfq[rfq] = key
        # Parse date: prefer deadlineDt → regDt → scraped_date fallback
        dt = (_parse_date(r["deadline_dt"]) or _parse_date(r["reg_dt"])
              or (_dt.combine(r["scraped_date"], _dt.min.time()) if r["scraped_date"] else None))
        if not dt or dt < cutoff:
            continue
        ps = _trunc_date(dt).date().isoformat()
        by_period.setdefault(ps, {"won": 0, "lost": 0})
        by_period[ps][key] += 1

    totals = {"won": 0, "lost": 0}
    for v in by_period.values():
        totals["won"] += v["won"]
        totals["lost"] += v["lost"]
    total_decided = totals["won"] + totals["lost"]
    win_rate = (totals["won"] / total_decided * 100) if total_decided > 0 else 0.0

    return {
        "data": {
            "period": period,
            "weeks": weeks,
            "by_period": [
                {"start": ps, "won": v["won"], "lost": v["lost"], "total": v["won"] + v["lost"]}
                for ps, v in sorted(by_period.items(), reverse=True)
            ],
            "totals": {**totals, "decided": total_decided, "win_rate_pct": round(win_rate, 1)},
            "source": "bqms_vendor_portal_staging (selection_result module)",
            "raw_count": len(rows),
            "deduped_count": len(seen_rfq),
        }
    }


@router.post("/scrape-trigger/selection-result")
async def trigger_selection_result_scrape(
    limit: int = Query(0, ge=0, le=2000, description="0 = all available rows"),
    token_data: TokenData = Depends(require_role("admin", "manager")),
):
    """Manually fire a Selection Result scrape NOW (synchronous, ~1-2 min).
    Use this to refresh win/lost data without waiting for cron.
    Per Thang 2026-05-11: cron is OFF by default, this gives manual control."""
    import asyncpg
    from app.etl.bqms_l1_l3_scraper import scrape_selection_result
    from app.core.config import settings

    db_url = (
        str(settings.DATABASE_URL)
        .replace("+asyncpg", "")
        .replace("postgresql+asyncpg", "postgresql")
    )
    pool = await asyncpg.create_pool(db_url, min_size=1, max_size=2)
    try:
        result = await scrape_selection_result(
            limit=limit, save_raw_json=False, db_pool=pool, auto_mark_result=True,
        )
        return {
            "data": {
                "list_count": result.get("list_count", 0),
                "total_available": result.get("total_available", 0),
                "staging_inserts": result.get("staging_inserts", 0),
                "won_marked": result.get("won_marked", 0),
                "lost_marked": result.get("lost_marked", 0),
                "duration_seconds": result.get("duration_seconds"),
            },
            "message": "Selection Result scrape complete",
        }
    finally:
        await pool.close()


@router.post("/admin/reextract-images")
async def admin_reextract_images(
    rfq_number: str | None = Query(None, description="If set, only this RFQ; else ALL recent folders"),
    limit: int = Query(50, ge=1, le=500, description="Max folders to process"),
    token_data: TokenData = Depends(require_role("admin", "manager")),
):
    """Re-run smart image extraction for existing folders (clean up duplicates
    from the pre-2026-05-11 naive extraction). Skips folders where images/
    is empty or raw/ is empty.

    Per Thang 2026-05-11: smart dedup needs to be applied retroactively to
    folders whose images got assigned identical content across multiple
    item codes.
    """
    from app.etl.bqms_bidding_scraper import (
        RFQ_ROOT, _extract_images_for_rfq_folder, find_existing_rfq_folder,
    )

    folders: list = []
    if rfq_number:
        f = find_existing_rfq_folder(rfq_number)
        if f:
            folders.append(f)
    else:
        # Walk recent month folders
        from datetime import datetime as _dt
        now = _dt.now()
        for y in (now.year, now.year - 1):
            year_root = RFQ_ROOT / f"RFQ {y}"
            if not year_root.exists():
                continue
            for m in range(12, 0, -1):
                month_root = year_root / f"THANG {m}"
                if not month_root.exists():
                    continue
                for d in month_root.iterdir():
                    if d.is_dir() and (d / "raw").exists():
                        folders.append(d)
                        if len(folders) >= limit:
                            break
                if len(folders) >= limit:
                    break
            if len(folders) >= limit:
                break

    summary = []
    for folder in folders:
        raw = folder / "raw"
        images = folder / "images"
        if not raw.exists():
            continue
        # Clean old images first
        if images.exists():
            for p in images.glob("*.png"):
                try: p.unlink()
                except Exception: pass
            for p in images.glob("*.jpg"):
                try: p.unlink()
                except Exception: pass
            for p in images.glob("*.jpeg"):
                try: p.unlink()
                except Exception: pass
        try:
            n = _extract_images_for_rfq_folder(raw, images)
            summary.append({"folder": folder.name, "images": n})
        except Exception as exc:
            summary.append({"folder": folder.name, "error": str(exc)[:200]})

    return {
        "data": {"processed": len(summary), "summary": summary[:50]},
        "message": f"Đã re-extract {len(summary)} folder(s)",
    }


@router.post("/admin/reset-data")
async def admin_reset_data(
    confirm: str = Query(..., description="Phải nhập đúng 'RESET' để xác nhận"),
    token_data: TokenData = Depends(require_role("admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """WIPE all BQMS scraped data — for go-live with fresh state.
    Deletes from: bqms_rfq, bqms_vendor_portal_staging, bqms_won_quotations,
    bqms_deliveries, quotations (bqms-related), bqms_quote_log, bqms_quote_batches.
    DOES NOT delete: quotation_templates, users, audit_log.

    Per Thang 2026-05-11: wanted a clean slate before production go-live.
    """
    if confirm != "RESET":
        raise HTTPException(400, "confirm phải là 'RESET' (in hoa)")

    counts: dict[str, int] = {}
    for tbl, where in [
        ("bqms_quote_batch_items", "1=1"),
        ("bqms_quote_batches", "1=1"),
        ("bqms_quote_log", "1=1"),
        ("rfq_quotations", "1=1"),
        ("bqms_quotation_items", "1=1"),
        ("quotations", "rfq_no IS NOT NULL"),
        ("bqms_won_quotations", "1=1"),
        ("bqms_deliveries", "1=1"),
        ("bqms_rfq", "1=1"),
        ("bqms_vendor_portal_staging", "1=1"),
    ]:
        try:
            row = await conn.fetchrow(f"SELECT COUNT(*) AS c FROM {tbl} WHERE {where}")
            counts[tbl] = int(row["c"])
            await conn.execute(f"DELETE FROM {tbl} WHERE {where}")
        except Exception as exc:
            logger.warning("reset %s failed: %s", tbl, exc)
            counts[tbl] = -1

    # Audit log
    try:
        await conn.execute(
            """
            INSERT INTO audit_log
                (user_id, action, table_name, record_id, new_data, created_at)
            VALUES ($1::uuid, 'bqms.admin_reset_data', 'multi', 'reset', $2::jsonb, NOW())
            """,
            token_data.user_id, _json.dumps(counts),
        )
    except Exception:
        pass

    return {"data": {"deleted": counts}, "message": "Đã reset toàn bộ data BQMS"}


@router.get("/activity/recent")
async def quote_activity_recent(
    days: int = Query(7, ge=1, le=30),
    limit: int = Query(50, ge=1, le=200),
    token_data: TokenData = Depends(require_role("admin", "manager", "staff", "sales", "procurement", "warehouse", "accountant")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Recent BQMS quoting + scrape activity for dashboard 'Tổng quan' widget.
    Per Thang 2026-05-11: surfaces today's quote events + Closed/Round2 detections
    from periodic scrape."""
    rows = await conn.fetch(
        """
        SELECT
            id, action, record_id, new_data, user_email, created_at
        FROM audit_log
        WHERE action LIKE 'bqms.%' OR action LIKE 'bqms_periodic.%'
        AND created_at > NOW() - ($1 || ' days')::interval
        ORDER BY created_at DESC
        LIMIT $2
        """,
        str(days), limit,
    )
    items = []
    for r in rows:
        d = dict(r)
        for k, v in d.items():
            if isinstance(v, (date, datetime)):
                d[k] = v.isoformat()
        items.append(d)
    return {"data": {"items": items, "days": days}}


# ---------------------------------------------------------------------------
# RFQ — Quotation History for a specific RFQ row
# ---------------------------------------------------------------------------

@router.get("/rfq/{rfq_id}/history")
async def rfq_history(
    rfq_id: int,
    token_data: TokenData = Depends(require_role("admin", "manager", "staff", "sales", "procurement", "warehouse", "accountant")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Get quotation history for a specific bqms_rfq row (matched by rfq_number)."""
    rfq = await conn.fetchrow(
        "SELECT id, rfq_number FROM bqms_rfq WHERE id = $1", rfq_id
    )
    if not rfq:
        raise HTTPException(status_code=404, detail=f"Không tìm thấy RFQ #{rfq_id}")

    rfq_number = rfq["rfq_number"]

    # Phase G (Thang 2026-05-13): expose bqms_quote_log entries trong response
    # để user thấy đầy đủ lịch sử giá (mọi lần báo giá đều log 1 row, kể cả
    # khi sửa lại giá V_n nhiều lần).
    quote_log_rows = []
    try:
        log_rows = await conn.fetch(
            """
            SELECT ql.id, ql.rfq_id, ql.round, ql.quoted_price, ql.quoted_currency,
                   ql.item_type, ql.notes, ql.created_at,
                   u.full_name AS quoted_by_name, u.email AS quoted_by_email
            FROM bqms_quote_log ql
            LEFT JOIN users u ON u.id = ql.quoted_by
            JOIN bqms_rfq r ON r.id = ql.rfq_id
            WHERE r.rfq_number = $1
            ORDER BY ql.created_at DESC
            LIMIT 100
            """,
            rfq_number,
        )
        for lr in log_rows:
            d = dict(lr)
            for k, v in d.items():
                if isinstance(v, (date, datetime)):
                    d[k] = v.isoformat()
            if d.get("quoted_price") is not None:
                d["quoted_price"] = float(d["quoted_price"])
            quote_log_rows.append(d)
    except Exception as exc:
        logger.warning("quote_log fetch failed for rfq=%s: %s", rfq_number, exc)

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
        # Phase G (Thang 2026-05-13): full price-change history từ bqms_quote_log
        "quote_log": quote_log_rows,
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


@router.get("/deliveries/revenue-stats")
async def delivery_revenue_stats(
    status: str | None = Query(None),
    month: int | None = Query(None, ge=1, le=12),
    year: int | None = Query(None, ge=2020, le=2099),
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    q: str | None = Query(None),
    driver_id: int | None = Query(None),
    po_number: str | None = Query(None),
    bqms_code: str | None = Query(None),
    group_by: str = Query("day"),
    breakdown_limit: int = Query(20, ge=1, le=100),
    token_data: TokenData = Depends(require_role("staff", "manager", "admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Doanh thu PO: summary + timeseries + breakdown.

    `total_amount_vnd` = SUM(amount) toàn bộ PO trong filter (giá trị đặt hàng).
    `delivered_amount_vnd` = SUM(total_delivered_value_vnd) khi đã giao (doanh thu thực).
    Summary numbers MUST khớp với /deliveries/kpi khi cùng filter.
    """
    if group_by not in {"day", "month", "driver", "po", "bqms", "recipient", "origin", "status"}:
        raise HTTPException(400, "group_by không hợp lệ")

    conds = ["1=1"]
    params: list = []
    idx = 1

    if status:
        grp = _STATUS_GROUPS.get(status)
        if grp:
            placeholders = ", ".join(f"${idx + i}" for i in range(len(grp)))
            conds.append(f"d.delivery_status::text IN ({placeholders})")
            params.extend(grp)
            idx += len(grp)
        else:
            conds.append(f"d.delivery_status::text = ${idx}")
            params.append(status)
            idx += 1
    if date_from:
        conds.append(f"COALESCE(d.po_date, d.delivery_date) >= ${idx}")
        params.append(date_from); idx += 1
    if date_to:
        conds.append(f"COALESCE(d.po_date, d.delivery_date) <= ${idx}")
        params.append(date_to); idx += 1
    if month:
        conds.append(f"EXTRACT(MONTH FROM COALESCE(d.po_date, d.delivery_date)) = ${idx}")
        params.append(month); idx += 1
    if year:
        conds.append(f"EXTRACT(YEAR FROM COALESCE(d.po_date, d.delivery_date)) = ${idx}")
        params.append(year); idx += 1
    if driver_id:
        conds.append(f"d.driver_id = ${idx}")
        params.append(driver_id); idx += 1
    if po_number:
        conds.append(f"d.po_number ILIKE ${idx}")
        params.append(f"%{po_number}%"); idx += 1
    if bqms_code:
        conds.append(f"d.bqms_code ILIKE ${idx}")
        params.append(f"%{bqms_code}%"); idx += 1
    if q:
        conds.append(
            f"(d.po_number ILIKE ${idx} OR d.bqms_code ILIKE ${idx} "
            f"OR d.recipient_name ILIKE ${idx} OR d.specification ILIKE ${idx})"
        )
        params.append(f"%{q}%"); idx += 1
    where_sql = " AND ".join(conds)

    summary_row = await conn.fetchrow(
        f"""
        SELECT
            COUNT(*)::int AS total_orders,
            COALESCE(SUM(d.amount), 0)::bigint AS total_amount_vnd,
            COALESCE(SUM(d.total_delivered_value_vnd) FILTER (
                WHERE d.delivery_status::text IN ('da_giao','delivered','completed','hoan_tat')
            ), 0)::bigint AS delivered_amount_vnd,
            COUNT(*) FILTER (
                WHERE d.delivery_status::text IN ('da_giao','delivered','completed','hoan_tat')
            )::int AS delivered_count,
            COUNT(*) FILTER (
                WHERE d.delivery_status::text IN ('dang_giao','in_transit','picked_up','customs_clearance')
            )::int AS in_transit_count,
            COUNT(*) FILTER (
                WHERE d.delivery_status::text IN ('chua_giao','pending')
            )::int AS pending_count,
            COALESCE(SUM(d.amount) FILTER (
                WHERE d.delivery_status::text IN ('chua_giao','pending')
            ), 0)::bigint AS pending_amount_vnd,
            COALESCE(SUM(d.amount) FILTER (
                WHERE d.delivery_status::text IN ('dang_giao','in_transit','picked_up','customs_clearance')
            ), 0)::bigint AS in_transit_amount_vnd,
            COALESCE(SUM(d.quantity), 0)::bigint AS total_qty,
            COALESCE(SUM(d.actual_delivered_qty), 0)::bigint AS delivered_qty
        FROM bqms_deliveries d
        WHERE {where_sql}
        """,
        *params,
    )
    summary = dict(summary_row)
    summary["delivery_rate"] = (
        round(summary["delivered_count"] / summary["total_orders"] * 100, 2)
        if summary["total_orders"] > 0 else 0.0
    )
    summary["avg_order_value"] = (
        int(summary["total_amount_vnd"] // summary["total_orders"])
        if summary["total_orders"] > 0 else 0
    )

    if group_by == "month":
        ts_expr = "TO_CHAR(COALESCE(d.po_date, d.delivery_date), 'YYYY-MM')"
        ts_label = "TO_CHAR(COALESCE(d.po_date, d.delivery_date), 'MM/YYYY')"
    else:
        ts_expr = "TO_CHAR(COALESCE(d.po_date, d.delivery_date), 'YYYY-MM-DD')"
        ts_label = "TO_CHAR(COALESCE(d.po_date, d.delivery_date), 'DD/MM')"

    ts_rows = await conn.fetch(
        f"""
        SELECT
            {ts_expr} AS bucket,
            {ts_label} AS label,
            COUNT(*)::int AS count,
            COALESCE(SUM(d.amount), 0)::bigint AS total_amount,
            COALESCE(SUM(d.total_delivered_value_vnd) FILTER (
                WHERE d.delivery_status::text IN ('da_giao','delivered','completed','hoan_tat')
            ), 0)::bigint AS delivered_amount,
            COUNT(*) FILTER (
                WHERE d.delivery_status::text IN ('da_giao','delivered','completed','hoan_tat')
            )::int AS delivered_count
        FROM bqms_deliveries d
        WHERE {where_sql}
            AND COALESCE(d.po_date, d.delivery_date) IS NOT NULL
        GROUP BY bucket, label
        ORDER BY bucket
        LIMIT 400
        """,
        *params,
    )
    timeseries = [dict(r) for r in ts_rows]

    bk_select = None
    bk_join = ""
    bk_group = "key"
    if group_by == "driver":
        bk_select = "COALESCE(drv.full_name, '— Chưa gán —') AS key, d.driver_id AS group_id"
        bk_join = "LEFT JOIN bqms_contacts drv ON drv.id = d.driver_id"
        bk_group = "key, d.driver_id"
    elif group_by == "po":
        bk_select = "COALESCE(d.po_number, '—') AS key, NULL::int AS group_id"
    elif group_by == "bqms":
        bk_select = "COALESCE(d.bqms_code, '—') AS key, NULL::int AS group_id"
    elif group_by == "recipient":
        bk_select = "COALESCE(NULLIF(d.recipient_name,''), '— Trống —') AS key, NULL::int AS group_id"
    elif group_by == "origin":
        bk_select = "COALESCE(NULLIF(d.country_origin,''), '— Trống —') AS key, NULL::int AS group_id"
    elif group_by == "status":
        bk_select = "d.delivery_status::text AS key, NULL::int AS group_id"

    breakdown: list = []
    if bk_select:
        bk_rows = await conn.fetch(
            f"""
            SELECT
                {bk_select},
                COUNT(*)::int AS count,
                COALESCE(SUM(d.amount), 0)::bigint AS total_amount,
                COALESCE(SUM(d.total_delivered_value_vnd) FILTER (
                    WHERE d.delivery_status::text IN ('da_giao','delivered','completed','hoan_tat')
                ), 0)::bigint AS delivered_amount,
                COUNT(*) FILTER (
                    WHERE d.delivery_status::text IN ('da_giao','delivered','completed','hoan_tat')
                )::int AS delivered_count,
                COUNT(*) FILTER (
                    WHERE d.delivery_status::text IN ('chua_giao','pending')
                )::int AS pending_count
            FROM bqms_deliveries d
            {bk_join}
            WHERE {where_sql}
            GROUP BY {bk_group}
            ORDER BY total_amount DESC NULLS LAST
            LIMIT ${idx}
            """,
            *params, breakdown_limit,
        )
        breakdown = [dict(r) for r in bk_rows]

    return {
        "summary": summary,
        "timeseries": timeseries,
        "breakdown": breakdown,
        "group_by": group_by,
        "filters_applied": {
            "status": status, "month": month, "year": year,
            "date_from": str(date_from) if date_from else None,
            "date_to": str(date_to) if date_to else None,
            "q": q, "driver_id": driver_id,
            "po_number": po_number, "bqms_code": bqms_code,
        },
    }


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
        SELECT d.*,
               drv.full_name AS driver_name,
               drv.phone AS driver_phone,
               drv.license_plate AS driver_license_plate,
               drv.vehicle_type AS driver_vehicle_type
        FROM bqms_deliveries d
        LEFT JOIN bqms_contacts drv
            ON drv.id = d.driver_id AND drv.is_driver = true
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
        "sev_type", "buyer_email", "buyer_phone", "recipient_name",
        "receiving_warehouse", "delivery_method",
        "notes", "actual_delivered_at", "actual_delivered_qty", "delivery_info",
        "country_origin",  # user-editable per request 2026-05-08
        "driver_id",  # Phase G (Thang 2026-05-13): assign delivery person
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


# Driver CRUD endpoints (was here, extracted to bqms_drivers.py in PR-1
# 2026-05-13). bqms_drivers_router is mounted with the same /bqms prefix
# so all /drivers/* routes remain unchanged from the client's perspective.


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



# ---------------------------------------------------------------------------
# Won quotations (sheet TRUNG BG of Thong ke hoi hang BQMS.xlsx)
# ---------------------------------------------------------------------------

from pydantic import BaseModel


class _WonQuotationPatch(BaseModel):
    hs_code: str | None = None
    goods_description: str | None = None


@router.get("/won-quotations")
async def list_won_quotations(
    search: str | None = Query(None, description="Tìm theo HS code, BQMS code, RFQ No, NCC, mô tả"),
    has_hs: str | None = Query(None, description="filled | missing | all"),
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=10, le=500),
    token_data: TokenData = Depends(require_role("admin", "manager", "staff", "sales", "procurement", "warehouse", "accountant")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """List won quotations from sheet TRUNG BG.

    Filters:
    - search: matched against rfq_number, bqms_code, hs_code, supplier_name,
      specification, description, goods_description (case-insensitive substring).
    - has_hs: 'filled' = has HS code; 'missing' = NULL or empty.
    """
    conds = ["1=1"]
    params: list[Any] = []
    idx = 1

    if search:
        like = f"%{search.strip()}%"
        conds.append(
            f"(w.rfq_number ILIKE ${idx} OR w.bqms_code ILIKE ${idx} OR w.hs_code ILIKE ${idx} "
            f"OR w.supplier_name ILIKE ${idx} OR w.specification ILIKE ${idx} "
            f"OR w.description ILIKE ${idx} OR w.goods_description ILIKE ${idx})"
        )
        params.append(like)
        idx += 1

    if has_hs == "filled":
        conds.append("w.hs_code IS NOT NULL AND w.hs_code <> ''")
    elif has_hs == "missing":
        conds.append("(w.hs_code IS NULL OR w.hs_code = '')")

    where = " AND ".join(conds)
    total = await conn.fetchval(
        f"SELECT COUNT(*) FROM bqms_won_quotations w WHERE {where}", *params
    )

    offset = (page - 1) * page_size
    params_paged = params + [page_size, offset]
    # Phase 4.2 (Thang 2026-05-12): LEFT JOIN bqms_contracts để show contract_no
    # badge trên won-quotations table. Match by rfq_number (request_no).
    rows = await conn.fetch(
        f"""
        SELECT w.id, w.rfq_number, w.bqms_code, w.person_in_charge_name,
               w.description, w.specification, w.quantity, w.unit,
               w.po_price, w.po_deadline, w.supplier_name,
               w.hs_code, w.goods_description, w.customs_char_count, w.notes,
               w.synced_at, w.created_at,
               c.id          AS contract_id,
               c.contract_no AS contract_no,
               c.status      AS contract_status
        FROM bqms_won_quotations w
        LEFT JOIN LATERAL (
            SELECT id, contract_no, status
            FROM bqms_contracts
            WHERE request_no = w.rfq_number
            ORDER BY contract_start DESC NULLS LAST, id DESC
            LIMIT 1
        ) c ON true
        WHERE {where}
        ORDER BY w.synced_at DESC NULLS LAST, w.id DESC
        LIMIT ${idx} OFFSET ${idx + 1}
        """,
        *params_paged,
    )

    def _ser(r: asyncpg.Record) -> dict:
        d = dict(r)
        for k, v in d.items():
            if isinstance(v, (date, datetime)):
                d[k] = v.isoformat()
            elif hasattr(v, "__float__") and not isinstance(v, (int, bool)):
                try:
                    d[k] = float(v)
                except Exception:
                    pass
        return d

    return {
        "data": {
            "items": [_ser(r) for r in rows],
            "total": int(total or 0),
            "page": page,
            "page_size": page_size,
        }
    }


# ---------------------------------------------------------------------------
# Phase 3.2 (Thang 2026-05-12): bulk HS code lookup — user paste list of
# bqms_codes → return existing HS code + description for each. Speeds up
# the Trúng BG / HS code research from one-by-one to copy-paste-tra hàng loạt.
# ---------------------------------------------------------------------------

class _BulkHsLookupIn(_BaseModel):
    codes: list[str]


@router.post("/hs-code/bulk-lookup")
async def hs_code_bulk_lookup(
    body: _BulkHsLookupIn,
    token_data: TokenData = Depends(require_role(
        "admin", "manager", "staff", "sales",
        "procurement", "warehouse", "accountant",
    )),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Bulk lookup HS code + goods_description for a list of BQMS codes.

    Strategy: query bqms_won_quotations grouped by bqms_code, return the most
    recent row's HS data for each code. If no row exists, returns null fields
    so frontend can highlight missing items for manual entry.
    """
    codes_clean = [c.strip() for c in (body.codes or []) if c and c.strip()]
    if not codes_clean:
        return {"data": {"items": [], "missing": []}}
    if len(codes_clean) > 200:
        raise HTTPException(400, "Tối đa 200 mã/lần")

    rows = await conn.fetch(
        """
        SELECT DISTINCT ON (bqms_code)
            bqms_code, hs_code, goods_description, description,
            specification, supplier_name, po_price,
            synced_at, customs_char_count
        FROM bqms_won_quotations
        WHERE bqms_code = ANY($1::text[])
        ORDER BY bqms_code, synced_at DESC NULLS LAST, id DESC
        """,
        codes_clean,
    )

    found_map = {}
    for r in rows:
        d = dict(r)
        for k, v in d.items():
            if isinstance(v, (date, datetime)):
                d[k] = v.isoformat()
            elif hasattr(v, "__float__") and not isinstance(v, (int, bool)):
                try:
                    d[k] = float(v)
                except Exception:
                    pass
        found_map[d["bqms_code"]] = d

    items = []
    missing = []
    for code in codes_clean:
        if code in found_map:
            items.append(found_map[code])
        else:
            missing.append(code)
            items.append({
                "bqms_code": code,
                "hs_code": None,
                "goods_description": None,
                "description": None,
                "specification": None,
                "supplier_name": None,
                "po_price": None,
                "synced_at": None,
                "customs_char_count": None,
            })

    return {
        "data": {
            "items": items,
            "missing": missing,
            "found_count": len(codes_clean) - len(missing),
            "missing_count": len(missing),
            "total": len(codes_clean),
        }
    }


@router.get("/staging/contracts")
async def list_staging_contracts(
    status: str | None = Query(None, description="pending_review | merged | all"),
    search: str | None = Query(None, description="Filter by rfq_number/contract_no/specification"),
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=10, le=500),
    token_data: TokenData = Depends(require_role("admin", "manager", "staff", "sales", "procurement", "warehouse", "accountant")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """List Contract Mgmt staging rows (raw scrape from sec-bqms.com).
    Per Thang 2026-05-11: surface contract module data as a tab inside
    /bqms/won-quotations so user can review pending contracts before merge.
    """
    conds = ["module = 'contract'"]
    params: list[Any] = []
    idx = 1
    if status and status != "all":
        conds.append(f"status = ${idx}"); params.append(status); idx += 1
    if search:
        conds.append(
            f"(rfq_number ILIKE ${idx} OR contract_no ILIKE ${idx} OR specification ILIKE ${idx})"
        )
        params.append(f"%{search.strip()}%"); idx += 1
    where = " AND ".join(conds)

    total = await conn.fetchval(
        f"SELECT COUNT(*) FROM bqms_vendor_portal_staging WHERE {where}", *params,
    )
    offset = (page - 1) * page_size
    rows = await conn.fetch(
        f"""
        SELECT id, scraped_at, status, rfq_number, contract_no, contract_period,
               item_code, description, specification, quantity, unit, raw_json
        FROM bqms_vendor_portal_staging
        WHERE {where}
        ORDER BY scraped_at DESC, id DESC
        LIMIT ${idx} OFFSET ${idx + 1}
        """,
        *params, page_size, offset,
    )

    def _ser(r: asyncpg.Record) -> dict:
        d = dict(r)
        raw = d.pop("raw_json", None) or {}
        if isinstance(raw, str):
            try: raw = _json.loads(raw)
            except Exception: raw = {}
        # Lift fields from raw_json.contract for richer display
        c = (raw.get("contract") or {})
        d["contract_amount"] = c.get("amount")
        d["contract_status"] = c.get("status")
        d["contract_subject"] = c.get("subject")
        d["contract_kind"] = c.get("contract_kind")
        d["created_by"] = c.get("created_by")
        d["items_count"] = len((c.get("items") or [raw.get("item")]) or [])
        for k, v in list(d.items()):
            if isinstance(v, (date, datetime)):
                d[k] = v.isoformat()
            elif hasattr(v, "__float__") and not isinstance(v, (int, bool)):
                try: d[k] = float(v)
                except Exception: pass
        return d

    return {
        "data": {
            "items": [_ser(r) for r in rows],
            "total": int(total or 0),
            "page": page,
            "page_size": page_size,
        }
    }


@router.get("/staging/mro")
async def list_staging_mro(
    status: str | None = Query(None, description="pending_review | merged | all"),
    search: str | None = Query(None, description="Filter by rfq_number/PO/item code"),
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=10, le=500),
    token_data: TokenData = Depends(require_role("admin", "manager", "staff", "sales", "procurement", "warehouse", "accountant")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """List MRO P/O Receipt staging rows (module='po' from MRO scraper).
    Per Thang 2026-05-11: surface MRO data as a tab inside /bqms/deliveries.
    """
    conds = ["module = 'po'"]
    params: list[Any] = []
    idx = 1
    if status and status != "all":
        conds.append(f"status = ${idx}"); params.append(status); idx += 1
    if search:
        conds.append(
            f"(rfq_number ILIKE ${idx} OR item_code ILIKE ${idx} OR specification ILIKE ${idx})"
        )
        params.append(f"%{search.strip()}%"); idx += 1
    where = " AND ".join(conds)

    total = await conn.fetchval(
        f"SELECT COUNT(*) FROM bqms_vendor_portal_staging WHERE {where}", *params,
    )
    offset = (page - 1) * page_size
    rows = await conn.fetch(
        f"""
        SELECT id, scraped_at, status, rfq_number,
               item_code, description, specification, quantity, unit, raw_json
        FROM bqms_vendor_portal_staging
        WHERE {where}
        ORDER BY scraped_at DESC, id DESC
        LIMIT ${idx} OFFSET ${idx + 1}
        """,
        *params, page_size, offset,
    )

    def _ser(r: asyncpg.Record) -> dict:
        d = dict(r)
        raw = d.pop("raw_json", None) or {}
        if isinstance(raw, str):
            try: raw = _json.loads(raw)
            except Exception: raw = {}
        # Lift MRO-specific fields from raw_json
        d["po_no"] = raw.get("PO_NO")
        d["po_status"] = raw.get("PO_STATUS_NAME")
        d["vendor"] = raw.get("SP_NAME")
        d["plant"] = raw.get("PLANT_NAME")
        d["buying_price"] = raw.get("BUYING_PRICE")
        d["buying_amount"] = raw.get("BUYING_AMOUNT")
        d["buying_currency"] = raw.get("BUYING_CURRENCY")
        d["receiver"] = raw.get("RECEIVER_NAME")
        d["delivery_address"] = raw.get("DELIVERY_ADDRESS")
        d["req_delivery_date"] = raw.get("REQ_DELIVERY_DATE")
        d["po_qty"] = raw.get("PO_QTY")
        d["item_cate"] = raw.get("ITEM_CATE")
        d["manufacturer"] = raw.get("MANUFACTURER")
        d["cis_code"] = raw.get("CIS_CODE")
        for k, v in list(d.items()):
            if isinstance(v, (date, datetime)):
                d[k] = v.isoformat()
            elif hasattr(v, "__float__") and not isinstance(v, (int, bool)):
                try: d[k] = float(v)
                except Exception: pass
        return d

    return {
        "data": {
            "items": [_ser(r) for r in rows],
            "total": int(total or 0),
            "page": page,
            "page_size": page_size,
        }
    }


@router.patch("/won-quotations/{won_id}")
async def update_won_quotation(
    won_id: int,
    body: _WonQuotationPatch,
    token_data: TokenData = Depends(require_role("admin", "manager", "staff", "sales", "procurement", "warehouse", "accountant")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Edit hs_code and/or goods_description for a won quotation row.

    Only these two fields are user-editable; everything else syncs from
    Excel TRUNG BG sheet via the auto-importer.
    """
    sets = []
    params: list[Any] = []
    idx = 1

    if body.hs_code is not None:
        sets.append(f"hs_code = ${idx}")
        params.append(body.hs_code.strip() or None)
        idx += 1
    if body.goods_description is not None:
        sets.append(f"goods_description = ${idx}")
        params.append(body.goods_description.strip() or None)
        idx += 1

    if not sets:
        raise HTTPException(400, "Chưa có trường nào để cập nhật")

    params.append(won_id)
    sql = f"UPDATE bqms_won_quotations SET {', '.join(sets)} WHERE id = ${idx} RETURNING id, hs_code, goods_description"
    row = await conn.fetchrow(sql, *params)
    if not row:
        raise HTTPException(404, f"Won quotation id={won_id} không tồn tại")

    return {"data": dict(row), "message": "Cập nhật thành công"}


# ---------------------------------------------------------------------------
# Origin summary (multi-select rows -> 2-col table BQMS code | Xuất xứ)
# ---------------------------------------------------------------------------

class _OriginSummaryRequest(BaseModel):
    ids: list[int]


@router.post("/deliveries/origin-summary")
async def deliveries_origin_summary(
    body: _OriginSummaryRequest,
    token_data: TokenData = Depends(require_role("admin", "manager", "staff", "sales", "procurement", "warehouse", "accountant")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """For a list of delivery row IDs, return [{bqms_code, country_origin}].
    Used by the "Thống kê xuất xứ" multi-select feature in the deliveries
    table — output mirrors the form Thang sketched (BQMS code | Xuất xứ).
    Sorted by bqms_code for stable ordering.
    """
    if not body.ids:
        return {"data": {"items": [], "total": 0}}
    if len(body.ids) > 1000:
        raise HTTPException(400, "Tối đa 1000 dòng/lần thống kê")

    rows = await conn.fetch(
        """
        SELECT DISTINCT bqms_code, country_origin
        FROM bqms_deliveries
        WHERE id = ANY($1::bigint[])
          AND bqms_code IS NOT NULL
          AND bqms_code <> ''
        ORDER BY bqms_code
        """,
        body.ids,
    )

    items = [
        {"bqms_code": r["bqms_code"], "country_origin": r["country_origin"] or ""}
        for r in rows
    ]
    return {"data": {"items": items, "total": len(items)}}


# ---------------------------------------------------------------------------
# Vendor Portal scraper — Contract Mgmt
# ---------------------------------------------------------------------------

@router.post("/scrape-contracts")
async def scrape_contracts_trigger(
    limit: int = Query(10, ge=0, le=50, description="Max contracts to drill (0 = all on first page)"),
    drill_items: bool = Query(True, description="Click into each contract to fetch Item Information"),
    dry_run: bool = Query(True, description="When true, save raw JSON only — no INSERT into staging"),
    token_data: TokenData = Depends(require_role("admin")),
):
    """Trigger a one-shot scrape of Vendor Portal -> Contract Mgmt.

    Returns the run summary (run_id, counts, json_path). When dry_run=False,
    rows are also INSERTed into `bqms_vendor_portal_staging` with status
    'pending_review' for human approval before merging into bqms_won_quotations.

    Synchronous — blocks for the duration of the scrape (~12s/contract).
    Single login per call enforced by the scraper module itself.
    """
    import threading
    import asyncio as _aio

    result_holder: dict[str, Any] = {}

    def _thread_scrape() -> None:
        async def _do() -> None:
            from app.etl.bqms_contract_scraper import scrape_contracts
            from app.core.config import settings as cfg
            import asyncpg as apg

            db_pool = None
            if not dry_run:
                db_url = (
                    str(cfg.DATABASE_URL)
                    .replace("+asyncpg", "")
                    .replace("postgresql+asyncpg", "postgresql")
                )
                db_pool = await apg.create_pool(db_url, min_size=1, max_size=2)
            try:
                payload = await scrape_contracts(
                    limit=limit,
                    drill_items=drill_items,
                    save_raw_json=True,
                    db_pool=db_pool,
                )
                result_holder["payload"] = payload
            except Exception as exc:
                logger.exception("scrape_contracts failed")
                result_holder["error"] = str(exc)[:500]
            finally:
                if db_pool is not None:
                    await db_pool.close()

        _aio.run(_do())

    t = threading.Thread(target=_thread_scrape, daemon=True)
    t.start()
    # Cap thread wait at 5 minutes (50 contracts * ~12s headroom) — protects
    # the request worker if BQMS hangs.
    t.join(timeout=300)

    if t.is_alive():
        raise HTTPException(504, "Scrape timed out after 5 minutes")

    if "error" in result_holder:
        raise HTTPException(500, f"Scrape failed: {result_holder['error']}")

    payload = result_holder.get("payload") or {}
    # Strip the heavy `items` array from response — caller reads json_path or
    # GET /bqms/vendor-staging for the actual rows.
    summary = {k: v for k, v in payload.items() if k != "items"}
    summary["item_total"] = sum(len(c.get("items") or []) for c in payload.get("items", []))
    summary["mode"] = "dry_run" if dry_run else "staged"
    logger.info(
        "scrape_contracts done by user=%s: run_id=%s drilled=%d mode=%s",
        token_data.user_id, summary.get("run_id"), summary.get("drilled_count"), summary["mode"],
    )
    return {"data": summary}


@router.post("/scrape-mro-po")
async def scrape_mro_po_trigger(
    limit: int = Query(0, ge=0, le=200, description="Max rows (0 = all on first page)"),
    dry_run: bool = Query(True, description="When true, save raw JSON only — no INSERT into staging"),
    token_data: TokenData = Depends(require_role("admin")),
):
    """Trigger a one-shot scrape of Vendor Portal -> Execution > MRO > P/O Receipt.

    The MRO P/O list is inline-rich (item_code, spec, qty, unit_price all in
    list columns) so this scraper is single-pass — no per-row drill needed.
    Faster and cheaper than the Contract Mgmt scraper.

    Rows land in bqms_vendor_portal_staging with module='po'.
    """
    import threading
    import asyncio as _aio

    result_holder: dict[str, Any] = {}

    def _thread_scrape() -> None:
        async def _do() -> None:
            from app.etl.bqms_mro_scraper import scrape_mro_po
            from app.core.config import settings as cfg
            import asyncpg as apg

            db_pool = None
            if not dry_run:
                db_url = (
                    str(cfg.DATABASE_URL)
                    .replace("+asyncpg", "")
                    .replace("postgresql+asyncpg", "postgresql")
                )
                db_pool = await apg.create_pool(db_url, min_size=1, max_size=2)
            try:
                payload = await scrape_mro_po(
                    limit=limit,
                    save_raw_json=True,
                    db_pool=db_pool,
                )
                result_holder["payload"] = payload
            except Exception as exc:
                logger.exception("scrape_mro_po failed")
                result_holder["error"] = str(exc)[:500]
            finally:
                if db_pool is not None:
                    await db_pool.close()

        _aio.run(_do())

    t = threading.Thread(target=_thread_scrape, daemon=True)
    t.start()
    t.join(timeout=120)
    if t.is_alive():
        raise HTTPException(504, "MRO scrape timed out after 2 minutes")
    if "error" in result_holder:
        raise HTTPException(500, f"MRO scrape failed: {result_holder['error']}")

    payload = result_holder.get("payload") or {}
    summary = {k: v for k, v in payload.items() if k != "items"}
    summary["mode"] = "dry_run" if dry_run else "staged"
    logger.info(
        "scrape_mro_po done by user=%s: run_id=%s rows=%d mode=%s",
        token_data.user_id, summary.get("run_id"), summary.get("list_count"), summary["mode"],
    )
    return {"data": summary}


@router.post("/scrape-bidding")
async def scrape_bidding_trigger(
    limit: int = Query(0, ge=0, le=200, description="Max rows (0 = all on chosen page)"),
    dry_run: bool = Query(True, description="When true, save raw JSON only — no INSERT into staging"),
    drill_details: bool = Query(False, description="Click each subject to fetch Quotation Amount items"),
    page_size: int = Query(100, ge=10, le=100, description="Rows per page (10/30/50/100)"),
    page_num: int = Query(1, ge=1, le=100, description="Page number (1-based, ~98 pages of 10)"),
    smart_skip: bool = Query(True, description="Skip drill+staging for QTs already in bqms_rfq with images"),
    token_data: TokenData = Depends(require_role("admin")),
):
    """Trigger a one-shot scrape of Bidding · Quotation Submit.

    Bidding is REQUEST-level (1 RFQ = 1 row) — invitations to quote, not
    won items. Lands in staging with module='bidding' for visibility only;
    the merge-approved endpoint does NOT push these into bqms_won_quotations.

    Has an IBSheet locale popup — handled internally by the scraper.
    """
    import threading
    import asyncio as _aio

    result_holder: dict[str, Any] = {}

    def _thread_scrape() -> None:
        async def _do() -> None:
            from app.etl.bqms_bidding_scraper import scrape_bidding
            from app.core.config import settings as cfg
            import asyncpg as apg

            db_pool = None
            if not dry_run:
                db_url = (
                    str(cfg.DATABASE_URL)
                    .replace("+asyncpg", "")
                    .replace("postgresql+asyncpg", "postgresql")
                )
                db_pool = await apg.create_pool(db_url, min_size=1, max_size=2)
            try:
                payload = await scrape_bidding(
                    limit=limit,
                    save_raw_json=True,
                    db_pool=db_pool,
                    drill_details=drill_details,
                    page_size=page_size,
                    page_num=page_num,
                    smart_skip=smart_skip,
                )
                result_holder["payload"] = payload
            except Exception as exc:
                logger.exception("scrape_bidding failed")
                result_holder["error"] = str(exc)[:500]
            finally:
                if db_pool is not None:
                    await db_pool.close()

        _aio.run(_do())

    t = threading.Thread(target=_thread_scrape, daemon=True)
    t.start()
    # Drill mode: 10 RFQ × ~10s/drill ≈ 100s + login overhead → cap 5 min
    timeout_s = 300 if drill_details else 120
    t.join(timeout=timeout_s)
    if t.is_alive():
        raise HTTPException(504, f"Bidding scrape timed out after {timeout_s}s")
    if "error" in result_holder:
        raise HTTPException(500, f"Bidding scrape failed: {result_holder['error']}")

    payload = result_holder.get("payload") or {}
    summary = {k: v for k, v in payload.items() if k != "items"}
    summary["mode"] = "dry_run" if dry_run else "staged"
    logger.info(
        "scrape_bidding done by user=%s: run_id=%s rows=%d/%d mode=%s",
        token_data.user_id, summary.get("run_id"),
        summary.get("list_count"), summary.get("total_available"), summary["mode"],
    )
    return {"data": summary}


# PR-2 (Thang 2026-05-13): /bidding/folder + /rfq/image + /bidding/folder/file
# extracted to bqms_images.py — mounted with same /bqms prefix.


@router.post("/scrape-announcement")
async def scrape_announcement_trigger(
    limit: int = Query(0, ge=0, le=200),
    dry_run: bool = Query(True),
    page_size: int = Query(100, ge=10, le=100),
    page_num: int = Query(1, ge=1, le=100),
    token_data: TokenData = Depends(require_role("admin")),
):
    """Phase L1 — Bidding · Quotation Announcement (menu 5).
    REQUEST-level invitations, không auto-merge."""
    import threading
    import asyncio as _aio
    result_holder: dict[str, Any] = {}

    def _thread() -> None:
        async def _do() -> None:
            from app.etl.bqms_l1_l3_scraper import scrape_announcement
            from app.core.config import settings as cfg
            import asyncpg as apg
            db_pool = None
            if not dry_run:
                db_url = str(cfg.DATABASE_URL).replace("+asyncpg", "").replace("postgresql+asyncpg", "postgresql")
                db_pool = await apg.create_pool(db_url, min_size=1, max_size=2)
            try:
                payload = await scrape_announcement(
                    limit=limit, save_raw_json=True, db_pool=db_pool,
                    page_size=page_size, page_num=page_num,
                )
                result_holder["payload"] = payload
            except Exception as exc:
                logger.exception("scrape_announcement failed")
                result_holder["error"] = str(exc)[:500]
            finally:
                if db_pool: await db_pool.close()
        _aio.run(_do())

    t = threading.Thread(target=_thread, daemon=True); t.start(); t.join(timeout=180)
    if t.is_alive(): raise HTTPException(504, "Announcement scrape timed out")
    if "error" in result_holder: raise HTTPException(500, result_holder["error"])
    p = result_holder.get("payload") or {}
    return {"data": {k: v for k, v in p.items() if k != "items"}}


@router.post("/scrape-selection-result")
async def scrape_selection_trigger(
    limit: int = Query(0, ge=0, le=200),
    dry_run: bool = Query(True),
    auto_mark_result: bool = Query(True, description="Auto-update bqms_rfq.result based on Selected/Unselected"),
    page_size: int = Query(100, ge=10, le=100),
    page_num: int = Query(1, ge=1, le=100),
    token_data: TokenData = Depends(require_role("admin")),
):
    """Phase L3 — Selection Result (menu 18).
    Side effect: auto-mark bqms_rfq.result = 'won' / 'lost' from Selected/Unselected.
    """
    import threading
    import asyncio as _aio
    result_holder: dict[str, Any] = {}

    def _thread() -> None:
        async def _do() -> None:
            from app.etl.bqms_l1_l3_scraper import scrape_selection_result
            from app.core.config import settings as cfg
            import asyncpg as apg
            db_pool = None
            if not dry_run:
                db_url = str(cfg.DATABASE_URL).replace("+asyncpg", "").replace("postgresql+asyncpg", "postgresql")
                db_pool = await apg.create_pool(db_url, min_size=1, max_size=2)
            try:
                payload = await scrape_selection_result(
                    limit=limit, save_raw_json=True, db_pool=db_pool,
                    auto_mark_result=auto_mark_result,
                    page_size=page_size, page_num=page_num,
                )
                result_holder["payload"] = payload
            except Exception as exc:
                logger.exception("scrape_selection_result failed")
                result_holder["error"] = str(exc)[:500]
            finally:
                if db_pool: await db_pool.close()
        _aio.run(_do())

    t = threading.Thread(target=_thread, daemon=True); t.start(); t.join(timeout=180)
    if t.is_alive(): raise HTTPException(504, "Selection scrape timed out")
    if "error" in result_holder: raise HTTPException(500, result_holder["error"])
    p = result_holder.get("payload") or {}
    return {"data": {k: v for k, v in p.items() if k != "items"}}


@router.post("/vendor-staging/{staging_id}/quote")
async def quote_bidding_staging(
    staging_id: int,
    # Phase H (Thang 2026-05-13): download_files param giữ lại để backward
    # compat URL nhưng KHÔNG còn tác dụng — scrape (30min/5min/3min cron)
    # đã làm hết drill+download+extract. Click "Báo giá" chỉ MỞ KHÓA V1-V4.
    download_files: bool = Query(False, description="DEPRECATED — scrape làm hết, button chỉ unlock V1-V4"),
    token_data: TokenData = Depends(require_role(
        "admin", "manager", "staff", "sales", "procurement", "warehouse", "accountant",
    )),
    conn: asyncpg.Connection = Depends(get_db),
):
    """LIGHTWEIGHT unlock — Phase H (Thang 2026-05-13).

    New design — Báo giá button KHÔNG còn trigger scrape:
      1. Idempotent UPSERT bqms_rfq từ staging._detail.items (nếu chưa có)
      2. SET bqms_rfq.quote_unlocked=true → frontend bật L1-L4 buttons
      3. SET bqms_rfq.assigned_to = current_user.id
      4. Mark staging.status='approved' + reviewed_at

    KHÔNG còn drill detail / download files / extract images here. Tất cả
    việc nặng đó nằm trong 3 cron task:
      - bqms_periodic_scrape (30 min) — bulk list + drill new RFQs
      - bqms_smart_rescan (5 min) — drill RFQs missing _detail.items
      - bqms_smart_code_track (3 min) — self-heal 10 kinds of gaps

    Nếu raw_json._detail.items vẫn rỗng (scrape chưa kịp drill RFQ này) →
    trả warning + giữ pending_review. User chờ 3-30 phút rồi click lại.
    Endpoint hoàn tất trong <1 giây — không còn Playwright session here.
    """
    row = await conn.fetchrow(
        "SELECT id, module, rfq_number, status, raw_json "
        "FROM bqms_vendor_portal_staging WHERE id = $1",
        staging_id,
    )
    if not row:
        raise HTTPException(404, f"Staging row #{staging_id} not found")
    if row["module"] != "bidding":
        raise HTTPException(400, f"module='{row['module']}' — quote chỉ áp dụng cho 'bidding'")
    if row["status"] not in ("pending_review", "approved"):
        raise HTTPException(409, f"Row đang ở status='{row['status']}', không thể báo lại")

    rfq_number = (row["rfq_number"] or "").strip()
    if not rfq_number:
        raise HTTPException(400, f"Row #{staging_id} thiếu rfq_number")

    raw = row["raw_json"]
    if not isinstance(raw, dict):
        raw = _json.loads(raw or "{}")

    items_in_detail = (raw.get("_detail") or {}).get("items") or []
    summary: dict[str, Any] = {"items_in_detail": len(items_in_detail)}

    if not items_in_detail:
        # Scrape chưa drill xong RFQ này — không thể UPSERT. User chờ cron.
        summary["bqms_rfq_upserts"] = 0
        summary["quote_unlocked"] = 0
        summary["staging_status"] = "pending_review"
        summary["warning"] = (
            f"RFQ {rfq_number} chưa được auto-drill bởi cron scrape. "
            f"Hệ thống có 3 cron tự chạy ngầm (30p/5p/3p) sẽ drill + download "
            f"+ extract ảnh + tạo dòng bqms_rfq. Chờ 3-5 phút rồi click lại."
        )
        logger.warning(
            "quote staging #%d (RFQ %s): empty _detail.items — chờ cron drill",
            staging_id, rfq_number,
        )
        return {"data": summary}

    # 1. Idempotent UPSERT bqms_rfq (nếu cron đã làm thì no-op)
    from app.etl.bqms_bidding_scraper import upsert_bqms_rfq_for_one_staging_row
    from app.core.config import settings as cfg
    import asyncpg as apg

    db_url = (
        str(cfg.DATABASE_URL)
        .replace("+asyncpg", "")
        .replace("postgresql+asyncpg", "postgresql")
    )
    pool = await apg.create_pool(db_url, min_size=1, max_size=2)
    try:
        n = await upsert_bqms_rfq_for_one_staging_row(pool, raw)
        summary["bqms_rfq_upserts"] = n

        # 2 + 3. UNLOCK V1-V4 buttons + assign current user (idempotent)
        async with pool.acquire() as c:
            unlocked = await c.fetchval(
                """
                UPDATE bqms_rfq
                SET quote_unlocked = true,
                    assigned_to = COALESCE(assigned_to, $1::uuid),
                    updated_at = NOW()
                WHERE rfq_number = $2
                RETURNING (SELECT COUNT(*) FROM bqms_rfq WHERE rfq_number = $2)
                """,
                token_data.user_id, rfq_number,
            )
            summary["quote_unlocked"] = int(unlocked or 0)

            # 4. Mark staging approved
            await c.execute(
                """
                UPDATE bqms_vendor_portal_staging
                SET status='approved', reviewed_by=$1, reviewed_at=NOW()
                WHERE id=$2 AND status IN ('pending_review','approved')
                """,
                token_data.user_id, staging_id,
            )
            summary["staging_status"] = "approved"
    finally:
        await pool.close()

    logger.info(
        "quote staging #%d (RFQ %s) UNLOCKED by user=%s: upserts=%d unlocked=%d",
        staging_id, rfq_number, token_data.user_id,
        summary["bqms_rfq_upserts"], summary["quote_unlocked"],
    )
    return {"data": summary}


@router.post("/vendor-staging/{staging_id}/skip")
async def skip_bidding_staging(
    staging_id: int,
    token_data: TokenData = Depends(require_role("admin", "manager")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Mark a bidding staging row as "Skip — review sau" — đặt status='skipped'.
    Khác với reject: skip có thể đổi ý sau."""
    row = await conn.fetchrow(
        "UPDATE bqms_vendor_portal_staging "
        "SET status='skipped', reviewed_by=$1, reviewed_at=NOW() "
        "WHERE id = $2 AND status='pending_review' "
        "RETURNING id, status",
        token_data.user_id, staging_id,
    )
    if not row:
        raise HTTPException(409, f"Staging #{staging_id} không tồn tại hoặc đã được duyệt trước đó")
    return {"data": dict(row)}


# ---------------------------------------------------------------------------
# Option B — background queue: batch /quote via Procrastinate worker
# ---------------------------------------------------------------------------

from pydantic import BaseModel, Field as PydField


class QuoteBatchRequest(BaseModel):
    staging_ids: list[int] = PydField(..., min_length=1, max_length=200)


@router.post("/vendor-staging/quote-batch")
async def create_quote_batch(
    payload: QuoteBatchRequest,
    token_data: TokenData = Depends(require_role("admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Tạo 1 batch /quote chạy nền — enqueue N task vào Procrastinate (queue='bqms_quote').
    Mỗi task = 1 RFQ với own login, chạy tuần tự trên sc-worker (~30-90s/RFQ).

    Frontend poll GET /vendor-staging/quote-batch/{id} để xem progress.
    Trả về batch_id ngay (không block)."""
    ids = list({sid for sid in payload.staging_ids if sid > 0})
    if not ids:
        raise HTTPException(400, "staging_ids rỗng")

    # Validate: chỉ accept module='bidding' rows ở status='pending_review' or 'approved'
    rows = await conn.fetch(
        "SELECT id, rfq_number, module, status FROM bqms_vendor_portal_staging "
        "WHERE id = ANY($1::int[])",
        ids,
    )
    found_ids = {r["id"] for r in rows}
    missing = [i for i in ids if i not in found_ids]
    if missing:
        raise HTTPException(404, f"Không tìm thấy staging rows: {missing}")
    bad = [r["id"] for r in rows if r["module"] != "bidding"
           or r["status"] not in ("pending_review", "approved")]
    if bad:
        raise HTTPException(400, f"Rows không phải bidding/pending_review: {bad}")

    # Tạo batch row
    batch_id = await conn.fetchval(
        "INSERT INTO bqms_quote_batches (created_by, total_count, pending_count) "
        "VALUES ($1, $2, $2) RETURNING id",
        token_data.user_id, len(rows),
    )

    # Tạo per-row item rows
    item_id_by_staging: dict[int, int] = {}
    for r in rows:
        item_id = await conn.fetchval(
            "INSERT INTO bqms_quote_batch_items "
            "(batch_id, staging_id, rfq_number, status) "
            "VALUES ($1, $2, $3, 'pending') RETURNING id",
            batch_id, r["id"], r["rfq_number"],
        )
        item_id_by_staging[r["id"]] = item_id

    # Enqueue Procrastinate tasks. The app is not opened by FastAPI lifespan,
    # so we open it temporarily for the duration of the enqueue burst.
    try:
        from app.tasks.bqms_quote_batch import quote_one_rfq_task
        from app.core.procrastinate_app import app as proc_app
        async with proc_app.open_async():
            for r in rows:
                item_id = item_id_by_staging[r["id"]]
                job_id = await quote_one_rfq_task.defer_async(
                    batch_item_id=item_id,
                    staging_id=r["id"],
                    user_id=str(token_data.user_id),
                )
                await conn.execute(
                    "UPDATE bqms_quote_batch_items SET procrastinate_job_id=$1 WHERE id=$2",
                    job_id, item_id,
                )
    except Exception as exc:
        logger.exception("quote-batch: failed to enqueue tasks for batch #%d", batch_id)
        await conn.execute(
            "UPDATE bqms_quote_batches SET status='error' WHERE id=$1",
            batch_id,
        )
        raise HTTPException(500, f"Enqueue lỗi: {exc}")

    logger.info(
        "quote-batch #%d created by user=%s — %d RFQs enqueued to bqms_quote",
        batch_id, token_data.user_id, len(rows),
    )
    return {"data": {"batch_id": batch_id, "total_count": len(rows)}}


@router.get("/vendor-staging/quote-batch/{batch_id}")
async def get_quote_batch_status(
    batch_id: int,
    token_data: TokenData = Depends(require_role("admin", "manager")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Polled bởi frontend — trả về batch summary + per-row progress."""
    batch = await conn.fetchrow(
        "SELECT id, created_at, completed_at, created_by, total_count, "
        "       pending_count, running_count, done_count, error_count, status "
        "FROM bqms_quote_batches WHERE id = $1",
        batch_id,
    )
    if not batch:
        raise HTTPException(404, f"Batch #{batch_id} không tồn tại")

    items = await conn.fetch(
        "SELECT id, staging_id, rfq_number, status, items_count, files_count, "
        "       images_count, upserts_count, classification, error_message, "
        "       started_at, completed_at "
        "FROM bqms_quote_batch_items WHERE batch_id = $1 ORDER BY id",
        batch_id,
    )
    return {
        "data": {
            "batch": dict(batch),
            "items": [dict(it) for it in items],
        }
    }


@router.get("/vendor-staging/quote-batch")
async def list_recent_quote_batches(
    limit: int = Query(20, ge=1, le=100),
    token_data: TokenData = Depends(require_role("admin", "manager")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """List N batches gần nhất — dùng cho lịch sử."""
    rows = await conn.fetch(
        "SELECT id, created_at, completed_at, created_by, total_count, "
        "       pending_count, running_count, done_count, error_count, status "
        "FROM bqms_quote_batches ORDER BY id DESC LIMIT $1",
        limit,
    )
    return {"data": {"batches": [dict(r) for r in rows]}}


@router.post("/bidding/{staging_id}/download-files")
async def download_files_for_bidding_staging(
    staging_id: int,
    token_data: TokenData = Depends(require_role("admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Download all attachments for a single bidding RFQ to local VPS folder
    `Puplic/BQMS/RFQ/RFQ <year>/THANG <month>/<rfq_number>/raw/` and extract
    images from RFQ_*.xlsx into `<folder>/images/`. Per user 2026-05-08:
    local-VPS only, no OneDrive upload.

    The staging row's raw_json supplies the secureKey + form fields needed
    to navigate directly to the RFQ detail in BQMS.
    """
    row = await conn.fetchrow(
        "SELECT id, module, rfq_number, raw_json FROM bqms_vendor_portal_staging WHERE id = $1",
        staging_id,
    )
    if not row:
        raise HTTPException(404, f"Staging row #{staging_id} not found")
    if row["module"] != "bidding":
        raise HTTPException(400, f"Row #{staging_id} module='{row['module']}' — only 'bidding' supported")

    rfq_number = (row["rfq_number"] or "").strip()
    if not rfq_number:
        raise HTTPException(400, f"Row #{staging_id} has no rfq_number")

    raw = row["raw_json"]
    if not isinstance(raw, dict):
        import json as _j
        raw = _j.loads(raw or "{}")

    import threading
    import asyncio as _aio

    result_holder: dict[str, Any] = {}

    def _thread_dl() -> None:
        async def _do() -> None:
            from app.etl.bqms_bidding_scraper import download_files_for_rfq
            from app.core.config import settings as cfg
            import asyncpg as apg

            db_url = (
                str(cfg.DATABASE_URL)
                .replace("+asyncpg", "")
                .replace("postgresql+asyncpg", "postgresql")
            )
            pool = await apg.create_pool(db_url, min_size=1, max_size=2)
            try:
                summary = await download_files_for_rfq(rfq_number, raw, db_pool=pool)
                result_holder["summary"] = summary
            except Exception as exc:
                logger.exception("download_files_for_rfq failed")
                result_holder["error"] = str(exc)[:500]
            finally:
                await pool.close()

        _aio.run(_do())

    t = threading.Thread(target=_thread_dl, daemon=True)
    t.start()
    # Login + nav + many downloads — give it 5 minutes max
    t.join(timeout=300)
    if t.is_alive():
        raise HTTPException(504, "Download timed out after 5 minutes")
    if "error" in result_holder:
        raise HTTPException(500, f"Download failed: {result_holder['error']}")

    summary = result_holder.get("summary") or {}
    logger.info(
        "download-files by user=%s: rfq=%s files=%d images=%d folder_existed=%s",
        token_data.user_id, rfq_number,
        summary.get("downloaded_count"), summary.get("images_extracted"),
        summary.get("folder_pre_existed"),
    )
    return {"data": summary}


@router.get("/vendor-staging")
async def list_vendor_staging(
    status: str | None = Query(None, description="Filter by status: pending_review|approved|rejected|merged"),
    module: str = Query("contract", description="contract | po | bidding"),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    token_data: TokenData = Depends(require_role("admin", "manager")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """List staging rows from bqms_vendor_portal_staging for human review."""
    where = ["module = $1"]
    params: list[Any] = [module]
    if status:
        params.append(status)
        where.append(f"status = ${len(params)}")

    params.extend([limit, offset])
    # Pull useful Bidding-specific fields out of raw_json so the table can show
    # Excel BC BQMS THANG-equivalent columns without a per-row /detail call.
    sql = f"""
        SELECT id, scraped_at, scrape_run_id, module, rfq_number, contract_no,
               contract_period, item_code, description, specification,
               quantity, unit, status, review_notes, reviewed_at, merged_at,
               -- Top-level scraped fields
               raw_json->>'reqName'            AS req_name,
               raw_json->>'regDt'              AS reg_dt,
               raw_json->>'deadlineDt'         AS deadline_dt,
               raw_json->>'submitDt'           AS submit_dt,
               raw_json->>'progressStatusName' AS bd_status,
               raw_json->>'psinchargeName'     AS psincharge_name,
               raw_json->>'criteriaCurrency'   AS currency,
               raw_json->>'itemCnt'            AS item_cnt_text,
               raw_json->>'dday'               AS dday_html,
               raw_json->>'ctrTypeNm'          AS ctr_type_nm,
               -- Drilled detail summary
               raw_json #>> '{{_detail,classification}}'   AS classification,
               raw_json #>> '{{_detail,version}}'          AS detail_version,
               jsonb_array_length(COALESCE(raw_json #> '{{_detail,items}}', '[]'::jsonb))         AS items_count,
               jsonb_array_length(COALESCE(raw_json #> '{{_detail,attachments}}', '[]'::jsonb))   AS attachments_count,
               raw_json #>> '{{_detail,error}}'            AS detail_error,
               raw_json #>> '{{_detail,items,0,maker}}'    AS first_maker,
               raw_json #>> '{{_detail,items,0,part_no}}'  AS first_part_no,
               raw_json #>> '{{_detail,items,0,cis_code}}' AS first_cis_code,
               raw_json #>> '{{_detail,items,0,moq}}'      AS first_moq
        FROM bqms_vendor_portal_staging
        WHERE {' AND '.join(where)}
        ORDER BY scraped_at DESC, id DESC
        LIMIT ${len(params) - 1} OFFSET ${len(params)}
    """
    rows = await conn.fetch(sql, *params)

    count_sql = f"SELECT COUNT(*) FROM bqms_vendor_portal_staging WHERE {' AND '.join(where)}"
    total = await conn.fetchval(count_sql, *params[: len(params) - 2])

    return {
        "data": {
            "items": [dict(r) for r in rows],
            "total": int(total or 0),
            "limit": limit,
            "offset": offset,
        }
    }


@router.get("/vendor-staging/{staging_id}")
async def get_vendor_staging_row(
    staging_id: int,
    token_data: TokenData = Depends(require_role("admin", "manager")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Full raw JSON for a single staging row — used by the review UI."""
    row = await conn.fetchrow(
        "SELECT * FROM bqms_vendor_portal_staging WHERE id = $1",
        staging_id,
    )
    if not row:
        raise HTTPException(404, f"Staging row #{staging_id} không tồn tại")
    return {"data": dict(row)}


class _StagingDecision(BaseModel):
    decision: str  # 'approve' | 'reject'
    notes: str | None = None


@router.post("/vendor-staging/{staging_id}/decide")
async def decide_vendor_staging_row(
    staging_id: int,
    body: _StagingDecision,
    token_data: TokenData = Depends(require_role("admin", "manager")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Approve or reject a staging row. Approved rows are merged into
    bqms_won_quotations by a follow-up job (B7 — not wired yet)."""
    if body.decision not in ("approve", "reject"):
        raise HTTPException(400, "decision phải là 'approve' hoặc 'reject'")
    new_status = "approved" if body.decision == "approve" else "rejected"

    row = await conn.fetchrow(
        """
        UPDATE bqms_vendor_portal_staging
        SET status = $1,
            review_notes = $2,
            reviewed_by = $3,
            reviewed_at = NOW()
        WHERE id = $4
          AND status = 'pending_review'
        RETURNING id, status, reviewed_at
        """,
        new_status, body.notes, token_data.user_id, staging_id,
    )
    if not row:
        raise HTTPException(
            409,
            f"Staging row #{staging_id} không tồn tại hoặc đã được duyệt trước đó",
        )
    return {"data": dict(row)}


# ─── Helpers for B7 merge ─────────────────────────────────────────

import json as _json
import re as _re
from datetime import date as _date


def _parse_money(raw: str | None) -> float | None:
    """Parse '5,000,000 VND' or '139,000' -> 5000000.0 / 139000.0."""
    if not raw:
        return None
    s = _re.sub(r"[^\d.\-]", "", str(raw).replace(",", ""))
    try:
        return float(s) if s else None
    except ValueError:
        return None


def _parse_period_end(raw: str | None) -> _date | None:
    """Parse 'Contract Period' like '5/7/2026 ~ 8/7/2026' -> date(2026,8,7).

    BQMS format is D/M/YYYY (per Phan Van Thao sample). End date is the
    second segment after '~'. Falls back to None on any parse error.
    """
    if not raw:
        return None
    parts = [p.strip() for p in str(raw).split("~")]
    target = parts[-1] if len(parts) > 1 else parts[0]
    m = _re.match(r"(\d{1,2})/(\d{1,2})/(\d{4})", target)
    if not m:
        return None
    d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
    try:
        return _date(y, mo, d)
    except ValueError:
        return None


def _parse_yyyymmdd(raw: str | None) -> _date | None:
    """Parse '20260807' -> date(2026,8,7) — used by MRO REQ_DELIVERY_DATE."""
    if not raw:
        return None
    s = "".join(ch for ch in str(raw) if ch.isdigit())
    if len(s) != 8:
        return None
    try:
        return _date(int(s[:4]), int(s[4:6]), int(s[6:8]))
    except ValueError:
        return None


def _po_row_to_delivery_fields(staging_row, raw: dict) -> dict:
    """Map a module='po' staging row + its raw_json into bqms_deliveries
    column values (NOT bqms_won_quotations — corrected 2026-05-09).

    MRO P/O Receipt → Giao hàng function. raw_json is the per-row MRO grid
    record (PO_NO, ITEM_CODE, BUYING_PRICE, REQ_DELIVERY_DATE, …).
    """
    # PO_CONFIRM_DT is epoch milliseconds (string) — convert to date
    po_dt = None
    raw_dt = raw.get("PO_CONFIRM_DT")
    if raw_dt:
        try:
            po_dt = _date.fromtimestamp(int(raw_dt) / 1000)
        except (TypeError, ValueError):
            po_dt = None
    return {
        "po_number": (raw.get("PO_NO") or "").strip() or None,
        "po_date": po_dt,
        "quotation_no": (staging_row["rfq_number"] or "").strip() or None,
        "bqms_code": (staging_row["item_code"] or "").strip() or None,
        "specification": staging_row["specification"] or raw.get("SPECIFICATION") or None,
        "quantity": staging_row["quantity"],
        "unit": staging_row["unit"] or "EA",
        "unit_price": _parse_money(raw.get("BUYING_PRICE")),
        "amount": _parse_money(raw.get("BUYING_AMOUNT")),
        "recipient_name": raw.get("RECEIVER_NAME") or None,
        "receiving_warehouse": raw.get("DELIVERY_ADDRESS") or None,
        "delivery_date": _parse_yyyymmdd(raw.get("REQ_DELIVERY_DATE")),
    }


def _contract_row_to_won_fields(staging_row, raw: dict) -> dict:
    """Map a module='contract' staging row + its raw_json (which contains
    {contract:{basic_info,...}, item:{...}}) into bqms_won_quotations columns."""
    contract = (raw.get("contract") or {}) if isinstance(raw, dict) else {}
    item = (raw.get("item") or {}) if isinstance(raw, dict) else {}
    basic = contract.get("basic_info") or {}
    return {
        "rfq_number": (staging_row["rfq_number"] or "").strip() or None,
        "bqms_code": (staging_row["item_code"] or "").strip() or None,
        "description": staging_row["description"],
        "specification": staging_row["specification"],
        "quantity": staging_row["quantity"],
        "unit": staging_row["unit"] or "EA",
        "po_price": _parse_money(item.get("unit_price")),
        "po_deadline": _parse_period_end(basic.get("Contract Period")),
        "supplier_name": basic.get("Vendor name") or None,
    }


@router.get("/coverage/excel-vs-portal")
async def excel_vs_portal_coverage(
    year: int | None = Query(None, description="Filter by inquiry year (default: all)"),
    token_data: TokenData = Depends(require_role("admin", "manager")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Phase J — Coverage report for "đã có thể bỏ Excel chưa".

    Compares bqms_rfq rows by data_source:
      - excel_import / onedrive_sync = legacy Excel chain
      - etl = Vendor Portal direct scrape
      - manual = nhập tay

    Returns counts + overlap analysis (RFQ that exist in BOTH chains, only Excel,
    only Portal). Used by /admin/vendor-staging "Coverage" panel.
    """
    where = "1=1"
    params: list[Any] = []
    if year:
        where = "EXTRACT(YEAR FROM COALESCE(inquiry_date, created_at::date)) = $1"
        params = [year]

    rows = await conn.fetch(
        f"""
        SELECT data_source, COUNT(*) AS n,
               COUNT(DISTINCT rfq_number) AS distinct_rfq
        FROM bqms_rfq
        WHERE {where}
        GROUP BY data_source
        ORDER BY data_source
        """,
        *params,
    )
    by_source = {r["data_source"] or "unknown": {"items": int(r["n"]), "rfq": int(r["distinct_rfq"])} for r in rows}

    # Overlap: RFQ numbers seen in BOTH legacy excel and etl
    overlap_row = await conn.fetchrow(
        f"""
        WITH legacy AS (
          SELECT DISTINCT rfq_number FROM bqms_rfq
          WHERE {where}
            AND data_source IN ('excel_import','onedrive_sync')
            AND rfq_number IS NOT NULL
        ),
        portal AS (
          SELECT DISTINCT rfq_number FROM bqms_rfq
          WHERE {where}
            AND data_source = 'etl'
            AND rfq_number IS NOT NULL
        )
        SELECT
          (SELECT COUNT(*) FROM legacy) AS legacy_only_or_overlap,
          (SELECT COUNT(*) FROM portal) AS portal_only_or_overlap,
          (SELECT COUNT(*) FROM legacy l JOIN portal p USING(rfq_number)) AS overlap,
          (SELECT COUNT(*) FROM legacy l WHERE NOT EXISTS (SELECT 1 FROM portal p WHERE p.rfq_number = l.rfq_number)) AS only_legacy,
          (SELECT COUNT(*) FROM portal p WHERE NOT EXISTS (SELECT 1 FROM legacy l WHERE l.rfq_number = p.rfq_number)) AS only_portal
        """,
        *params,
    )

    legacy_total = int(overlap_row["legacy_only_or_overlap"] or 0)
    portal_total = int(overlap_row["portal_only_or_overlap"] or 0)
    overlap = int(overlap_row["overlap"] or 0)
    only_legacy = int(overlap_row["only_legacy"] or 0)
    only_portal = int(overlap_row["only_portal"] or 0)

    # Coverage % = (overlap + only_portal) / (legacy + only_portal) — how much
    # of the legacy chain we've already covered + new items the portal caught
    union = legacy_total + only_portal
    coverage_pct = round(100.0 * (overlap + only_portal) / union, 1) if union > 0 else 0.0

    return {
        "data": {
            "year": year,
            "by_source": by_source,
            "rfq_overlap": {
                "legacy_total_distinct": legacy_total,
                "portal_total_distinct": portal_total,
                "overlap": overlap,
                "only_legacy": only_legacy,
                "only_portal": only_portal,
            },
            "coverage_pct": coverage_pct,
            "ready_to_deprecate_excel": coverage_pct >= 95.0 and only_legacy < 10,
        }
    }


@router.post("/vendor-staging/merge-approved")
async def merge_approved_vendor_staging(
    module: str = Query("contract", description="contract | po"),
    token_data: TokenData = Depends(require_role("admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Merge all staging rows with status='approved' into the function's
    target table — module-specific dispatch:

      module='contract' (Contract Mgmt)  → bqms_won_quotations  (Trúng BG)
      module='po'       (MRO P/O Receipt)→ bqms_deliveries      (Giao hàng)

    For each approved-but-not-yet-merged row:
      - INSERT into target table
      - UPDATE staging.status='merged', staging.merged_at=NOW()
      - Skip if natural key already exists (re-scrape protection)
    """
    if module not in ("contract", "po"):
        raise HTTPException(400, "module phải là 'contract' hoặc 'po'")

    rows = await conn.fetch(
        """
        SELECT id, rfq_number, item_code, description, specification,
               quantity, unit, raw_json
        FROM bqms_vendor_portal_staging
        WHERE module = $1
          AND status = 'approved'
          AND merged_at IS NULL
        ORDER BY id
        FOR UPDATE
        """,
        module,
    )
    target_table = "bqms_won_quotations" if module == "contract" else "bqms_deliveries"

    if not rows:
        return {
            "data": {
                "module": module,
                "target_table": target_table,
                "merged": 0,
                "skipped_duplicate": 0,
                "errors": [],
            }
        }
    merged = 0
    skipped = 0
    errors: list[dict] = []

    async with conn.transaction():
        for r in rows:
            try:
                raw = r["raw_json"] if isinstance(r["raw_json"], dict) else _json.loads(r["raw_json"] or "{}")
                if not isinstance(raw, dict):
                    raw = {}

                if module == "contract":
                    fields = _contract_row_to_won_fields(r, raw)
                    rfq_number = fields["rfq_number"]
                    bqms_code = fields["bqms_code"]
                    # Dedupe: same (rfq_number, bqms_code) already in won_quotations
                    if bqms_code and rfq_number:
                        exists = await conn.fetchval(
                            "SELECT 1 FROM bqms_won_quotations "
                            "WHERE rfq_number = $1 AND bqms_code = $2 LIMIT 1",
                            rfq_number, bqms_code,
                        )
                        if exists:
                            skipped += 1
                            await conn.execute(
                                "UPDATE bqms_vendor_portal_staging "
                                "SET status='merged', merged_at=NOW(), "
                                "review_notes = COALESCE(review_notes, '') || $1 "
                                "WHERE id = $2",
                                f" [skip: already in {target_table}]", r["id"],
                            )
                            continue
                    await conn.execute(
                        """
                        INSERT INTO bqms_won_quotations
                            (rfq_number, bqms_code, description, specification,
                             quantity, unit, po_price, po_deadline, supplier_name)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                        """,
                        fields["rfq_number"], fields["bqms_code"],
                        fields["description"], fields["specification"],
                        fields["quantity"], fields["unit"],
                        fields["po_price"], fields["po_deadline"],
                        fields["supplier_name"],
                    )
                else:  # module == "po" → bqms_deliveries
                    fields = _po_row_to_delivery_fields(r, raw)
                    po_number = fields["po_number"]
                    bqms_code = fields["bqms_code"]
                    # Dedupe: same (po_number, bqms_code) already in deliveries
                    if po_number and bqms_code:
                        exists = await conn.fetchval(
                            "SELECT 1 FROM bqms_deliveries "
                            "WHERE po_number = $1 AND bqms_code = $2 LIMIT 1",
                            po_number, bqms_code,
                        )
                        if exists:
                            skipped += 1
                            await conn.execute(
                                "UPDATE bqms_vendor_portal_staging "
                                "SET status='merged', merged_at=NOW(), "
                                "review_notes = COALESCE(review_notes, '') || $1 "
                                "WHERE id = $2",
                                f" [skip: already in {target_table}]", r["id"],
                            )
                            continue
                    await conn.execute(
                        """
                        INSERT INTO bqms_deliveries
                            (po_number, po_date, quotation_no, bqms_code,
                             specification, quantity, unit, unit_price, amount,
                             recipient_name, receiving_warehouse, delivery_date,
                             delivery_status, data_source)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,
                                $10, $11, $12, 'chua_giao', 'etl')
                        """,
                        fields["po_number"], fields["po_date"],
                        fields["quotation_no"], fields["bqms_code"],
                        fields["specification"], fields["quantity"],
                        fields["unit"], fields["unit_price"], fields["amount"],
                        fields["recipient_name"], fields["receiving_warehouse"],
                        fields["delivery_date"],
                    )

                await conn.execute(
                    "UPDATE bqms_vendor_portal_staging "
                    "SET status='merged', merged_at=NOW() WHERE id = $1",
                    r["id"],
                )
                merged += 1
            except Exception as exc:
                logger.exception("merge failed for staging row %d (module=%s)", r["id"], module)
                errors.append({"id": r["id"], "error": str(exc)[:300]})

    logger.info(
        "merge-approved by user=%s: module=%s target=%s merged=%d skipped=%d errors=%d",
        token_data.user_id, module, target_table, merged, skipped, len(errors),
    )
    return {
        "data": {
            "module": module,
            "target_table": target_table,
            "merged": merged,
            "skipped_duplicate": skipped,
            "errors": errors,
        }
    }


# ---------------------------------------------------------------------------
# Phase 4.2 (Thang 2026-05-12 audit follow-up):
# Contract endpoints — list / detail / trigger merger.
# ---------------------------------------------------------------------------

@router.post("/contracts/merge")
async def trigger_contracts_merge(
    token_data: TokenData = Depends(require_role("admin", "manager")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Merge tất cả contract staging vào bqms_contracts. Idempotent."""
    from app.services.bqms_contract_merger import merge_contracts
    stats = await merge_contracts(conn)
    return {"data": stats, "message": "Đã merge contracts"}


@router.get("/contracts")
async def list_contracts(
    search: str | None = Query(None),
    status: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=10, le=200),
    token_data: TokenData = Depends(require_role(
        "admin", "manager", "staff", "sales",
        "procurement", "warehouse", "accountant",
    )),
    conn: asyncpg.Connection = Depends(get_db),
):
    """List hợp đồng đã ký với Samsung."""
    conds = ["1=1"]
    params: list[Any] = []
    idx = 1
    if search:
        like = f"%{search.strip()}%"
        conds.append(
            f"(contract_no ILIKE ${idx} OR request_no ILIKE ${idx} "
            f"OR vendor_name ILIKE ${idx} OR subject ILIKE ${idx})"
        )
        params.append(like)
        idx += 1
    if status:
        conds.append(f"status = ${idx}")
        params.append(status)
        idx += 1
    where = " AND ".join(conds)
    total = await conn.fetchval(
        f"SELECT COUNT(*) FROM bqms_contracts WHERE {where}", *params,
    )
    params.extend([page_size, (page - 1) * page_size])
    rows = await conn.fetch(
        f"""
        SELECT c.id, c.contract_no, c.request_no, c.contract_kind,
               c.contract_type, c.subject, c.status, c.amount, c.currency,
               c.contract_period, c.contract_start, c.contract_end,
               c.vendor_name, c.created_by_samsung, c.reconciliation,
               c.won_quotation_id, c.rfq_id, c.synced_at, c.created_at,
               (SELECT COUNT(*) FROM bqms_contract_items ci WHERE ci.contract_id = c.id) AS item_count
        FROM bqms_contracts c
        WHERE {where}
        ORDER BY c.contract_start DESC NULLS LAST, c.id DESC
        LIMIT ${idx} OFFSET ${idx + 1}
        """,
        *params,
    )
    def _ser(r):
        d = dict(r)
        for k, v in d.items():
            if isinstance(v, (date, datetime)):
                d[k] = v.isoformat()
            elif hasattr(v, "__float__") and not isinstance(v, (int, bool)):
                try: d[k] = float(v)
                except Exception: pass
        return d
    return {
        "data": {
            "items": [_ser(r) for r in rows],
            "total": int(total or 0),
            "page": page,
            "page_size": page_size,
        }
    }


@router.get("/contracts/{contract_id}")
async def contract_detail(
    contract_id: int,
    token_data: TokenData = Depends(require_role(
        "admin", "manager", "staff", "sales",
        "procurement", "warehouse", "accountant",
    )),
    conn: asyncpg.Connection = Depends(get_db),
):
    row = await conn.fetchrow(
        "SELECT * FROM bqms_contracts WHERE id = $1", contract_id,
    )
    if not row:
        raise HTTPException(404, "Contract không tồn tại")
    items = await conn.fetch(
        "SELECT * FROM bqms_contract_items WHERE contract_id = $1 ORDER BY item_no",
        contract_id,
    )
    def _ser(r):
        d = dict(r)
        for k, v in d.items():
            if isinstance(v, (date, datetime)): d[k] = v.isoformat()
            elif hasattr(v, "__float__") and not isinstance(v, (int, bool)):
                try: d[k] = float(v)
                except Exception: pass
        return d
    return {"data": {"contract": _ser(row), "items": [_ser(it) for it in items]}}


# PR-2 (Thang 2026-05-13): /quote-image-override POST/DELETE/check
# extracted to bqms_images.py — mounted with same /bqms prefix.


# ---------------------------------------------------------------------------
# Phase 4.3 (Thang 2026-05-12): MRO PO list (Samsung POs from scraper).
# Source: bqms_samsung_po. Show with link to bqms_deliveries.
# ---------------------------------------------------------------------------

@router.get("/mro/po")
async def list_mro_po(
    search: str | None = Query(None),
    process_status: str | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=10, le=200),
    token_data: TokenData = Depends(require_role(
        "admin", "manager", "staff", "sales",
        "procurement", "warehouse", "accountant",
    )),
    conn: asyncpg.Connection = Depends(get_db),
):
    """List Samsung PO (MRO P/O Receipt)."""
    conds = ["1=1"]
    params: list[Any] = []
    idx = 1
    if search:
        like = f"%{search.strip()}%"
        conds.append(
            f"(p.po_number ILIKE ${idx} OR p.bqms_code ILIKE ${idx} "
            f"OR p.specification ILIKE ${idx} OR p.maker ILIKE ${idx})"
        )
        params.append(like); idx += 1
    if process_status:
        conds.append(f"p.process_status::text = ${idx}")
        params.append(process_status); idx += 1
    where = " AND ".join(conds)
    total = await conn.fetchval(
        f"SELECT COUNT(*) FROM bqms_samsung_po p WHERE {where}", *params,
    )
    params.extend([page_size, (page - 1) * page_size])
    rows = await conn.fetch(
        f"""
        SELECT p.id, p.po_number, p.po_date, p.bqms_code, p.specification,
               p.maker, p.order_qty, p.unit_price, p.amount, p.currency::text AS currency,
               p.preferred_delivery_date, p.process_status::text AS process_status,
               p.vendor_code, p.buyer_name, p.company, p.plant,
               p.shipping_qty, p.gr_qty, p.invoice_qty,
               (SELECT COUNT(*) FROM bqms_deliveries d WHERE d.samsung_po_id = p.id) AS delivery_count
        FROM bqms_samsung_po p
        WHERE {where}
        ORDER BY p.po_date DESC NULLS LAST, p.id DESC
        LIMIT ${idx} OFFSET ${idx + 1}
        """,
        *params,
    )
    def _ser(r):
        d = dict(r)
        for k, v in d.items():
            if isinstance(v, (date, datetime)): d[k] = v.isoformat()
            elif hasattr(v, "__float__") and not isinstance(v, (int, bool)):
                try: d[k] = float(v)
                except Exception: pass
        return d
    return {
        "data": {
            "items": [_ser(r) for r in rows],
            "total": int(total or 0),
            "page": page,
            "page_size": page_size,
        }
    }


# ═══════════════════════════════════════════════════════════════════
# BQMS Auto-Submit (Thang 2026-05-14) — đẩy báo giá lên sec-bqms qua Playwright
# ═══════════════════════════════════════════════════════════════════

@router.get("/rfq/{rfq_id}/push-preview")
async def get_push_preview(
    rfq_id: int,
    round_n: int = Query(1, ge=1, le=4),
    token_data: TokenData = Depends(require_role("admin", "manager", "staff", "sales")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Build payload đề xuất cho Push to SEC modal."""
    from app.services.bqms_image_resizer import resize_for_samsung, resolve_image_for_bqms_code
    from datetime import date, timedelta

    rfq = await conn.fetchrow(
        """SELECT id, rfq_number, classification_override, notes, maker
           FROM bqms_rfq WHERE id = $1""", rfq_id,
    )
    if not rfq:
        raise HTTPException(404, f"RFQ #{rfq_id} không tồn tại")

    rfq_number = rfq["rfq_number"]
    classification = (rfq["classification_override"] or "").upper().strip()
    if not classification:
        notes = (rfq["notes"] or "").lower()
        if "classification=gc" in notes:
            classification = "GC"
        elif "classification=tm" in notes:
            classification = "TM"
        else:
            classification = "TM"

    items_db = await conn.fetch(
        """SELECT id, rfq_number, bqms_code, specification,
                  expected_qty, unit, maker,
                  quoted_price_bqms_v1, quoted_price_bqms_v2,
                  quoted_price_bqms_v3, quoted_price_bqms_v4
           FROM bqms_rfq WHERE rfq_number = $1 ORDER BY id""", rfq_number,
    )
    if not items_db:
        raise HTTPException(400, "Không có item nào")

    # Fetch REAL description per bqms_code from staging.raw_json._detail.items.
    # bqms_rfq table không có cột description; description thật ("CNC BRUSH",
    # "BLADE") chỉ tồn tại trong staging từ lúc scrape items. Map by bqms_code.
    # Per Thang 2026-05-15: Submission Opinion phải dùng description, không
    # phải specification.
    description_map: dict[str, str] = {}
    try:
        staging_row = await conn.fetchrow(
            """SELECT raw_json FROM bqms_vendor_portal_staging
               WHERE module='bidding' AND rfq_number=$1
               ORDER BY id DESC LIMIT 1""", rfq_number,
        )
        if staging_row and staging_row["raw_json"]:
            raw = staging_row["raw_json"]
            if isinstance(raw, str):
                raw = _json.loads(raw)
            detail = (raw.get("_detail") or {})
            for det_it in (detail.get("items") or []):
                c = (det_it.get("item_code") or "").strip()
                d = (det_it.get("description") or "").strip()
                if c and d:
                    description_map[c] = d
    except Exception as exc:
        logger.warning("push-preview description_map fetch failed for %s: %s",
                       rfq_number, str(exc)[:120])

    items_out: list[dict] = []
    warnings: list[str] = []
    for it in items_db:
        code = it["bqms_code"]
        if not code:
            continue
        # Round 1 needs image; round 2+ uses Samsung's stored image (don't re-upload)
        img_src = resolve_image_for_bqms_code(code, rfq_number) if round_n == 1 else None
        image_path = None
        image_source = "missing"
        if round_n == 1:
            if img_src:
                try:
                    resized = resize_for_samsung(img_src)
                    image_path = str(resized)
                    image_source = "override" if "quote-overrides" in str(img_src) else "auto"
                except Exception as exc:
                    warnings.append(f"{code}: resize ảnh lỗi - {exc}")
            else:
                warnings.append(f"{code}: không tìm thấy ảnh")
        else:
            # Round 2+: no image upload required, Samsung keeps the V1 image.
            image_source = "skip_round_gt_1"

        price_v = it[f"quoted_price_bqms_v{round_n}"]
        if price_v is None and round_n > 1:
            for r in range(round_n - 1, 0, -1):
                price_v = it[f"quoted_price_bqms_v{r}"]
                if price_v is not None:
                    break
        if price_v is None:
            warnings.append(f"{code}: chưa có giá V{round_n}")

        # Real description from staging (e.g., "CNC BRUSH"), fallback to spec
        real_desc = description_map.get(code) or it["specification"] or code

        items_out.append({
            "rfq_item_id": int(it["id"]),
            "bqms_code": code,
            "description": real_desc[:200],
            "specification": it["specification"],
            "quantity": float(it["expected_qty"] or 0),
            "unit": it["unit"] or "Piece",
            "maker": it["maker"] or "",
            "image_path": image_path,
            "image_source": image_source,
            "quotation_price": float(price_v) if price_v is not None else 0,
            "abandonment": "N",
            "lead_time_days": 30,
        })

    opinion = ", ".join(i["description"] for i in items_out if i["abandonment"] == "N")

    today = date.today()
    try:
        valid = today.replace(month=today.month + 3) if today.month <= 9 else date(today.year + 1, ((today.month + 3) - 1) % 12 + 1, today.day)
    except ValueError:
        valid = today + timedelta(days=90)

    base_folder = _find_round_folder_bqms(rfq_number, round_n)
    attachment_paths: list[str] = []
    if base_folder and base_folder.exists():
        skip_cam_ket = any(
            kw in (rfq["maker"] or "").lower()
            for kw in ["samsung", "sec ", "samsung electro"]
        )
        if classification == "TM":
            for f in sorted(base_folder.iterdir()):
                if not f.is_file():
                    continue
                ln = f.name.lower()
                if ln.endswith(".pdf"):
                    is_cam_ket = any(k in ln for k in ["cam_ket", "cam-ket", "camket", "commit"])
                    if is_cam_ket and skip_cam_ket:
                        continue
                    attachment_paths.append(str(f))
        elif classification == "GC":
            for f in sorted(base_folder.iterdir()):
                if not f.is_file():
                    continue
                ln = f.name.lower()
                if ln.endswith((".xlsx", ".xls", ".pdf")):
                    attachment_paths.append(str(f))
    else:
        warnings.append(f"Chưa có folder L{round_n} — anh quote V{round_n} trong ERP trước")
    if not attachment_paths:
        warnings.append(f"Không tìm thấy file đính kèm trong folder L{round_n}")

    return {
        "data": {
            "rfq_id": rfq_id,
            "rfq_number": rfq_number,
            "classification": classification,
            "round": round_n,
            "items": items_out,
            "submission_opinion": opinion,
            "quote_valid_date": valid.isoformat(),
            "attachment_paths": attachment_paths,
            "warnings": warnings,
        }
    }


def _find_round_folder_bqms(rfq_number: str, round_n: int):
    """Locate /data/onedrive-staging/.../{QT}_*/QT_AMA BAC NINH_L{round}/"""
    from pathlib import Path as _Path
    from datetime import datetime as _dt
    root = _Path("/data/onedrive-staging/Puplic/BQMS/RFQ")
    now = _dt.now()
    for y in [now.year, now.year - 1]:
        year_root = root / f"RFQ {y}"
        if not year_root.exists():
            continue
        for m in range(12, 0, -1):
            month_root = year_root / f"THANG {m}"
            if not month_root.exists():
                continue
            for d in month_root.iterdir():
                if not d.is_dir():
                    continue
                if d.name != rfq_number and not d.name.startswith(f"{rfq_number}_"):
                    continue
                round_sub = d / f"{rfq_number}_AMA BAC NINH_L{round_n}"
                if round_sub.exists():
                    return round_sub
    return None


class PushToSecRequest(BaseModel):
    items: list[dict[str, Any]]
    submission_opinion: str
    quote_valid_date: str
    attachment_paths: list[str]
    round: int = 1


@router.post("/rfq/{rfq_id}/push-to-sec")
async def push_to_sec(
    rfq_id: int,
    body: PushToSecRequest,
    token_data: TokenData = Depends(require_role("admin", "manager", "staff", "sales")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Dispatch Procrastinate task bqms_submit_quote."""
    rfq = await conn.fetchrow(
        "SELECT id, rfq_number, bqms_push_status FROM bqms_rfq WHERE id = $1",
        rfq_id,
    )
    if not rfq:
        raise HTTPException(404)
    if rfq["bqms_push_status"] in ("queued", "running"):
        raise HTTPException(409, f"QT đang được đẩy (status={rfq['bqms_push_status']})")

    errors: list[str] = []
    if not body.submission_opinion or not body.submission_opinion.strip():
        errors.append("Submission Opinion rỗng")
    if not body.attachment_paths:
        errors.append("Cần ít nhất 1 file đính kèm")
    # Image required ONLY on round 1 — rounds 2-4 reuse Samsung's stored image.
    image_required = (body.round == 1)
    for i, it in enumerate(body.items, 1):
        if it.get("abandonment", "N") == "Y":
            continue
        if image_required and not it.get("image_path"):
            errors.append(f"Item #{i} ({it.get('bqms_code')}) thiếu ảnh")
        if not it.get("quotation_price") or float(it["quotation_price"]) <= 0:
            errors.append(f"Item #{i} ({it.get('bqms_code')}) thiếu giá")
    if errors:
        raise HTTPException(400, detail={"errors": errors})

    payload = {
        "rfq_number": rfq["rfq_number"],
        "round": body.round,
        "items": body.items,
        "submission_opinion": body.submission_opinion,
        "quote_valid_date": body.quote_valid_date,
        "attachment_paths": body.attachment_paths,
    }
    await conn.execute(
        """UPDATE bqms_rfq SET
            bqms_push_status='queued',
            bqms_push_payload=$1::jsonb,
            bqms_push_error=NULL
           WHERE id=$2""",
        _json.dumps(payload), rfq_id,
    )

    from app.tasks.bqms_auto_submit import bqms_submit_quote_task
    from app.core.procrastinate_app import app as proc_app
    # FIX (Thang 2026-05-15): Procrastinate app chưa được open trong FastAPI lifespan
    # → cần wrap với open_async() như pattern ở /vendor-staging/quote-batch (line 4111).
    async with proc_app.open_async():
        job_id = await bqms_submit_quote_task.defer_async(
            rfq_id=rfq_id, payload=payload, user_id=str(token_data.user_id),
        )
    await conn.execute(
        "UPDATE bqms_rfq SET bqms_push_job_id=$1 WHERE id=$2",
        str(job_id), rfq_id,
    )
    position = await conn.fetchval(
        """SELECT COUNT(*) FROM procrastinate_jobs
           WHERE queue_name='bqms_push' AND status IN ('todo', 'doing')""",
    )
    logger.info("push_to_sec dispatched: rfq_id=%d job_id=%s pos=%s", rfq_id, job_id, position)
    return {
        "data": {
            "job_id": str(job_id),
            "queue_position": int(position or 1),
            "rfq_number": rfq["rfq_number"],
        },
        "message": f"Đã queue. Vị trí #{position}",
    }


@router.get("/push-queue/status")
async def get_push_queue_status(
    token_data: TokenData = Depends(require_role("admin", "manager", "staff", "sales")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Danh sách tất cả job queued + running + recent done."""
    rows = await conn.fetch(
        """
        SELECT r.id, r.rfq_number, r.bqms_push_status, r.bqms_push_job_id,
               r.bqms_push_error, r.bqms_pushed_at, r.bqms_pushed_round,
               r.bqms_push_screenshot_path,
               j.status AS job_status, j.scheduled_at, j.attempts
        FROM bqms_rfq r
        LEFT JOIN procrastinate_jobs j ON j.id::text = r.bqms_push_job_id
        WHERE r.bqms_push_status IN ('queued', 'running', 'failed', 'saved_temp')
          AND (r.bqms_pushed_at IS NULL OR r.bqms_pushed_at > NOW() - INTERVAL '24 hours')
        ORDER BY
            CASE r.bqms_push_status
                WHEN 'running' THEN 1
                WHEN 'queued' THEN 2
                WHEN 'failed' THEN 3
                ELSE 4
            END,
            r.bqms_pushed_at DESC NULLS LAST
        LIMIT 20
        """,
    )
    def _ser_q(r):
        d = dict(r)
        for k, v in d.items():
            if isinstance(v, (date, datetime)):
                d[k] = v.isoformat()
        return d
    return {"data": [_ser_q(r) for r in rows]}


@router.get("/rfq/{rfq_id}/push-screenshot")
async def get_push_screenshot(
    rfq_id: int,
    token_data: TokenData = Depends(require_role("admin", "manager", "staff", "sales")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Stream screenshot evidence."""
    from fastapi.responses import FileResponse
    from pathlib import Path as _Path
    row = await conn.fetchrow(
        "SELECT bqms_push_screenshot_path FROM bqms_rfq WHERE id = $1", rfq_id,
    )
    if not row or not row["bqms_push_screenshot_path"]:
        raise HTTPException(404, "Chưa có screenshot")
    p = _Path(row["bqms_push_screenshot_path"])
    if not p.exists():
        raise HTTPException(404, "Screenshot file đã bị xóa")
    return FileResponse(str(p), media_type="image/png")


@router.post("/rfq/{rfq_id}/push-preview/upload-image")
async def upload_override_image(
    rfq_id: int,
    bqms_code: str = Query(...),
    file: UploadFile = File(...),
    token_data: TokenData = Depends(require_role("admin", "manager", "staff", "sales")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Admin upload ảnh override."""
    from pathlib import Path as _Path
    rfq = await conn.fetchrow("SELECT rfq_number FROM bqms_rfq WHERE id = $1", rfq_id)
    if not rfq:
        raise HTTPException(404)
    ext = _Path(file.filename or "").suffix.lower()
    if ext not in (".png", ".jpg", ".jpeg"):
        raise HTTPException(400, "Chỉ PNG/JPG")
    ovr_dir = _Path(f"/data/quote-overrides/{rfq['rfq_number']}")
    ovr_dir.mkdir(parents=True, exist_ok=True)
    out_path = ovr_dir / f"{bqms_code}__product_photo{ext}"
    contents = await file.read()
    out_path.write_bytes(contents)
    logger.info("Override image saved: %s (%d bytes)", out_path, len(contents))
    return {"data": {"path": str(out_path), "size": len(contents)}}
