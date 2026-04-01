"""
Procrastinate application — task queue backed by PostgreSQL.
"""

from __future__ import annotations

import logging

import procrastinate

from app.core.config import settings

logger = logging.getLogger(__name__)


def _build_sync_dsn() -> str:
    if settings.DATABASE_URL:
        dsn = settings.DATABASE_URL
        return dsn.replace("postgresql+asyncpg://", "postgresql://").replace("+asyncpg", "")
    return (
        f"postgresql://{settings.POSTGRES_USER}:{settings.POSTGRES_PASSWORD}"
        f"@postgres:5432/{settings.POSTGRES_DB}"
    )


SYNC_DSN = _build_sync_dsn()

# Monkey-patch: ensure PsycopgConnector passes conninfo correctly
_orig_open = procrastinate.PsycopgConnector.open_async

async def _patched_open(self, pool=None):
    if pool is None and not self._async_pool:
        import psycopg_pool
        pool = psycopg_pool.AsyncConnectionPool(
            conninfo=SYNC_DSN, min_size=2, max_size=10, open=False,
        )
        await pool.open()
    return await _orig_open(self, pool=pool)

procrastinate.PsycopgConnector.open_async = _patched_open

app = procrastinate.App(
    connector=procrastinate.PsycopgConnector(conninfo=SYNC_DSN),
    import_paths=["app.tasks"],
)

logger.info("Procrastinate app initialised (PsycopgConnector patched)")
