"""
ETL Status API — Giám sát và điều khiển đồng bộ dữ liệu.

Endpoints:
    GET  /etl/sync-status   — Trạng thái sync mới nhất
    POST /etl/sync-now      — Trigger manual sync (admin/manager only)
    GET  /etl/sync-history   — Lịch sử sync (phân trang)
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
import asyncpg

from app.core.database import get_db
from app.core.rbac import require_role
from app.core.security import TokenData

router = APIRouter()


# ---------------------------------------------------------------------------
# GET /etl/sync-status — Trạng thái sync mới nhất
# ---------------------------------------------------------------------------

@router.get("/sync-status")
async def get_sync_status(
    token_data: TokenData = Depends(require_role("admin", "manager")),
    conn: asyncpg.Connection = Depends(get_db),
) -> dict[str, Any]:
    """Lấy thông tin sync gần nhất từ etl_sync_log."""

    last_sync = await conn.fetchrow(
        """
        SELECT id, sync_type, started_at, completed_at, status,
               files_processed, rows_inserted, rows_updated, rows_skipped,
               error_message, delta_token
        FROM etl_sync_log
        ORDER BY id DESC LIMIT 1
        """
    )

    if not last_sync:
        return {
            "has_synced": False,
            "message": "Chưa có lần đồng bộ nào.",
        }

    # Tính thời gian từ lần sync cuối
    duration = None
    if last_sync["completed_at"] and last_sync["started_at"]:
        delta = last_sync["completed_at"] - last_sync["started_at"]
        duration = round(delta.total_seconds(), 1)

    # Đếm tổng records đã import
    total_counts = {}
    tables = [
        "bqms_rfq", "bqms_deliveries", "bqms_orders", "bqms_samsung_po",
        "bqms_raw_material_po", "bqms_material_pricing",
        "import_export_tracking", "imv_inquiries", "imv_consolidated",
        "imv_purchase_orders", "customer_contacts", "revenue_invoices",
        "products", "exchange_rates", "bqms_won_quotations",
    ]
    for table in tables:
        try:
            count = await conn.fetchval(f"SELECT COUNT(*) FROM {table}")
            total_counts[table] = count
        except Exception:
            total_counts[table] = -1

    return {
        "has_synced": True,
        "last_sync": {
            "id": last_sync["id"],
            "sync_type": last_sync["sync_type"],
            "status": last_sync["status"],
            "started_at": last_sync["started_at"].isoformat() if last_sync["started_at"] else None,
            "completed_at": last_sync["completed_at"].isoformat() if last_sync["completed_at"] else None,
            "duration_seconds": duration,
            "files_processed": last_sync["files_processed"],
            "rows_inserted": last_sync["rows_inserted"],
            "rows_updated": last_sync["rows_updated"],
            "rows_skipped": last_sync["rows_skipped"],
            "has_delta_token": bool(last_sync["delta_token"]),
            "error_message": last_sync["error_message"],
        },
        "table_counts": total_counts,
        "total_records": sum(v for v in total_counts.values() if v > 0),
    }


# ---------------------------------------------------------------------------
# POST /etl/sync-now — Trigger manual sync
# ---------------------------------------------------------------------------

@router.post("/sync-now")
async def trigger_sync_now(
    token_data: TokenData = Depends(require_role("admin", "manager")),
    conn: asyncpg.Connection = Depends(get_db),
) -> dict[str, Any]:
    """
    Trigger đồng bộ OneDrive ngay lập tức.
    Tạo Procrastinate job cho onedrive_delta_sync.
    Chỉ admin/manager mới được trigger.
    """

    # Kiểm tra nếu đang có sync running
    running = await conn.fetchval(
        """
        SELECT COUNT(*) FROM etl_sync_log
        WHERE status = 'running'
          AND started_at > NOW() - INTERVAL '1 hour'
        """
    )
    if running and running > 0:
        raise HTTPException(
            status_code=409,
            detail={
                "error": "SYNC_IN_PROGRESS",
                "message": "Đang có một tiến trình đồng bộ chạy. Vui lòng đợi hoàn thành.",
            },
        )

    # Tạo sync log entry
    sync_id = await conn.fetchval(
        """
        INSERT INTO etl_sync_log (
            sync_type, started_at, status
        ) VALUES (
            'manual_trigger', NOW(), 'running'
        )
        RETURNING id
        """
    )

    # Defer Procrastinate job
    try:
        await conn.execute(
            """
            INSERT INTO procrastinate_jobs (
                queue_name, task_name, args, status, scheduled_at
            ) VALUES (
                'etl', 'onedrive_delta_sync', '{}', 'todo', NOW()
            )
            """
        )
        job_queued = True
    except Exception as e:
        # Procrastinate tables có thể chưa tồn tại
        job_queued = False

    return {
        "message": "Đã trigger đồng bộ OneDrive.",
        "sync_log_id": sync_id,
        "job_queued": job_queued,
        "triggered_by": token_data.email,
        "triggered_at": datetime.now(timezone.utc).isoformat(),
    }


# ---------------------------------------------------------------------------
# GET /etl/sync-history — Lịch sử sync
# ---------------------------------------------------------------------------

@router.get("/sync-history")
async def get_sync_history(
    token_data: TokenData = Depends(require_role("admin", "manager", "staff")),
    conn: asyncpg.Connection = Depends(get_db),
    page: int = Query(1, ge=1, description="Trang hiện tại"),
    page_size: int = Query(20, ge=1, le=100, description="Số bản ghi mỗi trang"),
    sync_type: str | None = Query(None, description="Lọc loại sync"),
    status: str | None = Query(None, description="Lọc trạng thái"),
) -> dict[str, Any]:
    """Lịch sử đồng bộ dữ liệu, phân trang."""

    # Đếm tổng
    count_sql = "SELECT COUNT(*) FROM etl_sync_log WHERE 1=1"
    count_params: list[Any] = []
    param_idx = 1

    if sync_type:
        count_sql += f" AND sync_type = ${param_idx}"
        count_params.append(sync_type)
        param_idx += 1

    if status:
        count_sql += f" AND status = ${param_idx}"
        count_params.append(status)
        param_idx += 1

    total = await conn.fetchval(count_sql, *count_params)

    # Lấy data
    data_sql = """
        SELECT id, sync_type, started_at, completed_at, status,
               files_processed, rows_inserted, rows_updated, rows_skipped,
               error_message,
               CASE WHEN delta_token IS NOT NULL THEN true ELSE false END as has_delta_token
        FROM etl_sync_log
        WHERE 1=1
    """
    data_params: list[Any] = []
    param_idx = 1

    if sync_type:
        data_sql += f" AND sync_type = ${param_idx}"
        data_params.append(sync_type)
        param_idx += 1

    if status:
        data_sql += f" AND status = ${param_idx}"
        data_params.append(status)
        param_idx += 1

    offset = (page - 1) * page_size
    data_sql += f" ORDER BY id DESC LIMIT ${param_idx} OFFSET ${param_idx + 1}"
    data_params.extend([page_size, offset])

    rows = await conn.fetch(data_sql, *data_params)

    items = []
    for row in rows:
        duration = None
        if row["completed_at"] and row["started_at"]:
            delta = row["completed_at"] - row["started_at"]
            duration = round(delta.total_seconds(), 1)

        items.append({
            "id": row["id"],
            "sync_type": row["sync_type"],
            "status": row["status"],
            "started_at": row["started_at"].isoformat() if row["started_at"] else None,
            "completed_at": row["completed_at"].isoformat() if row["completed_at"] else None,
            "duration_seconds": duration,
            "files_processed": row["files_processed"],
            "rows_inserted": row["rows_inserted"],
            "rows_updated": row["rows_updated"],
            "rows_skipped": row["rows_skipped"],
            "has_delta_token": row["has_delta_token"],
            "error_message": row["error_message"],
        })

    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": (total + page_size - 1) // page_size if total else 0,
    }
