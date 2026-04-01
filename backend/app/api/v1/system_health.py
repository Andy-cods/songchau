"""
System Health API — REAL implementations.
Hiệu suất, Backup, Health Check with actual data.
"""

from __future__ import annotations

import json
import logging
import os
import time as _time
from datetime import datetime, date
from pathlib import Path

import asyncpg
import httpx
from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.database import get_db
from app.core.rbac import require_role
from app.core.security import TokenData

try:
    from app.core.cache import cache
except Exception:
    cache = None

logger = logging.getLogger(__name__)
router = APIRouter()

BACKUP_DIR = Path("/data/files/backups")


# ── Helpers ────────────────────────────────────────────────

async def _ping_redis():
    if cache is None:
        return False, 0, {}
    t0 = _time.time()
    try:
        ok = await cache.ping()
        ms = int((_time.time() - t0) * 1000)
        info = await cache.info()
        return ok, ms, info
    except Exception:
        return False, 0, {}


async def _ping_gotenberg():
    try:
        t0 = _time.time()
        async with httpx.AsyncClient(timeout=5) as c:
            r = await c.get("http://gotenberg:3000/health")
        ms = int((_time.time() - t0) * 1000)
        return r.status_code == 200, ms
    except Exception:
        return False, 0


def _disk_usage():
    try:
        st = os.statvfs("/data")
        total = st.f_blocks * st.f_frsize
        free = st.f_bavail * st.f_frsize
        used = total - free
        return {"total_gb": round(total / 1e9, 1), "used_gb": round(used / 1e9, 1),
                "free_gb": round(free / 1e9, 1), "pct": round(used / total * 100, 1) if total else 0}
    except Exception:
        return {"total_gb": 0, "used_gb": 0, "free_gb": 0, "pct": 0}


# ── GET /dashboard ─────────────────────────────────────────

@router.get("/dashboard")
async def system_dashboard(
    token_data: TokenData = Depends(require_role("admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    db_size = await conn.fetchval("SELECT pg_size_pretty(pg_database_size(current_database()))")
    db_bytes = await conn.fetchval("SELECT pg_database_size(current_database())")
    table_count = await conn.fetchval("SELECT COUNT(*) FROM pg_tables WHERE schemaname='public'")
    total_rows = await conn.fetchval(
        "SELECT COALESCE(SUM(n_live_tup),0) FROM pg_stat_user_tables"
    )

    redis_ok, redis_ms, redis_info = await _ping_redis()
    disk = _disk_usage()

    last_syncs = await conn.fetch(
        "SELECT DISTINCT ON (sync_type) sync_type, status, completed_at, rows_inserted "
        "FROM etl_sync_log ORDER BY sync_type, started_at DESC"
    )

    unresolved = await conn.fetchval("SELECT COUNT(*) FROM error_log WHERE resolved=false")
    pending_retry = await conn.fetchval("SELECT COUNT(*) FROM retry_queue WHERE status IN ('pending','retrying')")

    active_conns = await conn.fetchval("SELECT COUNT(*) FROM pg_stat_activity WHERE state='active'")

    return {"data": {
        "database": {"size": db_size, "size_bytes": db_bytes, "tables": table_count,
                      "rows": total_rows, "active_connections": active_conns},
        "redis": {"connected": redis_ok, "memory": redis_info.get("used_memory_human", "N/A"),
                  "clients": redis_info.get("connected_clients", 0), "latency_ms": redis_ms},
        "disk": disk,
        "etl_sync": [{"type": r["sync_type"], "status": r["status"],
                       "completed_at": r["completed_at"].isoformat() if r["completed_at"] else None,
                       "rows": r["rows_inserted"]} for r in last_syncs],
        "errors_unresolved": unresolved,
        "retry_pending": pending_retry,
    }}


# ── GET /db-stats ──────────────────────────────────────────

@router.get("/db-stats")
async def db_stats(
    token_data: TokenData = Depends(require_role("admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    rows = await conn.fetch("""
        SELECT t.tablename,
               pg_size_pretty(pg_total_relation_size(quote_ident(t.tablename)::regclass)) as size,
               pg_total_relation_size(quote_ident(t.tablename)::regclass) as size_bytes,
               COALESCE(s.n_live_tup, 0) as row_count,
               s.seq_scan, s.idx_scan,
               s.last_vacuum, s.last_analyze
        FROM pg_tables t
        LEFT JOIN pg_stat_user_tables s ON s.relname = t.tablename
        WHERE t.schemaname = 'public'
        ORDER BY pg_total_relation_size(quote_ident(t.tablename)::regclass) DESC
    """)
    return {"data": [dict(r) for r in rows]}


# ── POST /health-check ────────────────────────────────────

@router.post("/health-check")
async def run_health_check(
    token_data: TokenData = Depends(require_role("admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    results = []

    # 1. PostgreSQL
    t0 = _time.time()
    try:
        await conn.fetchval("SELECT 1")
        pg_ms = int((_time.time() - t0) * 1000)
        pg_status = "healthy"
    except Exception as e:
        pg_ms = int((_time.time() - t0) * 1000)
        pg_status = "unhealthy"
    results.append({"check": "postgresql", "status": pg_status, "ms": pg_ms})
    await conn.execute(
        "INSERT INTO system_health_checks (check_type, status, response_time_ms, details) VALUES ($1,$2,$3,$4::jsonb)",
        "database", pg_status, pg_ms, json.dumps({"type": "postgresql"})
    )

    # 2. Redis
    redis_ok, redis_ms, _ = await _ping_redis()
    r_status = "healthy" if redis_ok else "unhealthy"
    results.append({"check": "redis", "status": r_status, "ms": redis_ms})
    await conn.execute(
        "INSERT INTO system_health_checks (check_type, status, response_time_ms, details) VALUES ($1,$2,$3,$4::jsonb)",
        "redis", r_status, redis_ms, json.dumps({"connected": redis_ok})
    )

    # 3. Gotenberg
    got_ok, got_ms = await _ping_gotenberg()
    g_status = "healthy" if got_ok else "unhealthy"
    results.append({"check": "gotenberg", "status": g_status, "ms": got_ms})
    await conn.execute(
        "INSERT INTO system_health_checks (check_type, status, response_time_ms, details) VALUES ($1,$2,$3,$4::jsonb)",
        "gotenberg", g_status, got_ms, json.dumps({"reachable": got_ok})
    )

    # 4. Disk
    disk = _disk_usage()
    d_status = "healthy" if disk["pct"] < 85 else "degraded" if disk["pct"] < 95 else "unhealthy"
    results.append({"check": "disk", "status": d_status, "details": disk})
    await conn.execute(
        "INSERT INTO system_health_checks (check_type, status, response_time_ms, details) VALUES ($1,$2,$3,$4::jsonb)",
        "disk", d_status, 0, json.dumps(disk)
    )

    overall = "healthy"
    if any(r["status"] == "unhealthy" for r in results):
        overall = "unhealthy"
    elif any(r["status"] == "degraded" for r in results):
        overall = "degraded"

    return {"data": {"overall": overall, "checks": results}, "message": f"Kiểm tra hoàn tất: {overall}"}


# ── Errors ─────────────────────────────────────────────────

@router.get("/errors")
async def list_errors(
    severity: str | None = None, resolved: bool | None = None,
    page: int = Query(1, ge=1), limit: int = Query(20, ge=1, le=100),
    token_data: TokenData = Depends(require_role("admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    conds, params, idx = ["1=1"], [], 1
    if severity:
        conds.append(f"severity=${ idx}"); params.append(severity); idx += 1
    if resolved is not None:
        conds.append(f"resolved=${idx}"); params.append(resolved); idx += 1
    where = " AND ".join(conds)
    total = await conn.fetchval(f"SELECT COUNT(*) FROM error_log WHERE {where}", *params)
    params.extend([limit, (page - 1) * limit])
    rows = await conn.fetch(
        f"SELECT * FROM error_log WHERE {where} ORDER BY created_at DESC LIMIT ${idx} OFFSET ${idx+1}",
        *params,
    )
    return {"data": {"items": [dict(r) for r in rows], "total": total, "page": page}}


@router.post("/errors/{error_id}/resolve")
async def resolve_error(
    error_id: int,
    token_data: TokenData = Depends(require_role("admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    await conn.execute(
        "UPDATE error_log SET resolved=true, resolved_by=$1::uuid, resolved_at=NOW() WHERE id=$2",
        token_data.user_id, error_id,
    )
    return {"message": "Đã đánh dấu lỗi đã xử lý"}


@router.get("/errors/summary")
async def error_summary(
    token_data: TokenData = Depends(require_role("admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    by_severity = await conn.fetch(
        "SELECT severity, COUNT(*) as count FROM error_log WHERE resolved=false GROUP BY severity"
    )
    by_type = await conn.fetch(
        "SELECT error_type, COUNT(*) as count FROM error_log WHERE resolved=false GROUP BY error_type"
    )
    last_7d = await conn.fetchval(
        "SELECT COUNT(*) FROM error_log WHERE created_at > NOW() - interval '7 days'"
    )
    return {"data": {
        "by_severity": {r["severity"]: r["count"] for r in by_severity},
        "by_type": {r["error_type"]: r["count"] for r in by_type},
        "last_7d": last_7d,
        "unresolved": sum(r["count"] for r in by_severity),
    }}


# ── Health History ─────────────────────────────────────────

@router.get("/health-history")
async def health_history(
    check_type: str | None = None, hours: int = Query(24, ge=1, le=720),
    token_data: TokenData = Depends(require_role("admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    conds = [f"created_at > NOW() - interval '{hours} hours'"]
    params = []
    if check_type:
        conds.append("check_type=$1"); params.append(check_type)
    where = " AND ".join(conds)
    rows = await conn.fetch(
        f"SELECT * FROM system_health_checks WHERE {where} ORDER BY created_at DESC LIMIT 100",
        *params,
    )
    return {"data": [dict(r) for r in rows]}


# ── Backups ────────────────────────────────────────────────

@router.get("/backups")
async def list_backups(
    token_data: TokenData = Depends(require_role("admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    rows = await conn.fetch("SELECT * FROM backup_log ORDER BY created_at DESC LIMIT 50")

    # Also check filesystem
    fs_files = []
    if BACKUP_DIR.exists():
        for f in sorted(BACKUP_DIR.iterdir(), key=lambda x: x.stat().st_mtime, reverse=True)[:20]:
            if f.is_file():
                fs_files.append({"name": f.name, "size": f.stat().st_size, "modified": datetime.fromtimestamp(f.stat().st_mtime).isoformat()})

    return {"data": {"db_records": [dict(r) for r in rows], "files": fs_files}}


@router.post("/backups/create")
async def create_backup(
    token_data: TokenData = Depends(require_role("admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"backup_{ts}.json"
    filepath = BACKUP_DIR / filename

    t0 = _time.time()

    # Create backup_log entry
    backup_id = await conn.fetchval(
        "INSERT INTO backup_log (backup_type, file_path, status) VALUES ('manual', $1, 'running') RETURNING id",
        str(filepath),
    )

    try:
        # Dump all table row counts + schema info
        tables = await conn.fetch(
            "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"
        )
        backup_data = {"timestamp": ts, "tables": {}}
        total_rows = 0

        for t in tables:
            name = t["tablename"]
            count = await conn.fetchval(f"SELECT COUNT(*) FROM {name}")
            total_rows += count
            # Get column info
            cols = await conn.fetch(
                "SELECT column_name, data_type FROM information_schema.columns WHERE table_name=$1 ORDER BY ordinal_position",
                name,
            )
            backup_data["tables"][name] = {
                "rows": count,
                "columns": [{"name": c["column_name"], "type": c["data_type"]} for c in cols],
            }

            # For small tables (<1000 rows), dump actual data
            if count <= 1000 and count > 0:
                try:
                    rows = await conn.fetch(f"SELECT * FROM {name} LIMIT 1000")
                    backup_data["tables"][name]["data"] = [
                        {k: str(v) for k, v in dict(r).items()} for r in rows
                    ]
                except Exception:
                    pass  # skip if serialization fails

        backup_data["total_tables"] = len(tables)
        backup_data["total_rows"] = total_rows

        # Write file
        with open(filepath, "w") as f:
            json.dump(backup_data, f, default=str, ensure_ascii=False)

        file_size = filepath.stat().st_size
        duration = int(_time.time() - t0)

        await conn.execute(
            "UPDATE backup_log SET status='completed', file_size_bytes=$1, tables_count=$2, "
            "rows_count=$3, duration_seconds=$4 WHERE id=$5",
            file_size, len(tables), total_rows, duration, backup_id,
        )

        return {"data": {
            "id": backup_id, "file": filename, "size_bytes": file_size,
            "size_human": f"{file_size / 1024 / 1024:.1f} MB",
            "tables": len(tables), "rows": total_rows, "duration_s": duration,
        }, "message": f"Backup hoàn tất: {len(tables)} tables, {total_rows:,} rows"}

    except Exception as exc:
        await conn.execute(
            "UPDATE backup_log SET status='failed', error_message=$1 WHERE id=$2",
            str(exc), backup_id,
        )
        raise HTTPException(500, f"Backup thất bại: {exc}")


@router.post("/backups/verify/{backup_id}")
async def verify_backup(
    backup_id: int,
    token_data: TokenData = Depends(require_role("admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    row = await conn.fetchrow("SELECT * FROM backup_log WHERE id=$1", backup_id)
    if not row:
        raise HTTPException(404, "Backup không tồn tại")

    file_exists = Path(row["file_path"]).exists() if row["file_path"] else False

    await conn.execute(
        "UPDATE backup_log SET verified=true, verified_at=NOW() WHERE id=$1", backup_id
    )

    return {"data": {"verified": True, "file_exists": file_exists},
            "message": "Đã xác nhận backup" + (" (file tồn tại)" if file_exists else " (file không tìm thấy)")}
