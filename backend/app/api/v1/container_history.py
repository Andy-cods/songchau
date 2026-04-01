"""
Container Monitoring API — REAL health probing.
"""

from __future__ import annotations

import json
import logging
import os
import time as _time

import asyncpg
import httpx
from fastapi import APIRouter, Depends, Query

from app.core.database import get_db
from app.core.rbac import require_role
from app.core.security import TokenData

try:
    from app.core.cache import cache
except Exception:
    cache = None

logger = logging.getLogger(__name__)
router = APIRouter()

CONTAINERS = [
    {"name": "sc-postgres", "role": "PostgreSQL Database", "host": "postgres", "port": 5432, "check": "db"},
    {"name": "sc-redis", "role": "Redis Cache", "host": "redis", "port": 6379, "check": "redis"},
    {"name": "sc-api", "role": "FastAPI Backend", "host": "localhost", "port": 8000, "check": "self"},
    {"name": "sc-frontend", "role": "Next.js Frontend", "host": "frontend", "port": 3000, "check": "http"},
    {"name": "sc-libreoffice", "role": "Gotenberg PDF", "host": "gotenberg", "port": 3000, "check": "http_health"},
    {"name": "sc-nginx", "role": "Nginx Proxy", "host": "nginx", "port": 80, "check": "http"},
    {"name": "sc-worker", "role": "Task Worker", "host": None, "port": None, "check": "procrastinate"},
    {"name": "sc-scheduler", "role": "Task Scheduler", "host": None, "port": None, "check": "procrastinate"},
]


async def _check_http(host, port, path="/"):
    try:
        t0 = _time.time()
        async with httpx.AsyncClient(timeout=3) as c:
            r = await c.get(f"http://{host}:{port}{path}")
        ms = int((_time.time() - t0) * 1000)
        return ("running" if r.status_code < 500 else "degraded"), ms
    except Exception:
        return "stopped", 0


@router.get("/")
async def list_containers(
    token_data: TokenData = Depends(require_role("admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    results = []
    for c in CONTAINERS:
        status, ms, details = "unknown", 0, ""
        if c["check"] == "db":
            t0 = _time.time()
            try:
                await conn.fetchval("SELECT 1")
                ms = int((_time.time() - t0) * 1000)
                db_size = await conn.fetchval("SELECT pg_size_pretty(pg_database_size(current_database()))")
                status, details = "running", f"Size: {db_size}"
            except Exception:
                status = "stopped"
        elif c["check"] == "redis":
            if cache:
                try:
                    t0 = _time.time()
                    ok = await cache.ping()
                    ms = int((_time.time() - t0) * 1000)
                    info = await cache.info()
                    status = "running" if ok else "stopped"
                    details = f"Memory: {info.get('used_memory_human', 'N/A')}"
                except Exception:
                    status = "stopped"
            else:
                status = "unknown"
        elif c["check"] == "self":
            status, details = "running", f"PID: {os.getpid()}"
        elif c["check"] == "http":
            status, ms = await _check_http(c["host"], c["port"])
        elif c["check"] == "http_health":
            status, ms = await _check_http(c["host"], c["port"], "/health")
        elif c["check"] == "procrastinate":
            try:
                recent = await conn.fetchval(
                    "SELECT COUNT(*) FROM procrastinate_jobs WHERE started_at > NOW() - interval '1 hour'"
                )
                status = "running" if recent and recent > 0 else "idle"
                details = f"{recent or 0} jobs/hour"
            except Exception:
                status = "unknown"
        results.append({"name": c["name"], "role": c["role"], "status": status,
                        "response_time_ms": ms, "details": details})
    running = sum(1 for r in results if r["status"] in ("running", "idle"))
    return {"data": results, "message": f"{running}/{len(results)} services active"}


@router.get("/logs/{container_name}")
async def container_logs(
    container_name: str, lines: int = Query(50, ge=10, le=200),
    token_data: TokenData = Depends(require_role("admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    log_lines = []
    if "postgres" in container_name:
        rows = await conn.fetch(
            "SELECT pid, state, query, query_start FROM pg_stat_activity "
            "WHERE query NOT LIKE '%pg_stat%' ORDER BY query_start DESC NULLS LAST LIMIT $1", lines
        )
        for r in rows:
            log_lines.append(f"[{r['query_start']}] pid={r['pid']} {r['state']}: {str(r['query'])[:120]}")
    elif "redis" in container_name:
        if cache:
            try:
                info = await cache.info()
                for k, v in info.items():
                    log_lines.append(f"{k}: {v}")
            except Exception:
                log_lines.append("Redis not available")
    elif "worker" in container_name or "scheduler" in container_name:
        try:
            rows = await conn.fetch(
                "SELECT id, task_name, status, started_at, finished_at "
                "FROM procrastinate_jobs ORDER BY id DESC LIMIT $1", lines
            )
            for r in rows:
                log_lines.append(f"Job#{r['id']} {r['task_name']}: {r['status']} started={r['started_at']}")
        except Exception as e:
            log_lines.append(f"Error: {e}")
    elif "api" in container_name:
        rows = await conn.fetch(
            "SELECT check_type, status, response_time_ms, created_at "
            "FROM system_health_checks ORDER BY created_at DESC LIMIT $1", lines
        )
        for r in rows:
            log_lines.append(f"[{r['created_at']}] {r['check_type']}: {r['status']} ({r['response_time_ms']}ms)")
    else:
        log_lines.append(f"Logs not available for {container_name} (no direct docker access)")
    return {"data": {"container": container_name, "lines": log_lines, "count": len(log_lines)}}


@router.get("/resources")
async def resources(
    token_data: TokenData = Depends(require_role("admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    db_size = await conn.fetchval("SELECT pg_database_size(current_database())")
    db_conns = await conn.fetchval("SELECT COUNT(*) FROM pg_stat_activity")
    db_max = await conn.fetchval("SHOW max_connections")
    redis_mem = 0
    if cache:
        try:
            info = await cache.info()
            redis_mem = info.get("used_memory", 0)
        except Exception:
            pass
    disk = {"total_gb": 0, "used_gb": 0, "free_gb": 0, "pct": 0}
    try:
        st = os.statvfs("/data")
        total, free = st.f_blocks * st.f_frsize, st.f_bavail * st.f_frsize
        disk = {"total_gb": round(total/1e9, 1), "used_gb": round((total-free)/1e9, 1),
                "free_gb": round(free/1e9, 1), "pct": round((total-free)/total*100, 1) if total else 0}
    except Exception:
        pass
    return {"data": {
        "database": {"size_bytes": db_size, "size_mb": round(db_size/1024/1024, 1),
                      "connections": db_conns, "max_connections": int(db_max)},
        "redis": {"memory_bytes": redis_mem, "memory_mb": round(redis_mem/1024/1024, 1)},
        "disk": disk,
    }}
