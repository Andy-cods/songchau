"""
Container History API (M21) — Docker container monitoring for Song Châu ERP.

Since the API runs inside a container and cannot execute docker commands directly,
these endpoints serve data from the latest system_health_checks records stored in
the database, supplemented by known container configuration.

Endpoints:
  GET /          — List current container statuses (from latest health checks)
  GET /logs/{container_name} — Last N log lines from health check details
  GET /resources — Container resource usage from stored health data
"""

from __future__ import annotations

import logging
from typing import Optional

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.database import get_db
from app.core.rbac import require_role
from app.core.security import TokenData

logger = logging.getLogger(__name__)

router = APIRouter()

# Known containers in the Song Châu ERP stack
KNOWN_CONTAINERS = [
    {
        "name": "songchau-api",
        "image": "songchau-erp/api",
        "description": "FastAPI backend server",
        "port": "8000",
        "role": "backend",
    },
    {
        "name": "songchau-frontend",
        "image": "songchau-erp/frontend",
        "description": "Next.js frontend",
        "port": "3000",
        "role": "frontend",
    },
    {
        "name": "songchau-postgres",
        "image": "postgres:15",
        "description": "PostgreSQL database",
        "port": "5432",
        "role": "database",
    },
    {
        "name": "songchau-redis",
        "image": "redis:7-alpine",
        "description": "Redis cache",
        "port": "6379",
        "role": "cache",
    },
    {
        "name": "songchau-nginx",
        "image": "nginx:alpine",
        "description": "Nginx reverse proxy",
        "port": "80/443",
        "role": "proxy",
    },
]


def _infer_container_status(container_name: str, health_checks: list[dict]) -> dict:
    """
    Infer container status from the latest stored health check results.
    Maps container roles to relevant check_types.
    """
    role_to_check = {
        "database": "database",
        "cache": "redis",
        "backend": "api",
        "frontend": "api",
        "proxy": "api",
    }

    container = next(
        (c for c in KNOWN_CONTAINERS if c["name"] == container_name), None
    )
    if not container:
        return {"status": "unknown", "health_source": None}

    check_type = role_to_check.get(container["role"], "api")
    relevant = next((h for h in health_checks if h["check_type"] == check_type), None)

    if relevant is None:
        return {"status": "unknown", "health_source": "no_data"}

    check_status = relevant["status"]
    container_status = {
        "healthy": "running",
        "degraded": "running (degraded)",
        "unhealthy": "exited",
    }.get(check_status, "unknown")

    return {
        "status": container_status,
        "health_status": check_status,
        "response_time_ms": relevant.get("response_time_ms"),
        "last_checked": relevant.get("created_at"),
        "health_source": "system_health_checks",
    }


# ---------------------------------------------------------------------------
# GET / — List current container statuses
# ---------------------------------------------------------------------------

@router.get("")
async def list_containers(
    token_data: TokenData = Depends(require_role("admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """
    Returns current container statuses inferred from the latest stored
    health check results in system_health_checks.
    """
    # Get most recent health check per type
    rows = await conn.fetch(
        """
        SELECT DISTINCT ON (check_type)
            check_type, status, response_time_ms, details, created_at
        FROM system_health_checks
        ORDER BY check_type, created_at DESC
        """
    )

    health_checks = [
        {
            "check_type": r["check_type"],
            "status": r["status"],
            "response_time_ms": r["response_time_ms"],
            "details": r["details"],
            "created_at": r["created_at"].isoformat(),
        }
        for r in rows
    ]

    containers = []
    for c in KNOWN_CONTAINERS:
        inferred = _infer_container_status(c["name"], health_checks)
        containers.append(
            {
                **c,
                **inferred,
            }
        )

    # Count by status
    running = sum(1 for c in containers if "running" in (c.get("status") or ""))
    total = len(containers)

    return {
        "data": {
            "containers": containers,
            "summary": {
                "total": total,
                "running": running,
                "stopped": total - running,
            },
            "health_data_source": "system_health_checks",
            "note": (
                "Trạng thái container được suy luận từ kết quả health check "
                "gần nhất. Chạy POST /system-health/health-check để cập nhật."
            ),
        },
        "message": f"Trạng thái {total} container trong hệ thống",
    }


# ---------------------------------------------------------------------------
# GET /logs/{container_name} — Container log lines from health check details
# ---------------------------------------------------------------------------

@router.get("/logs/{container_name}")
async def container_logs(
    container_name: str,
    lines: int = Query(50, ge=1, le=500, description="Số dòng log cần lấy"),
    token_data: TokenData = Depends(require_role("admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """
    Return stored log lines for a container from system_health_checks details.
    If no logs are stored, returns the most recent health check details
    for the relevant component.
    """
    valid_names = [c["name"] for c in KNOWN_CONTAINERS]
    if container_name not in valid_names:
        raise HTTPException(
            status_code=404,
            detail=f"Container '{container_name}' không tồn tại. "
                   f"Hợp lệ: {', '.join(valid_names)}",
        )

    container = next(c for c in KNOWN_CONTAINERS if c["name"] == container_name)

    role_to_check = {
        "database": "database",
        "cache": "redis",
        "backend": "api",
        "frontend": "api",
        "proxy": "api",
    }
    check_type = role_to_check.get(container["role"], "api")

    # Get recent health check records for this component
    history = await conn.fetch(
        """
        SELECT id, status, response_time_ms, details, created_at
        FROM system_health_checks
        WHERE check_type = $1
        ORDER BY created_at DESC
        LIMIT $2
        """,
        check_type,
        lines,
    )

    log_entries = []
    for r in history:
        details = r["details"] or {}
        # Format as pseudo-log lines
        ts = r["created_at"].strftime("%Y-%m-%dT%H:%M:%S")
        log_entries.append(
            f"[{ts}] [{r['status'].upper()}] {container_name} — "
            f"response_time={r['response_time_ms']}ms "
            f"details={details}"
        )

    return {
        "data": {
            "container_name": container_name,
            "log_lines": log_entries,
            "total_lines": len(log_entries),
            "source": "system_health_checks",
            "check_type": check_type,
            "note": (
                "Log được tổng hợp từ lịch sử health check. "
                "Docker log trực tiếp không khả dụng từ bên trong container."
            ),
        },
        "message": f"Log container '{container_name}' ({len(log_entries)} dòng)",
    }


# ---------------------------------------------------------------------------
# GET /resources — Container resource usage
# ---------------------------------------------------------------------------

@router.get("/resources")
async def container_resources(
    token_data: TokenData = Depends(require_role("admin")),
    conn: asyncpg.Connection = Depends(get_db),
):
    """
    Returns estimated container resource usage based on stored health check data.
    DB size, Redis memory, and response times are retrieved from system_health_checks.
    """
    # DB size from latest database health check
    db_check = await conn.fetchrow(
        """
        SELECT details, response_time_ms, created_at
        FROM system_health_checks
        WHERE check_type = 'database'
        ORDER BY created_at DESC
        LIMIT 1
        """
    )

    # Redis info from latest redis health check
    redis_check = await conn.fetchrow(
        """
        SELECT details, response_time_ms, created_at
        FROM system_health_checks
        WHERE check_type = 'redis'
        ORDER BY created_at DESC
        LIMIT 1
        """
    )

    # Average response times over last 24h per check_type
    avg_times = await conn.fetch(
        """
        SELECT
            check_type,
            ROUND(AVG(response_time_ms)::NUMERIC, 1) AS avg_ms,
            MIN(response_time_ms) AS min_ms,
            MAX(response_time_ms) AS max_ms,
            COUNT(*) AS sample_count
        FROM system_health_checks
        WHERE created_at >= NOW() - INTERVAL '24 hours'
          AND response_time_ms IS NOT NULL
        GROUP BY check_type
        """
    )

    resources = []

    for c in KNOWN_CONTAINERS:
        resource: dict = {
            "container_name": c["name"],
            "role": c["role"],
            "description": c["description"],
        }

        if c["role"] == "database" and db_check:
            details = db_check["details"] or {}
            resource.update(
                {
                    "db_size_bytes": details.get("size_bytes"),
                    "db_size_human": details.get("size_human"),
                    "response_time_ms": db_check["response_time_ms"],
                    "last_measured": db_check["created_at"].isoformat(),
                }
            )
        elif c["role"] == "cache" and redis_check:
            details = redis_check["details"] or {}
            resource.update(
                {
                    "used_memory_bytes": details.get("used_memory"),
                    "used_memory_human": details.get("used_memory_human"),
                    "connected_clients": details.get("connected_clients"),
                    "response_time_ms": redis_check["response_time_ms"],
                    "last_measured": redis_check["created_at"].isoformat(),
                }
            )
        else:
            resource.update({"note": "Dữ liệu tài nguyên không có sẵn trực tiếp"})

        resources.append(resource)

    return {
        "data": {
            "resources": resources,
            "response_time_trends": [
                {
                    "check_type": r["check_type"],
                    "avg_ms": float(r["avg_ms"]) if r["avg_ms"] else None,
                    "min_ms": r["min_ms"],
                    "max_ms": r["max_ms"],
                    "sample_count": r["sample_count"],
                }
                for r in avg_times
            ],
            "note": (
                "Thông số tài nguyên container được lấy từ dữ liệu health check đã lưu. "
                "CPU/RAM trực tiếp không khả dụng từ bên trong container."
            ),
        },
        "message": "Tài nguyên sử dụng của các container",
    }
