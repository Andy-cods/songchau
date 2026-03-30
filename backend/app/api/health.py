from fastapi import APIRouter, Depends
import asyncpg

from app.core.database import get_db

router = APIRouter(tags=["health"])


@router.get("/api/health")
async def health_check(conn: asyncpg.Connection = Depends(get_db)):
    db_ok = False
    try:
        result = await conn.fetchval("SELECT 1")
        db_ok = result == 1
    except Exception:
        pass

    return {
        "status": "healthy" if db_ok else "degraded",
        "database": "ok" if db_ok else "error",
        "version": "1.0.0",
    }
