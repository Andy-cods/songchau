"""
System Health API (M16 + M19 + M22) — Performance Dashboard, Error Center,
and Backup Verification for Song Châu ERP.

Endpoints:
  GET  /dashboard          — System overview (DB, Redis, uptime, containers)
  GET  /db-stats           — Per-table row counts sorted by size
  GET  /api-performance    — pg_stat_user_tables access patterns
  GET  /errors             — List error_log with filters + pagination
  POST /errors/{id}/resolve — Mark error as resolved
  GET  /errors/summary     — Error counts by type and severity
  GET  /health-history     — Historical health check results
  POST /health-check       — Run live health check and save results
  GET  /backups            — List backup_log
  POST /backups/verify/{id} — Mark backup as verified
"""

from __future__ import annotations

import logging
import time
from typing import Optional

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.cache import cache
from app.core.database import get_db
from app.core.rbac import require_role
from app.core.security import TokenData

logger = logging.getLogger(__name__)

router = APIRouter()


# ---------------------------------------------------------------------------
# GET /dashboard — System overview
# ---------------------------------------------------------------------------

@router.get("/dashboard")
async def system_dashboard(
    token_data: TokenData = Depends(require_role("admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """
    Returns a full system overview:
    - Database size, table count, total row count
    - Redis memory usage
    - Last ETL sync time per sync type
    - Latest health check results per component
    """
    # DB size
    db_size_bytes = await conn.fetchval(
        "SELECT pg_database_size(current_database())"
    )
    db_size_human = await conn.fetchval(
        "SELECT pg_size_pretty(pg_database_size(current_database()))"
    )

    # Table count (user tables only)
    table_count = await conn.fetchval(
        "SELECT COUNT(*) FROM pg_tables WHERE schemaname = 'public'"
    )

    # Approximate total row count across all tables
    total_rows = await conn.fetchval(
        """
        SELECT COALESCE(SUM(reltuples::BIGINT), 0)
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind = 'r'
          AND reltuples > 0
        """
    )

    # Redis info
    redis_info = await cache.info()
    redis_alive = await cache.ping()

    # Last ETL sync per type
    last_syncs = await conn.fetch(
        """
        SELECT DISTINCT ON (sync_type)
            sync_type, status, completed_at, rows_inserted, error_message
        FROM etl_sync_log
        ORDER BY sync_type, started_at DESC
        """
    )

    # Latest health check per component
    latest_checks = await conn.fetch(
        """
        SELECT DISTINCT ON (check_type)
            check_type, status, response_time_ms, created_at
        FROM system_health_checks
        ORDER BY check_type, created_at DESC
        """
    )

    # Unresolved error counts
    unresolved_critical = await conn.fetchval(
        "SELECT COUNT(*) FROM error_log WHERE resolved = false AND severity = 'critical'"
    )
    unresolved_total = await conn.fetchval(
        "SELECT COUNT(*) FROM error_log WHERE resolved = false"
    )

    # Pending retry queue
    pending_retries = await conn.fetchval(
        "SELECT COUNT(*) FROM retry_queue WHERE status IN ('pending', 'retrying')"
    )

    return {
        "data": {
            "database": {
                "size_bytes": db_size_bytes,
                "size_human": db_size_human,
                "table_count": table_count,
                "total_rows_estimate": total_rows,
            },
            "redis": {
                "connected": redis_alive,
                "used_memory_human": redis_info.get("used_memory_human", "N/A"),
                "used_memory_bytes": redis_info.get("used_memory", 0),
                "connected_clients": redis_info.get("connected_clients", "N/A"),
            },
            "etl_sync": [
                {
                    "sync_type": r["sync_type"],
                    "status": r["status"],
                    "completed_at": r["completed_at"].isoformat() if r["completed_at"] else None,
                    "rows_inserted": r["rows_inserted"],
                    "error_message": r["error_message"],
                }
                for r in last_syncs
            ],
            "health_checks": [
                {
                    "check_type": r["check_type"],
                    "status": r["status"],
                    "response_time_ms": r["response_time_ms"],
                    "last_checked": r["created_at"].isoformat(),
                }
                for r in latest_checks
            ],
            "alerts": {
                "unresolved_errors": unresolved_total,
                "critical_errors": unresolved_critical,
                "pending_retries": pending_retries,
            },
        },
        "message": "Tổng quan hệ thống",
    }


# ---------------------------------------------------------------------------
# GET /db-stats — Per-table row counts
# ---------------------------------------------------------------------------

@router.get("/db-stats")
async def db_stats(
    token_data: TokenData = Depends(require_role("admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """
    Returns per-table statistics: row count estimate, table size,
    index size, last vacuum/analyze times. Sorted by table size descending.
    """
    rows = await conn.fetch(
        """
        SELECT
            t.tablename AS table_name,
            c.reltuples::BIGINT AS row_estimate,
            pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size,
            pg_size_pretty(pg_relation_size(c.oid)) AS table_size,
            pg_size_pretty(pg_total_relation_size(c.oid) - pg_relation_size(c.oid)) AS index_size,
            pg_total_relation_size(c.oid) AS total_size_bytes,
            COALESCE(s.last_vacuum::TEXT, 'never') AS last_vacuum,
            COALESCE(s.last_autovacuum::TEXT, 'never') AS last_autovacuum,
            COALESCE(s.last_analyze::TEXT, 'never') AS last_analyze,
            COALESCE(s.n_live_tup, 0) AS live_rows,
            COALESCE(s.n_dead_tup, 0) AS dead_rows
        FROM pg_tables t
        JOIN pg_class c ON c.relname = t.tablename
        JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = t.schemaname
        LEFT JOIN pg_stat_user_tables s ON s.relname = t.tablename AND s.schemaname = t.schemaname
        WHERE t.schemaname = 'public'
        ORDER BY pg_total_relation_size(c.oid) DESC
        """
    )

    return {
        "data": {
            "tables": [dict(r) for r in rows],
            "total_tables": len(rows),
        },
        "message": f"Thống kê {len(rows)} bảng trong database",
    }


# ---------------------------------------------------------------------------
# GET /api-performance — Table access patterns
# ---------------------------------------------------------------------------

@router.get("/api-performance")
async def api_performance(
    token_data: TokenData = Depends(require_role("admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """
    Returns pg_stat_user_tables access patterns:
    - Sequential scans (high = missing index)
    - Index scans ratio
    - Insert/update/delete counts
    Also returns pg_stat_statements top queries if the extension is available.
    """
    # Table access patterns
    access_rows = await conn.fetch(
        """
        SELECT
            relname AS table_name,
            seq_scan,
            seq_tup_read,
            idx_scan,
            idx_tup_fetch,
            n_tup_ins AS inserts,
            n_tup_upd AS updates,
            n_tup_del AS deletes,
            n_live_tup AS live_rows,
            CASE
                WHEN (seq_scan + COALESCE(idx_scan, 0)) = 0 THEN NULL
                ELSE ROUND(
                    100.0 * COALESCE(idx_scan, 0) / (seq_scan + COALESCE(idx_scan, 0)), 2
                )
            END AS index_hit_pct
        FROM pg_stat_user_tables
        ORDER BY seq_scan DESC
        LIMIT 30
        """
    )

    # Check if pg_stat_statements is available
    has_pg_stat_statements = await conn.fetchval(
        "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements')"
    )

    slow_queries = []
    if has_pg_stat_statements:
        try:
            sq_rows = await conn.fetch(
                """
                SELECT
                    LEFT(query, 200) AS query_preview,
                    calls,
                    ROUND((total_exec_time / calls)::NUMERIC, 2) AS avg_ms,
                    ROUND(total_exec_time::NUMERIC, 2) AS total_ms,
                    rows
                FROM pg_stat_statements
                WHERE calls > 10
                ORDER BY avg_ms DESC
                LIMIT 20
                """
            )
            slow_queries = [dict(r) for r in sq_rows]
        except Exception as exc:
            logger.warning("Could not query pg_stat_statements: %s", exc)

    return {
        "data": {
            "table_access_patterns": [dict(r) for r in access_rows],
            "slow_queries": slow_queries,
            "pg_stat_statements_available": has_pg_stat_statements,
        },
        "message": "Hiệu suất API và truy vấn database",
    }


# ---------------------------------------------------------------------------
# GET /errors — List error_log with filters
# ---------------------------------------------------------------------------

@router.get("/errors")
async def list_errors(
    error_type: Optional[str] = Query(None),
    severity: Optional[str] = Query(None, description="warning | error | critical"),
    resolved: Optional[bool] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    token_data: TokenData = Depends(require_role("admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """List errors from error_log with optional filters and pagination."""
    conditions = ["1=1"]
    params: list = []
    idx = 1

    if error_type:
        conditions.append(f"error_type = ${idx}")
        params.append(error_type)
        idx += 1

    if severity:
        conditions.append(f"severity = ${idx}")
        params.append(severity)
        idx += 1

    if resolved is not None:
        conditions.append(f"resolved = ${idx}")
        params.append(resolved)
        idx += 1

    where = " AND ".join(conditions)

    total = await conn.fetchval(
        f"SELECT COUNT(*) FROM error_log WHERE {where}", *params
    )

    offset = (page - 1) * limit
    rows = await conn.fetch(
        f"""
        SELECT
            el.id, el.error_type, el.severity, el.message,
            el.endpoint, el.resolved, el.created_at, el.resolved_at,
            el.user_id,
            u.full_name AS user_name,
            rb.full_name AS resolved_by_name
        FROM error_log el
        LEFT JOIN users u ON u.id = el.user_id
        LEFT JOIN users rb ON rb.id = el.resolved_by
        WHERE {where}
        ORDER BY el.created_at DESC
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
                    "error_type": r["error_type"],
                    "severity": r["severity"],
                    "message": r["message"],
                    "endpoint": r["endpoint"],
                    "resolved": r["resolved"],
                    "created_at": r["created_at"].isoformat(),
                    "resolved_at": r["resolved_at"].isoformat() if r["resolved_at"] else None,
                    "user_id": str(r["user_id"]) if r["user_id"] else None,
                    "user_name": r["user_name"],
                    "resolved_by_name": r["resolved_by_name"],
                }
                for r in rows
            ],
            "total": total,
            "page": page,
            "limit": limit,
        },
        "message": f"Danh sách lỗi ({total} bản ghi)",
    }


# ---------------------------------------------------------------------------
# POST /errors/{id}/resolve — Mark error as resolved
# ---------------------------------------------------------------------------

@router.post("/errors/{error_id}/resolve")
async def resolve_error(
    error_id: int,
    token_data: TokenData = Depends(require_role("admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Mark an error as resolved by the current admin user."""
    row = await conn.fetchrow(
        "SELECT id, resolved FROM error_log WHERE id = $1", error_id
    )
    if not row:
        raise HTTPException(status_code=404, detail="Lỗi không tìm thấy")
    if row["resolved"]:
        raise HTTPException(status_code=400, detail="Lỗi này đã được giải quyết")

    await conn.execute(
        """
        UPDATE error_log
        SET resolved = true,
            resolved_by = $1::uuid,
            resolved_at = NOW()
        WHERE id = $2
        """,
        token_data.user_id,
        error_id,
    )

    return {
        "data": {"id": error_id, "resolved": True},
        "message": "Đã đánh dấu lỗi là đã giải quyết",
    }


# ---------------------------------------------------------------------------
# GET /errors/summary — Error counts by type and severity
# ---------------------------------------------------------------------------

@router.get("/errors/summary")
async def errors_summary(
    days: int = Query(7, ge=1, le=90, description="Số ngày cần thống kê"),
    token_data: TokenData = Depends(require_role("admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Return error counts grouped by type and severity for the last N days."""
    by_type = await conn.fetch(
        """
        SELECT error_type, COUNT(*) AS total,
               SUM(CASE WHEN resolved = false THEN 1 ELSE 0 END) AS unresolved
        FROM error_log
        WHERE created_at >= NOW() - ($1 || ' days')::INTERVAL
        GROUP BY error_type
        ORDER BY total DESC
        """,
        str(days),
    )

    by_severity = await conn.fetch(
        """
        SELECT severity, COUNT(*) AS total,
               SUM(CASE WHEN resolved = false THEN 1 ELSE 0 END) AS unresolved
        FROM error_log
        WHERE created_at >= NOW() - ($1 || ' days')::INTERVAL
        GROUP BY severity
        ORDER BY
            CASE severity WHEN 'critical' THEN 1 WHEN 'error' THEN 2 ELSE 3 END
        """,
        str(days),
    )

    daily_trend = await conn.fetch(
        """
        SELECT
            DATE_TRUNC('day', created_at)::DATE AS day,
            COUNT(*) AS total,
            SUM(CASE WHEN severity = 'critical' THEN 1 ELSE 0 END) AS critical
        FROM error_log
        WHERE created_at >= NOW() - ($1 || ' days')::INTERVAL
        GROUP BY day
        ORDER BY day
        """,
        str(days),
    )

    return {
        "data": {
            "period_days": days,
            "by_type": [dict(r) for r in by_type],
            "by_severity": [dict(r) for r in by_severity],
            "daily_trend": [
                {"day": r["day"].isoformat(), "total": r["total"], "critical": r["critical"]}
                for r in daily_trend
            ],
        },
        "message": f"Tóm tắt lỗi trong {days} ngày qua",
    }


# ---------------------------------------------------------------------------
# GET /health-history — Historical health check results
# ---------------------------------------------------------------------------

@router.get("/health-history")
async def health_history(
    check_type: Optional[str] = Query(None),
    hours: int = Query(24, ge=1, le=168, description="Số giờ lịch sử"),
    page: int = Query(1, ge=1),
    limit: int = Query(100, ge=1, le=500),
    token_data: TokenData = Depends(require_role("admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Return historical health check records with optional filters."""
    conditions = ["created_at >= NOW() - ($1 || ' hours')::INTERVAL"]
    params: list = [str(hours)]
    idx = 2

    if check_type:
        conditions.append(f"check_type = ${idx}")
        params.append(check_type)
        idx += 1

    where = " AND ".join(conditions)

    total = await conn.fetchval(
        f"SELECT COUNT(*) FROM system_health_checks WHERE {where}", *params
    )

    offset = (page - 1) * limit
    rows = await conn.fetch(
        f"""
        SELECT id, check_type, status, response_time_ms, details, created_at
        FROM system_health_checks
        WHERE {where}
        ORDER BY created_at DESC
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
                    "check_type": r["check_type"],
                    "status": r["status"],
                    "response_time_ms": r["response_time_ms"],
                    "details": r["details"],
                    "created_at": r["created_at"].isoformat(),
                }
                for r in rows
            ],
            "total": total,
            "page": page,
            "limit": limit,
        },
        "message": f"Lịch sử health check trong {hours} giờ qua",
    }


# ---------------------------------------------------------------------------
# POST /health-check — Run live health check
# ---------------------------------------------------------------------------

@router.post("/health-check")
async def run_health_check(
    token_data: TokenData = Depends(require_role("admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """
    Run a live health check:
    1. PostgreSQL SELECT 1 with timing
    2. Redis ping with timing
    3. DB size query
    4. Table count
    Save each result to system_health_checks and return combined report.
    """
    results = []

    # --- 1. PostgreSQL ---
    t0 = time.monotonic()
    try:
        await conn.fetchval("SELECT 1")
        db_ms = int((time.monotonic() - t0) * 1000)
        db_status = "healthy" if db_ms < 500 else "degraded"
        db_size = await conn.fetchval("SELECT pg_database_size(current_database())")
        db_size_human = await conn.fetchval(
            "SELECT pg_size_pretty(pg_database_size(current_database()))"
        )
        db_details = {"size_bytes": db_size, "size_human": db_size_human}
    except Exception as exc:
        db_ms = int((time.monotonic() - t0) * 1000)
        db_status = "unhealthy"
        db_details = {"error": str(exc)}
        logger.error("DB health check failed: %s", exc)

    await conn.execute(
        """
        INSERT INTO system_health_checks (check_type, status, response_time_ms, details)
        VALUES ('database', $1, $2, $3)
        """,
        db_status,
        db_ms,
        db_details,
    )
    results.append({"check_type": "database", "status": db_status, "response_time_ms": db_ms, "details": db_details})

    # --- 2. Redis ---
    t0 = time.monotonic()
    try:
        redis_ok = await cache.ping()
        redis_ms = int((time.monotonic() - t0) * 1000)
        if not redis_ok:
            redis_status = "unhealthy"
            redis_details: dict = {"error": "ping returned False"}
        elif redis_ms < 100:
            redis_status = "healthy"
            redis_info = await cache.info()
            redis_details = redis_info
        else:
            redis_status = "degraded"
            redis_info = await cache.info()
            redis_details = redis_info
    except Exception as exc:
        redis_ms = int((time.monotonic() - t0) * 1000)
        redis_status = "unhealthy"
        redis_details = {"error": str(exc)}
        logger.error("Redis health check failed: %s", exc)

    await conn.execute(
        """
        INSERT INTO system_health_checks (check_type, status, response_time_ms, details)
        VALUES ('redis', $1, $2, $3)
        """,
        redis_status,
        redis_ms,
        redis_details,
    )
    results.append({"check_type": "redis", "status": redis_status, "response_time_ms": redis_ms, "details": redis_details})

    # --- 3. Table count ---
    t0 = time.monotonic()
    try:
        tbl_count = await conn.fetchval(
            "SELECT COUNT(*) FROM pg_tables WHERE schemaname = 'public'"
        )
        tbl_ms = int((time.monotonic() - t0) * 1000)
        tbl_status = "healthy"
        tbl_details: dict = {"public_tables": tbl_count}
    except Exception as exc:
        tbl_ms = int((time.monotonic() - t0) * 1000)
        tbl_status = "degraded"
        tbl_details = {"error": str(exc)}

    await conn.execute(
        """
        INSERT INTO system_health_checks (check_type, status, response_time_ms, details)
        VALUES ('api', $1, $2, $3)
        """,
        tbl_status,
        tbl_ms,
        tbl_details,
    )
    results.append({"check_type": "api", "status": tbl_status, "response_time_ms": tbl_ms, "details": tbl_details})

    overall = (
        "unhealthy"
        if any(r["status"] == "unhealthy" for r in results)
        else "degraded"
        if any(r["status"] == "degraded" for r in results)
        else "healthy"
    )

    return {
        "data": {
            "overall_status": overall,
            "checks": results,
        },
        "message": "Health check hoàn thành",
    }


# ---------------------------------------------------------------------------
# GET /backups — List backup history
# ---------------------------------------------------------------------------

@router.get("/backups")
async def list_backups(
    backup_type: Optional[str] = Query(None, description="full | incremental | manual"),
    status: Optional[str] = Query(None, description="running | completed | failed"),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    token_data: TokenData = Depends(require_role("admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """List backup history from backup_log with pagination."""
    conditions = ["1=1"]
    params: list = []
    idx = 1

    if backup_type:
        conditions.append(f"backup_type = ${idx}")
        params.append(backup_type)
        idx += 1

    if status:
        conditions.append(f"status = ${idx}")
        params.append(status)
        idx += 1

    where = " AND ".join(conditions)

    total = await conn.fetchval(
        f"SELECT COUNT(*) FROM backup_log WHERE {where}", *params
    )

    offset = (page - 1) * limit
    rows = await conn.fetch(
        f"""
        SELECT
            id, backup_type, file_path, file_size_bytes,
            tables_count, rows_count, duration_seconds,
            status, verified, verified_at, error_message, created_at
        FROM backup_log
        WHERE {where}
        ORDER BY created_at DESC
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
                    **{k: v for k, v in dict(r).items() if k not in ("created_at", "verified_at")},
                    "created_at": r["created_at"].isoformat(),
                    "verified_at": r["verified_at"].isoformat() if r["verified_at"] else None,
                }
                for r in rows
            ],
            "total": total,
            "page": page,
            "limit": limit,
        },
        "message": f"Lịch sử backup ({total} bản ghi)",
    }


# ---------------------------------------------------------------------------
# POST /backups/verify/{id} — Mark backup as verified
# ---------------------------------------------------------------------------

@router.post("/backups/verify/{backup_id}")
async def verify_backup(
    backup_id: int,
    token_data: TokenData = Depends(require_role("admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """Mark a backup record as manually verified."""
    row = await conn.fetchrow(
        "SELECT id, status, verified FROM backup_log WHERE id = $1", backup_id
    )
    if not row:
        raise HTTPException(status_code=404, detail="Bản ghi backup không tìm thấy")
    if row["status"] != "completed":
        raise HTTPException(
            status_code=400,
            detail="Chỉ có thể xác minh backup có trạng thái 'completed'",
        )
    if row["verified"]:
        raise HTTPException(status_code=400, detail="Backup này đã được xác minh")

    await conn.execute(
        """
        UPDATE backup_log
        SET verified = true, verified_at = NOW()
        WHERE id = $1
        """,
        backup_id,
    )

    return {
        "data": {"id": backup_id, "verified": True},
        "message": "Backup đã được xác minh thành công",
    }
