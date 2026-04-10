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

import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
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


# ---------------------------------------------------------------------------
# GET /file-tree — Scan OneDrive staging folder and return tree with sync status
# ---------------------------------------------------------------------------

STAGING_DIR = Path("/data/onedrive-staging")
EXCEL_EXTS = {".xlsx", ".xls", ".xlsm"}
ALL_FILE_EXTS = {".xlsx", ".xls", ".xlsm", ".pdf", ".docx", ".doc", ".jpg", ".jpeg", ".png", ".pptx", ".ppt", ".csv"}

# ── File → Table mapping (from import_precise.py) ────────────
FILE_TABLE_MAP: dict[str, str] = {
    # ── BQMS Samsung (core business) ──
    "thong ke hoi hang bqms": "bqms_rfq",
    "thong ke dat hang": "bqms_orders",
    "thong ke giao hang": "bqms_deliveries",
    "tt xnk bqms 2026": "xnk_price_lookup",
    "tt xnk bqms": "import_export_tracking",
    "tt xnk 2023": "import_export_tracking",
    "gia cong": "bqms_orders",
    "ket qua phoi": "bqms_material_pricing",
    "theo doi po phoi": "bqms_raw_material_po",
    "tong hop po": "bqms_raw_material_po",
    "bc bqms thang": "bqms_rfq",  # BC BQMS THANG = báo cáo tháng (cùng format RFQ)
    "dept. cnc": "bqms_orders",
    "thong ke cac code trung": "bqms_rfq",
    "gia phoi samsung": "bqms_material_pricing",
    # ── AMA / Quotation ──
    "ama trading": "bqms_material_pricing",
    "ama vina": "bqms_material_pricing",
    "qtamabn": "quotations",
    # ── IMV ──
    "thong ke hoi hang - update": "imv_inquiries",
    "po imv": "imv_purchase_orders",
    "sc_imv_tong hop": "imv_consolidated",
    "imv-ycbg": "imv_inquiries",
    "imv - lua chon": "imv_consolidated",
    "imv - po": "imv_purchase_orders",
    "bqms - po": "imv_purchase_orders",
    "bqms -ycbg": "imv_inquiries",
    "bqms - lua chon": "imv_consolidated",
    # ── Tài chính ──
    "bang theo doi doanh thu": "revenue_invoices",
    "doanh thu sc": "revenue_invoices",
    "so quy": "cash_book",
    "dxtt songchau": "cash_book",  # Đề xuất thanh toán
    "bang ke cong no": "accounts_payable",
    "bang ke po": "purchase_orders",
    "hddt": "invoices",  # Hóa đơn điện tử
    "bbgh": "bqms_deliveries",  # Biên bản giao hàng
    "chi_tiet_cong_no": "accounts_receivable",
    "bang ke hoa don": "invoices",
    # ── EAE ──
    "eae": "purchase_orders",  # EAE supplier data
    # ── LG ──
    "lg thang": "purchase_orders",
    # ── Khách lẻ ──
    "khach le": "purchase_orders",
    "po apt": "purchase_orders",
    # ── Customs/XNK ──
    "tokhaihq": "customs_declarations",
    "bieu thue xnk": "customs_declarations",
    # ── Samsung ──
    "samsung - categories": "products",
    # ── Tổng hợp ──
    "item_song chau": "products",
    "tong hop hang smt": "products",
    "tinh gia": "bqms_material_pricing",
    "list mua hang": "purchase_orders",
    "spare part": "products",
    # ── Biên nhận / Giao hàng ──
    "bien nhan": "bqms_deliveries",
    "biên nhận": "bqms_deliveries",
}

# Files that are templates/forms — explicitly NOT for import
TEMPLATE_FILES = {
    "mau don dat hang", "mẫu đơn đặt hàng", "bg mau", "book1",
    "checklist", "mau khai bao", "mẫu khai báo", "mau bien nhan", "mẫu biên nhận",
    "powerbi", "power bii", "pham vi trach nhiem",
}


def _match_file_to_table(filename: str) -> str | None:
    """Match a filename to its target DB table."""
    fname_lower = filename.lower()
    # Check if it's a template (not for import)
    for tpl in TEMPLATE_FILES:
        if tpl in fname_lower:
            return None
    # Check file→table mapping
    for pattern, table in FILE_TABLE_MAP.items():
        if pattern in fname_lower:
            return table
    return None


@router.get("/file-tree")
async def file_tree(
    token_data: TokenData = Depends(require_role("admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Scan /data/onedrive-staging/ and return folder tree with REAL sync status."""
    if not STAGING_DIR.exists():
        return {"data": {"summary": {"total_files": 0, "total_size_bytes": 0,
                "imported": 0, "needs_update": 0, "has_mapping": 0, "no_mapping": 0, "empty": 0},
                "tree": []}}

    # 1. Scan filesystem
    files = []
    for root, dirs, fnames in os.walk(STAGING_DIR):
        for fname in fnames:
            fpath = Path(root) / fname
            if fpath.suffix.lower() in ALL_FILE_EXTS and not fname.startswith("~$"):
                try:
                    stat = fpath.stat()
                    rel = str(fpath.relative_to(STAGING_DIR)).replace("\\", "/")
                    files.append({
                        "name": fname, "path": rel,
                        "extension": fpath.suffix.lstrip(".").lower(),
                        "size_bytes": stat.st_size,
                        "last_modified": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
                        "mtime": stat.st_mtime,
                    })
                except Exception:
                    pass

    # 2. Get import history per file from file_review_status
    review_rows = await conn.fetch("SELECT file_path, status, reviewed_at, last_import_result FROM file_review_status")
    review_map = {r["file_path"]: r for r in review_rows}

    # 3. Get last successful import timestamp per sync_type
    last_imports = await conn.fetch(
        "SELECT DISTINCT ON (source_file) source_file, completed_at, rows_inserted, status "
        "FROM etl_sync_log WHERE source_file IS NOT NULL AND source_file != '' "
        "ORDER BY source_file, completed_at DESC"
    )
    import_by_file = {r["source_file"]: r for r in last_imports}

    # 4. Get row counts for known target tables
    table_counts: dict[str, int] = {}
    for table in set(FILE_TABLE_MAP.values()):
        try:
            count = await conn.fetchval(f"SELECT COUNT(*) FROM {table}")
            table_counts[table] = count or 0
        except Exception:
            table_counts[table] = 0

    # 5. Build tree with REAL status
    tree_dict: dict = {}
    summary = {"total_files": 0, "total_size_bytes": 0,
               "imported": 0, "needs_update": 0, "has_mapping": 0, "no_mapping": 0, "empty": 0}

    for f in files:
        target_table = _match_file_to_table(f["name"])
        db_row_count = table_counts.get(target_table, 0) if target_table else 0

        # Check review status first
        review = review_map.get(f["path"])
        file_import = import_by_file.get(f["path"])

        # Determine REAL sync status
        if f["size_bytes"] < 1000:
            status = "empty"
        elif target_table is None:
            status = "no_mapping"
        elif review and review["status"] == "imported":
            # Check if file changed after last import
            if review["reviewed_at"] and f["mtime"] > review["reviewed_at"].timestamp():
                status = "needs_update"
            else:
                status = "imported"
        elif file_import and file_import["status"] in ("success", "partial") and file_import["rows_inserted"] and file_import["rows_inserted"] > 0:
            if file_import["completed_at"] and f["mtime"] > file_import["completed_at"].timestamp():
                status = "needs_update"
            else:
                status = "imported"
        elif db_row_count > 0:
            # Table has data — likely imported before (even if no per-file log)
            status = "imported"
        else:
            status = "has_mapping"

        last_imported_at = None
        if review and review["reviewed_at"]:
            last_imported_at = review["reviewed_at"].isoformat()
        elif file_import and file_import["completed_at"]:
            last_imported_at = file_import["completed_at"].isoformat()

        summary["total_files"] += 1
        summary["total_size_bytes"] += f["size_bytes"]
        summary[status] = summary.get(status, 0) + 1

        parts = f["path"].split("/")
        current = tree_dict
        for p in parts[:-1]:
            if p not in current:
                current[p] = {"_children": {}, "_path": "/".join(parts[:parts.index(p) + 1])}
            current = current[p]["_children"]
        current[parts[-1]] = {
            "name": f["name"], "path": f["path"], "type": "file",
            "extension": f["extension"], "size_bytes": f["size_bytes"],
            "last_modified": f["last_modified"], "sync_status": status,
            "target_table": target_table,
            "db_row_count": db_row_count,
            "last_imported_at": last_imported_at,
        }

    def to_list(d, parent=""):
        result = []
        for key, val in sorted(d.items()):
            if key.startswith("_"):
                continue
            if val.get("type") == "file":
                result.append(val)
            else:
                path = val.get("_path", f"{parent}/{key}" if parent else key)
                children = to_list(val.get("_children", {}), path)
                file_count = sum(1 for c in children if c.get("type") == "file") + sum(
                    c.get("file_count", 0) for c in children if c.get("type") == "folder"
                )
                result.append({"name": key, "path": path, "type": "folder",
                               "children": children, "file_count": file_count})
        result.sort(key=lambda x: (0 if x.get("type") == "folder" else 1, x["name"].lower()))
        return result

    return {"data": {"summary": summary, "tree": to_list(tree_dict)},
            "message": f"{summary['total_files']} files — {summary['imported']} imported, "
                       f"{summary['needs_update']} cần cập nhật, {summary['has_mapping']} chưa import, "
                       f"{summary['no_mapping']} không nhận dạng"}


# ---------------------------------------------------------------------------
# GET /file-preview — Read Excel header + first N rows from staging
# ---------------------------------------------------------------------------

@router.get("/file-preview")
async def file_preview(
    path: str = Query(..., description="Relative path in staging dir"),
    sheet: str | None = Query(None, description="Sheet name (Excel only)"),
    rows: int = Query(30, ge=1, le=200),
    token_data: TokenData = Depends(require_role("admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Multi-format preview: Excel→table, PDF→url, Image→url, Word→text."""
    full_path = STAGING_DIR / path
    if not full_path.exists() or not full_path.is_file():
        raise HTTPException(404, f"File không tồn tại: {path}")

    stat = full_path.stat()
    ext = full_path.suffix.lower()
    target_table = _match_file_to_table(full_path.name)

    current_count = 0
    if target_table:
        try:
            current_count = await conn.fetchval(f"SELECT COUNT(*) FROM {target_table}")
        except Exception:
            pass

    base_data = {
        "file_path": path,
        "file_name": full_path.name,
        "size_bytes": stat.st_size,
        "extension": ext.lstrip("."),
        "target_table": target_table,
        "target_table_count": current_count,
        "recognized": target_table is not None,
    }

    # ── Excel ──────────────────────────────────────────────
    if ext in EXCEL_EXTS:
        from python_calamine import CalamineWorkbook

        wb = CalamineWorkbook.from_path(str(full_path))
        sheets_list = wb.sheet_names
        active = sheet if sheet and sheet in sheets_list else sheets_list[0]
        all_rows = wb.get_sheet_by_name(active).to_python()

        header_idx = 0
        for i, row in enumerate(all_rows[:10]):
            non_empty = sum(1 for c in row if c is not None and str(c).strip())
            if non_empty >= 3:
                header_idx = i
                break

        headers = [str(c) if c else f"Col{j}" for j, c in enumerate(all_rows[header_idx])] if header_idx < len(all_rows) else []
        data_rows = [[str(c) if c is not None else "" for c in row] for row in all_rows[header_idx + 1: header_idx + 1 + rows]]

        return {"data": {**base_data, "preview_type": "excel",
                "sheets": sheets_list, "active_sheet": active,
                "total_rows": len(all_rows), "headers": headers, "rows": data_rows}}

    # ── PDF ────────────────────────────────────────────────
    if ext == ".pdf":
        return {"data": {**base_data, "preview_type": "pdf",
                "download_url": f"/api/v1/data-migration/file-download/{path}"}}

    # ── Image ──────────────────────────────────────────────
    if ext in (".jpg", ".jpeg", ".png"):
        return {"data": {**base_data, "preview_type": "image",
                "download_url": f"/api/v1/data-migration/file-download/{path}"}}

    # ── Word (.docx) ───────────────────────────────────────
    if ext == ".docx":
        text_content = ""
        try:
            import zipfile
            with zipfile.ZipFile(str(full_path)) as z:
                with z.open("word/document.xml") as doc:
                    import re
                    xml = doc.read().decode("utf-8", errors="replace")
                    # Simple extraction: get text between <w:t> tags
                    text_parts = re.findall(r"<w:t[^>]*>([^<]+)</w:t>", xml)
                    text_content = " ".join(text_parts)[:5000]
        except Exception as exc:
            text_content = f"Không thể đọc file Word: {exc}"

        return {"data": {**base_data, "preview_type": "word", "text_content": text_content}}

    # ── CSV ────────────────────────────────────────────────
    if ext == ".csv":
        try:
            with open(full_path, "r", encoding="utf-8", errors="replace") as f:
                lines = [line.strip() for line in f.readlines()[:rows + 1]]
            headers = lines[0].split(",") if lines else []
            data_rows = [line.split(",") for line in lines[1:]]
            return {"data": {**base_data, "preview_type": "csv",
                    "headers": headers, "rows": data_rows, "total_rows": len(lines) - 1}}
        except Exception:
            pass

    # ── Other (no preview, just metadata) ──────────────────
    return {"data": {**base_data, "preview_type": "unsupported",
            "download_url": f"/api/v1/data-migration/file-download/{path}"}}


# ---------------------------------------------------------------------------
# GET /file-download/{path} — Serve any file from staging for preview
# ---------------------------------------------------------------------------

@router.get("/file-download/{file_path:path}")
async def file_download(
    file_path: str,
    token_data: TokenData = Depends(require_role("admin")),
):
    """Serve a file from staging directory for inline preview (PDF, images)."""
    from fastapi.responses import FileResponse

    full_path = STAGING_DIR / file_path
    if not full_path.exists() or not full_path.is_file():
        raise HTTPException(404, f"File không tồn tại: {file_path}")

    # Security: ensure path is within staging dir
    try:
        full_path.resolve().relative_to(STAGING_DIR.resolve())
    except ValueError:
        raise HTTPException(403, "Truy cập không hợp lệ")

    ext = full_path.suffix.lower()
    media_types = {
        ".pdf": "application/pdf",
        ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ".csv": "text/csv",
    }
    media_type = media_types.get(ext, "application/octet-stream")

    return FileResponse(str(full_path), media_type=media_type, filename=full_path.name)


# ---------------------------------------------------------------------------
# POST /file-import — NON-BLOCKING: return immediately, run import in background
# ---------------------------------------------------------------------------

@router.post("/file-import", status_code=202)
async def file_import(
    body: dict,
    token_data: TokenData = Depends(require_role("admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Start importing a file in background. Returns log_id for polling."""
    file_path = body.get("path", "")
    full_path = STAGING_DIR / file_path
    if not full_path.exists():
        raise HTTPException(404, f"File không tồn tại: {file_path}")

    target_table = _match_file_to_table(full_path.name)
    if not target_table:
        raise HTTPException(400, f"File '{full_path.name}' không có mapping import. Chỉ xem trước được.")

    import threading

    log_id = await conn.fetchval(
        "INSERT INTO etl_sync_log (sync_type, status, started_at, source_file) VALUES ('file_import', 'running', NOW(), $1) RETURNING id",
        file_path,
    )

    def _run_import():
        """Background thread: run import_precise.py with --table filter."""
        import subprocess
        import psycopg2
        try:
            proc = subprocess.run(
                ["python", "scripts/import_precise.py", "--source", str(STAGING_DIR), "--table", target_table],
                capture_output=True, text=True, timeout=300, cwd="/app"
            )
            # Parse results from output
            inserted, skipped, errs = 0, 0, 0
            for line in (proc.stdout or "").split("\n"):
                ll = line.lower()
                if "total" in ll and "insert" in ll:
                    parts = line.split()
                    for i, p in enumerate(parts):
                        if "insert" in p.lower() and i > 0:
                            try: inserted = int(parts[i - 1])
                            except: pass

            status = "success" if proc.returncode == 0 else "partial"
            error_msg = (proc.stderr or "")[-500:] if proc.returncode != 0 else ""

            # Update DB
            c = psycopg2.connect(
                f"postgresql://{settings.POSTGRES_USER}:{settings.POSTGRES_PASSWORD}@postgres:5432/{settings.POSTGRES_DB}"
            )
            with c, c.cursor() as cur:
                cur.execute(
                    "UPDATE etl_sync_log SET status=%s, completed_at=NOW(), rows_inserted=%s, rows_skipped=%s, error_message=%s WHERE id=%s",
                    (status, inserted, skipped, error_msg, log_id),
                )
                cur.execute(
                    """INSERT INTO file_review_status (file_path, status, reviewed_at, last_import_result)
                       VALUES (%s, %s, NOW(), %s::jsonb)
                       ON CONFLICT (file_path) DO UPDATE SET status=EXCLUDED.status, reviewed_at=NOW(),
                       last_import_result=EXCLUDED.last_import_result, updated_at=NOW()""",
                    (file_path, "imported" if status == "success" else "error",
                     json.dumps({"inserted": inserted, "skipped": skipped, "errors": errs, "log_id": log_id})),
                )
            c.close()
        except Exception as exc:
            try:
                c2 = psycopg2.connect(
                    f"postgresql://{settings.POSTGRES_USER}:{settings.POSTGRES_PASSWORD}@postgres:5432/{settings.POSTGRES_DB}"
                )
                with c2, c2.cursor() as cur:
                    cur.execute(
                        "UPDATE etl_sync_log SET status='error', completed_at=NOW(), error_message=%s WHERE id=%s",
                        (str(exc)[:500], log_id),
                    )
                c2.close()
            except Exception:
                pass

    thread = threading.Thread(target=_run_import, daemon=True)
    thread.start()

    return {"data": {"log_id": log_id, "status": "running", "target_table": target_table},
            "message": f"Import đang chạy cho {full_path.name} → {target_table}"}


# ---------------------------------------------------------------------------
# GET /file-import/{log_id} — Poll import status
# ---------------------------------------------------------------------------

@router.get("/file-import/{log_id}")
async def file_import_status(
    log_id: int,
    token_data: TokenData = Depends(require_role("admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Poll the status of a running file import."""
    row = await conn.fetchrow(
        "SELECT id, sync_type, status, started_at, completed_at, rows_inserted, rows_skipped, error_message, source_file "
        "FROM etl_sync_log WHERE id = $1", log_id,
    )
    if not row:
        raise HTTPException(404, "Import log không tồn tại")

    return {"data": {
        "log_id": row["id"],
        "status": row["status"],
        "file_path": row["source_file"],
        "rows_inserted": row["rows_inserted"] or 0,
        "rows_skipped": row["rows_skipped"] or 0,
        "error_message": row["error_message"],
        "started_at": row["started_at"].isoformat() if row["started_at"] else None,
        "completed_at": row["completed_at"].isoformat() if row["completed_at"] else None,
    }}


# ---------------------------------------------------------------------------
# POST /file-skip — Mark a staging file as intentionally skipped
# ---------------------------------------------------------------------------

@router.post("/file-skip")
async def file_skip(
    body: dict,  # {"path": "...", "reason": "Du lieu cu"}
    token_data: TokenData = Depends(require_role("admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    await conn.execute(
        """INSERT INTO file_review_status (file_path, status, reviewed_by, reviewed_at, reason)
           VALUES ($1, 'skipped', $2::uuid, NOW(), $3)
           ON CONFLICT (file_path) DO UPDATE SET status='skipped', reviewed_by=EXCLUDED.reviewed_by, reviewed_at=NOW(), reason=EXCLUDED.reason, updated_at=NOW()""",
        body.get("path", ""), token_data.user_id, body.get("reason", ""),
    )
    return {"message": "Đã bỏ qua file"}
