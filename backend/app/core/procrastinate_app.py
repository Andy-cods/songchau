"""
Procrastinate application — task queue backed by PostgreSQL.

Procrastinate uses psycopg (sync) for its internal bookkeeping, NOT the
asyncpg pool used by FastAPI.  We build the sync DSN from the same env vars
so there is a single source of truth.

Sync DSN format:
    postgresql://scadmin:<password>@postgres:5432/songchau_erp

The `import_paths` list tells Procrastinate where to look for task
definitions when a worker process starts up.  Every module in app/tasks/
must be reachable through this list.

Typical worker start-up (from the Docker container):
    procrastinate --app app.core.procrastinate_app.app worker

Periodic / scheduled tasks are registered with the @app.periodic() decorator
inside app/tasks/*.py and do NOT need external cron configuration.
"""

from __future__ import annotations

import logging
import os

import procrastinate

from app.core.config import settings

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Build sync PostgreSQL DSN
# ---------------------------------------------------------------------------
# settings.sync_database_url strips "+asyncpg" from the async URL, giving a
# plain "postgresql://" DSN that psycopg2 / psycopg can consume directly.

def _build_sync_dsn() -> str:
    """Return a plain postgresql:// DSN for Procrastinate's psycopg connector."""
    # Prefer an explicit DATABASE_URL if set in the environment
    if settings.DATABASE_URL:
        dsn = settings.DATABASE_URL
        # Strip any asyncpg dialect marker
        return dsn.replace("postgresql+asyncpg://", "postgresql://").replace("+asyncpg", "")

    return (
        f"postgresql://{settings.POSTGRES_USER}:{settings.POSTGRES_PASSWORD}"
        f"@postgres:5432/{settings.POSTGRES_DB}"
    )


SYNC_DSN = _build_sync_dsn()

# ---------------------------------------------------------------------------
# Procrastinate App
# ---------------------------------------------------------------------------
# SyncPsycopgConnector accepts keyword arguments that are forwarded to
# psycopg.connect().  We pass 'conninfo' (the DSN string) explicitly so the
# worker does not need DATABASE_URL in its environment separately from
# POSTGRES_* variables.

app = procrastinate.App(
    connector=procrastinate.SyncPsycopgConnector(json_dumps=None, json_loads=None),
    import_paths=["app.tasks"],
)

# Expose the DSN for use by tasks that open their own psycopg2 connections.
# The Procrastinate connector's open() / open_async() call is handled by the
# worker startup; tasks use SYNC_DSN directly via psycopg2.connect(SYNC_DSN).

logger.info("Procrastinate app initialised (connector=SyncPsycopgConnector, dsn built)")
