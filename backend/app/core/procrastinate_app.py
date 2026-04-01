"""
Procrastinate application — task queue backed by PostgreSQL.
Compatible with procrastinate 2.14.0 + psycopg-pool 3.3.0.

Fix: psycopg-pool 3.3.0 sets pool.kwargs=None when only conninfo is passed.
Procrastinate does **pool.kwargs which crashes. We patch kwargs to {} after pool open.
"""

from __future__ import annotations

import logging

import procrastinate
import psycopg_pool

from app.core.config import settings

logger = logging.getLogger(__name__)


def _build_dsn() -> str:
    if settings.DATABASE_URL:
        return settings.DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://").replace("+asyncpg", "")
    return (
        f"postgresql://{settings.POSTGRES_USER}:{settings.POSTGRES_PASSWORD}"
        f"@postgres:5432/{settings.POSTGRES_DB}"
    )


SYNC_DSN = _build_dsn()

# Monkey-patch: after pool is created, ensure kwargs is {} not None
_orig_create_pool = procrastinate.PsycopgConnector._create_pool


async def _patched_create_pool(self, pool_args):
    pool = await _orig_create_pool(self, pool_args)
    # Fix: psycopg-pool 3.3.0 sets kwargs=None, but procrastinate does **pool.kwargs
    if pool.kwargs is None:
        pool.kwargs = {}
    return pool


procrastinate.PsycopgConnector._create_pool = _patched_create_pool

app = procrastinate.App(
    connector=procrastinate.PsycopgConnector(conninfo=SYNC_DSN),
    import_paths=["app.tasks"],
)

logger.info("Procrastinate initialised (pool.kwargs patched)")
