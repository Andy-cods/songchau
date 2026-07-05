"""Enhanced health check endpoint with full service status reporting."""

from __future__ import annotations

import time
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
import asyncpg

from app.core.database import get_db
from app.core.cache import cache
from app.core.config import settings

router = APIRouter(tags=["health"])

logger = logging.getLogger(__name__)


async def _check_db(conn: asyncpg.Connection) -> dict:
    """Check PostgreSQL connectivity and basic stats."""
    try:
        result = await conn.fetchval("SELECT 1")
        version = await conn.fetchval("SELECT version()")
        db_size = await conn.fetchval(
            "SELECT pg_size_pretty(pg_database_size(current_database()))"
        )
        return {
            "status": "ok" if result == 1 else "error",
            "version": version.split(",")[0] if version else "unknown",
            "size": db_size,
        }
    except Exception as exc:
        logger.warning("Health check DB error: %s", exc)
        return {"status": "error", "detail": str(exc)}


async def _check_redis() -> dict:
    """Check Redis connectivity and memory usage."""
    try:
        pong = await cache.ping()
        if pong:
            info = await cache.info()
            return {"status": "ok", **info}
        return {"status": "error", "detail": "ping failed"}
    except Exception as exc:
        logger.warning("Health check Redis error: %s", exc)
        return {"status": "error", "detail": str(exc)}


def _get_uptime() -> float:
    """Get application uptime in seconds."""
    from app.main import _startup_time
    if _startup_time is None:
        return 0.0
    return round(time.monotonic() - _startup_time, 1)


@router.get("/api/health")
async def health_check(conn: asyncpg.Connection = Depends(get_db)):
    """Full health check of all services.

    Returns status for database, Redis cache, and overall system health.
    Overall status is "healthy" only if all subsystems are "ok".
    """
    db_status = await _check_db(conn)
    redis_status = await _check_redis()

    # Determine overall status
    all_ok = db_status["status"] == "ok" and redis_status["status"] == "ok"
    any_error = db_status["status"] == "error" or redis_status["status"] == "error"

    if all_ok:
        overall = "healthy"
    elif any_error:
        overall = "degraded"
    else:
        overall = "degraded"

    return {
        "status": overall,
        "version": "1.0.0",
        "environment": settings.APP_ENV,
        "database": db_status,
        "redis": redis_status,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "uptime_seconds": _get_uptime(),
    }


@router.get("/api/health/liveness")
async def liveness():
    """Lightweight liveness probe for container orchestration (K8s/Docker)."""
    return {"status": "alive"}


@router.get("/api/health/readiness")
async def readiness(conn: asyncpg.Connection = Depends(get_db)):
    """Readiness probe — returns 200 only if DB is reachable."""
    try:
        result = await conn.fetchval("SELECT 1")
        if result == 1:
            return {"status": "ready"}
    except Exception:
        pass

    from fastapi.responses import JSONResponse
    return JSONResponse(
        status_code=503,
        content={"status": "not_ready", "detail": "Database unavailable"},
    )
