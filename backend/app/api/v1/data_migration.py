"""
Data Migration Center API (M17) — ETL sync history, sync status,
import stats, and data quality checks for Song Châu ERP.

Endpoints:
  GET  /sync-history       — List ETL sync logs with pagination
  GET  /sync-status        — Current sync status per source
  POST /trigger-sync/{type} — Manually trigger a sync
  GET  /import-stats       — Row counts and last import date per table
  GET  /data-quality       — List data quality check results
  POST /data-quality/run   — Run data quality checks and save results
"""

from __future__ import annotations

import logging
from typing import Optional

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.config import settings
from app.core.database import get_db
from app.core.rbac import require_role
from app.core.security import TokenData

logger = logging.getLogger(__name__)

router = APIRouter()

# Known sync types with human-readable labels
SYNC_TYPES = {
    "bqms": "Samsung BQMS",
    "onedrive": "OneDrive / SharePoint",
    "erp": "ERP nội bộ",
    "inventory": "Tồn kho",
}


# ---------------------------------------------------------------------------
# GET /sync-history — List ETL sync logs
# ---------------------------------------------------------------------------

@router.get("/sync-history")
async def sync_history(
    sync_type: Optional[str] = Query(None),
    status: Optional[str] = Query(None, description="running | completed | failed | partial"),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    token_data: TokenData = Depends(require_role("admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """List ETL sync log entries with optional filters and pagination."""
    conditions = ["1=1"]
    params: list = []
    idx = 1

    if sync_type:
        conditions.append(f"sync_type = ${idx}")
        params.append(sync_type)
        idx += 1

    if status:
        conditions.append(f"status = ${idx}")
        params.append(status)
        idx += 1

    where = " AND ".join(conditions)

    total = await conn.fetchval(
        f"SELECT COUNT(*) FROM etl_sync_log WHERE {where}", *params
    )

    offset = (page - 1) * limit
    rows = await conn.fetch(
        f"""
        SELECT
            id, sync_type, status, started_at, completed_at,
            rows_inserted, rows_skipped, error_message,
            EXTRACT(EPOCH FROM (completed_at - started_at))::INT AS duration_seconds
        FROM etl_sync_log
        WHERE {where}
        ORDER BY started_at DESC
        LIMIT ${idx} OFFSET ${idx + 1}
        """,
        *params,
        limit,
        offset,
    )

    return {
        "data": {
            "items": [
                {
                    "id": r["id"],
                    "sync_type": r["sync_type"],
                    "status": r["status"],
                    "started_at": r["started_at"].isoformat() if r["started_at"] else None,
                    "completed_at": r["completed_at"].isoformat() if r["completed_at"] else None,
                    "rows_inserted": r["rows_inserted"],
                    "rows_skipped": r["rows_skipped"],
                    "error_message": r["error_message"],
                    "duration_seconds": r["duration_seconds"],
                }
                for r in rows
            ],
            "total": total,
            "page": page,
            "limit": limit,
        },
        "message": f"Lịch sử đồng bộ ETL ({total} bản ghi)",
    }


# ---------------------------------------------------------------------------
# GET /sync-status — Current sync status per source
# ---------------------------------------------------------------------------

@router.get("/sync-status")
async def sync_status(
    token_data: TokenData = Depends(require_role("admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """
    Returns the most recent sync status for each known sync type,
    including last success time and next scheduled run estimate.
    """
    rows = await conn.fetch(
        """
        SELECT DISTINCT ON (sync_type)
            sync_type, status, started_at, completed_at,
            rows_inserted, rows_skipped, error_message
        FROM etl_sync_log
        ORDER BY sync_type, started_at DESC
        """
    )

    syncs_by_type = {r["sync_type"]: r for r in rows}

    result = []
    for stype, label in SYNC_TYPES.items():
        r = syncs_by_type.get(stype)
        if r:
            result.append({
                "sync_type": stype,
                "label": label,
                "status": r["status"],
                "last_started": r["started_at"].isoformat() if r["started_at"] else None,
                "last_completed": r["completed_at"].isoformat() if r["completed_at"] else None,
                "rows_inserted": r["rows_inserted"],
                "error_message": r["error_message"],
            })
        else:
            result.append({
                "sync_type": stype,
                "label": label,
                "status": "never_run",
                "last_started": None,
                "last_completed": None,
                "rows_inserted": None,
                "error_message": None,
            })

    # Also return any sync types in the DB not in our known list
    for stype, r in syncs_by_type.items():
        if stype not in SYNC_TYPES:
            result.append({
                "sync_type": stype,
                "label": stype,
                "status": r["status"],
                "last_started": r["started_at"].isoformat() if r["started_at"] else None,
                "last_completed": r["completed_at"].isoformat() if r["completed_at"] else None,
                "rows_inserted": r["rows_inserted"],
                "error_message": r["error_message"],
            })

    return {
        "data": result,
        "message": "Trạng thái đồng bộ hiện tại",
    }


# ---------------------------------------------------------------------------
# POST /trigger-sync/{sync_type} — Manually trigger a sync
# ---------------------------------------------------------------------------

@router.post("/trigger-sync/{sync_type}")
async def trigger_sync(
    sync_type: str,
    token_data: TokenData = Depends(require_role("admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """
    Manually trigger a sync for the given sync_type.
    Creates a new etl_sync_log entry with status='running'.
    Actual sync is handled by background workers.
    """
    valid_types = list(SYNC_TYPES.keys()) + ["manual"]
    if sync_type not in valid_types:
        raise HTTPException(
            status_code=400,
            detail=f"Loại sync không hợp lệ. Hợp lệ: {', '.join(valid_types)}",
        )

    # Check if a sync is already running for this type
    running = await conn.fetchval(
        "SELECT id FROM etl_sync_log WHERE sync_type = $1 AND status = 'running' LIMIT 1",
        sync_type,
    )
    if running:
        raise HTTPException(
            status_code=409,
            detail=f"Đồng bộ '{sync_type}' đang chạy (id={running}). Vui lòng chờ hoàn thành.",
        )

    row_id = await conn.fetchval(
        """
        INSERT INTO etl_sync_log (sync_type, status, started_at)
        VALUES ($1, 'running', NOW())
        RETURNING id
        """,
        sync_type,
    )

    logger.info(
        "Manual sync triggered: type=%s by user=%s log_id=%s",
        sync_type,
        token_data.user_id,
        row_id,
    )

    # Actually run the sync in background thread (not just create a record)
    import threading

    def _run_sync():
        try:
            if sync_type == "onedrive":
                from app.tasks.onedrive_sync import onedrive_delta_sync
                result = onedrive_delta_sync(timestamp=0)
                logger.info("OneDrive sync completed: %s", result)
            elif sync_type == "bqms":
                from app.tasks.bqms_sync import bqms_nightly_sync
                result = bqms_nightly_sync(timestamp=0)
                logger.info("BQMS sync completed: %s", result)
            else:
                logger.info("No sync handler for type=%s", sync_type)
        except Exception as exc:
            logger.error("Sync %s failed: %s", sync_type, exc)
            # Update the sync log entry to failed
            import psycopg2
            try:
                c = psycopg2.connect(
                    f"postgresql://{settings.POSTGRES_USER}:{settings.POSTGRES_PASSWORD}"
                    f"@postgres:5432/{settings.POSTGRES_DB}"
                )
                with c, c.cursor() as cur:
                    cur.execute(
                        "UPDATE etl_sync_log SET status='error', error_message=%s, completed_at=NOW() WHERE id=%s",
                        (str(exc)[:500], row_id),
                    )
                c.close()
            except Exception:
                pass

    thread = threading.Thread(target=_run_sync, daemon=True)
    thread.start()

    return {
        "data": {
            "log_id": row_id,
            "sync_type": sync_type,
            "status": "running",
        },
        "message": f"Đã kích hoạt đồng bộ '{sync_type}' thật sự. Log ID: {row_id}. Đang chạy nền...",
    }


# ---------------------------------------------------------------------------
# GET /import-stats — Stats per table
# ---------------------------------------------------------------------------

@router.get("/import-stats")
async def import_stats(
    token_data: TokenData = Depends(require_role("admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """
    Returns row counts and estimated last import date for key business tables.
    Uses pg_class for fast row estimates and etl_sync_log for import dates.
    """
    # Fast row count estimates for key tables
    key_tables = [
        "users", "suppliers", "purchase_orders", "po_line_items",
        "sales_orders", "so_line_items", "inventory", "bqms_rfq",
        "bqms_rfq_items", "etl_sync_log", "audit_log", "notifications",
        "task_assignments", "error_log", "retry_queue",
    ]

    table_stats = []
    for tbl in key_tables:
        try:
            row_count = await conn.fetchval(
                """
                SELECT reltuples::BIGINT
                FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE c.relname = $1 AND n.nspname = 'public'
                """,
                tbl,
            )
            # Get actual count for small tables (< 10k estimate)
            if row_count is not None and row_count < 10000:
                try:
                    row_count = await conn.fetchval(f"SELECT COUNT(*) FROM {tbl}")
                except Exception:
                    pass  # table may not exist yet

            table_stats.append({
                "table_name": tbl,
                "row_count": row_count or 0,
            })
        except Exception as exc:
            logger.debug("Could not get stats for table %s: %s", tbl, exc)
            table_stats.append({"table_name": tbl, "row_count": None})

    # Last sync per type from etl_sync_log
    last_syncs = await conn.fetch(
        """
        SELECT DISTINCT ON (sync_type)
            sync_type, completed_at, rows_inserted, status
        FROM etl_sync_log
        WHERE status = 'completed'
        ORDER BY sync_type, completed_at DESC
        """
    )

    return {
        "data": {
            "table_stats": sorted(table_stats, key=lambda x: x["row_count"] or 0, reverse=True),
            "last_imports": [
                {
                    "sync_type": r["sync_type"],
                    "completed_at": r["completed_at"].isoformat() if r["completed_at"] else None,
                    "rows_inserted": r["rows_inserted"],
                }
                for r in last_syncs
            ],
        },
        "message": "Thống kê import dữ liệu",
    }


# ---------------------------------------------------------------------------
# GET /data-quality — List data quality check results
# ---------------------------------------------------------------------------

@router.get("/data-quality")
async def list_data_quality(
    status: Optional[str] = Query(None, description="pass | warning | fail"),
    table_name: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(100, ge=1, le=500),
    token_data: TokenData = Depends(require_role("admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """List data quality check results with optional filters."""
    conditions = ["1=1"]
    params: list = []
    idx = 1

    if status:
        conditions.append(f"status = ${idx}")
        params.append(status)
        idx += 1

    if table_name:
        conditions.append(f"table_name = ${idx}")
        params.append(table_name)
        idx += 1

    where = " AND ".join(conditions)

    total = await conn.fetchval(
        f"SELECT COUNT(*) FROM data_quality_checks WHERE {where}", *params
    )

    offset = (page - 1) * limit
    rows = await conn.fetch(
        f"""
        SELECT id, table_name, check_name, check_type, status,
               affected_rows, details, created_at
        FROM data_quality_checks
        WHERE {where}
        ORDER BY created_at DESC, status DESC
        LIMIT ${idx} OFFSET ${idx + 1}
        """,
        *params,
        limit,
        offset,
    )

    return {
        "data": {
            "items": [
                {
                    "id": r["id"],
                    "table_name": r["table_name"],
                    "check_name": r["check_name"],
                    "check_type": r["check_type"],
                    "status": r["status"],
                    "affected_rows": r["affected_rows"],
                    "details": r["details"],
                    "created_at": r["created_at"].isoformat(),
                }
                for r in rows
            ],
            "total": total,
            "page": page,
            "limit": limit,
        },
        "message": f"Kết quả kiểm tra chất lượng dữ liệu ({total} bản ghi)",
    }


# ---------------------------------------------------------------------------
# POST /data-quality/run — Run data quality checks
# ---------------------------------------------------------------------------

@router.post("/data-quality/run")
async def run_data_quality(
    token_data: TokenData = Depends(require_role("admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """
    Run a suite of data quality checks and persist results:
    1. Users without email (warning)
    2. bqms_rfq without rfq_number (fail)
    3. purchase_orders with negative amounts (fail)
    4. inventory with negative quantity (warning)
    5. Orphan po_line_items (po_id not in purchase_orders) (warning)
    Returns a summary of all checks run.
    """
    checks_run = []

    async def save_check(
        table: str,
        name: str,
        check_type: str,
        status: str,
        affected: int,
        details: dict,
    ) -> None:
        await conn.execute(
            """
            INSERT INTO data_quality_checks
                (table_name, check_name, check_type, status, affected_rows, details)
            VALUES ($1, $2, $3, $4, $5, $6)
            """,
            table,
            name,
            check_type,
            status,
            affected,
            details,
        )
        checks_run.append({
            "table_name": table,
            "check_name": name,
            "check_type": check_type,
            "status": status,
            "affected_rows": affected,
            "details": details,
        })

    # --- Check 1: Users without email ---
    try:
        count = await conn.fetchval(
            "SELECT COUNT(*) FROM users WHERE email IS NULL OR TRIM(email) = ''"
        )
        affected = int(count or 0)
        status = "warning" if affected > 0 else "pass"
        await save_check(
            "users", "users_no_email", "null_check", status, affected,
            {"description": "Users có email trống hoặc NULL", "count": affected},
        )
    except Exception as exc:
        logger.warning("Check users_no_email failed: %s", exc)

    # --- Check 2: bqms_rfq without rfq_number ---
    try:
        count = await conn.fetchval(
            """
            SELECT COUNT(*) FROM bqms_rfq
            WHERE rfq_number IS NULL OR TRIM(rfq_number) = ''
            """
        )
        affected = int(count or 0)
        status = "fail" if affected > 0 else "pass"
        await save_check(
            "bqms_rfq", "bqms_rfq_no_rfq_number", "null_check", status, affected,
            {"description": "BQMS RFQ không có số RFQ", "count": affected},
        )
    except Exception as exc:
        logger.warning("Check bqms_rfq_no_rfq_number failed: %s", exc)

    # --- Check 3: purchase_orders with negative amounts ---
    try:
        count = await conn.fetchval(
            "SELECT COUNT(*) FROM purchase_orders WHERE total_amount < 0"
        )
        affected = int(count or 0)
        status = "fail" if affected > 0 else "pass"
        await save_check(
            "purchase_orders", "po_negative_amount", "range_check", status, affected,
            {"description": "Đơn mua có giá trị âm", "count": affected},
        )
    except Exception as exc:
        logger.warning("Check po_negative_amount failed: %s", exc)

    # --- Check 4: inventory with negative quantity ---
    try:
        count = await conn.fetchval(
            "SELECT COUNT(*) FROM inventory WHERE quantity < 0"
        )
        affected = int(count or 0)
        status = "warning" if affected > 0 else "pass"
        await save_check(
            "inventory", "inventory_negative_qty", "range_check", status, affected,
            {"description": "Sản phẩm có số lượng âm trong kho", "count": affected},
        )
    except Exception as exc:
        logger.warning("Check inventory_negative_qty failed: %s", exc)

    # --- Check 5: Orphan po_line_items ---
    try:
        count = await conn.fetchval(
            """
            SELECT COUNT(*) FROM po_line_items
            WHERE po_id NOT IN (SELECT id FROM purchase_orders)
            """
        )
        affected = int(count or 0)
        status = "warning" if affected > 0 else "pass"
        await save_check(
            "po_line_items", "orphan_po_line_items", "orphan_check", status, affected,
            {
                "description": "Chi tiết PO không có PO cha (foreign key orphan)",
                "count": affected,
            },
        )
    except Exception as exc:
        logger.warning("Check orphan_po_line_items failed: %s", exc)

    # Compute summary
    fail_count = sum(1 for c in checks_run if c["status"] == "fail")
    warning_count = sum(1 for c in checks_run if c["status"] == "warning")
    pass_count = sum(1 for c in checks_run if c["status"] == "pass")

    overall = "fail" if fail_count > 0 else "warning" if warning_count > 0 else "pass"

    return {
        "data": {
            "overall_status": overall,
            "summary": {
                "total": len(checks_run),
                "pass": pass_count,
                "warning": warning_count,
                "fail": fail_count,
            },
            "checks": checks_run,
        },
        "message": f"Hoàn thành {len(checks_run)} kiểm tra chất lượng dữ liệu. "
                   f"Kết quả: {pass_count} pass, {warning_count} warning, {fail_count} fail.",
    }
