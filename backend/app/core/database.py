import asyncpg
from app.core.config import settings


class DatabasePool:
    def __init__(self):
        self._pool: asyncpg.Pool | None = None

    async def init(self):
        dsn = (
            f"postgresql://{settings.POSTGRES_USER}:{settings.POSTGRES_PASSWORD}"
            f"@postgres:5432/{settings.POSTGRES_DB}"
        )
        self._pool = await asyncpg.create_pool(
            dsn=dsn,
            min_size=settings.DB_POOL_MIN,
            max_size=settings.DB_POOL_MAX,
        )

    async def close(self):
        if self._pool:
            await self._pool.close()

    async def get_connection(self) -> asyncpg.Connection:
        return await self._pool.acquire()

    def pool(self) -> asyncpg.Pool:
        return self._pool


db_pool = DatabasePool()


async def get_db() -> asyncpg.Connection:
    """FastAPI dependency that yields a database connection."""
    async with db_pool.pool().acquire() as conn:
        yield conn
