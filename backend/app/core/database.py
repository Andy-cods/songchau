import os
import asyncpg
from app.core.config import settings


class DatabasePool:
    def __init__(self):
        self._pool: asyncpg.Pool | None = None

    async def init(self):
        # Host/port CẤU HÌNH ĐƯỢC qua env (W2-05): server ERP chính để trống →
        # mặc định 'postgres:5432' (tên service compose, như cũ). Server cổng NCC
        # (45.124.95.32) đặt POSTGRES_HOST=172.17.0.1 POSTGRES_PORT=15432 để nối
        # Postgres server cũ QUA TUNNEL (dùng IP trực tiếp vì uvloop KHÔNG đọc
        # /etc/hosts → không resolve được hostname từ extra_hosts).
        host = os.getenv("POSTGRES_HOST", "postgres")
        port = os.getenv("POSTGRES_PORT", "5432")
        dsn = (
            f"postgresql://{settings.POSTGRES_USER}:{settings.POSTGRES_PASSWORD}"
            f"@{host}:{port}/{settings.POSTGRES_DB}"
        )
        self._pool = await asyncpg.create_pool(
            dsn=dsn,
            min_size=settings.DB_POOL_MIN,
            max_size=settings.DB_POOL_MAX,
        )

    async def close(self):
        if self._pool:
            await self._pool.close()

    def pool(self) -> asyncpg.Pool:
        return self._pool


db_pool = DatabasePool()


async def get_db() -> asyncpg.Connection:
    """FastAPI dependency that yields a database connection."""
    async with db_pool.pool().acquire() as conn:
        yield conn
