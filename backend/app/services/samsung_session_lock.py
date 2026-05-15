"""Samsung BQMS cross-queue session lock (Thang 2026-05-15).

Samsung allow only 1 active session per vendor account. Multiple Procrastinate
tasks (push + scrape + gap_healer) can all touch Samsung concurrently if we
don't serialize them — second login kicks out the first session.

This module provides a Postgres advisory lock that all Samsung-touching tasks
acquire before doing any Playwright work. Lock is RELEASED on context exit,
even on error (via try/finally), so a crashed worker doesn't deadlock the lock.

Usage:
    async with samsung_session_lock(pool, who="bqms_smart_rescan"):
        await scrape_bidding(...)

Cross-task ordering: First task that calls `pg_advisory_lock` blocks all others
until release. Order is roughly FIFO via Postgres lock queue.
"""
from __future__ import annotations

import asyncio
import logging
import time
from contextlib import asynccontextmanager

logger = logging.getLogger(__name__)

# All Samsung-touching tasks share this single lock key.
SAMSUNG_LOCK_KEY = "samsung_vendor_session"


@asynccontextmanager
async def samsung_session_lock(
    pool,
    who: str = "unknown",
    timeout_seconds: int = 900,
    poll_interval: float = 2.0,
):
    """Acquire exclusive Postgres advisory lock for Samsung operations.

    Args:
        pool: asyncpg connection pool — used for both the lock conn and
              keep-alive. Lock held on a dedicated connection from this pool.
        who: caller label for logging (e.g., "bqms_smart_rescan").
        timeout_seconds: max time to wait for the lock. If exceeded, raises
                         RuntimeError. Default 15 min (push usually takes ~2 min).
        poll_interval: how often to re-check the lock when waiting.

    Raises:
        RuntimeError: if lock can't be acquired within timeout.
    """
    conn = await pool.acquire()
    try:
        # Fast path — try non-blocking acquire first
        acquired = await conn.fetchval(
            "SELECT pg_try_advisory_lock(hashtext($1))", SAMSUNG_LOCK_KEY,
        )
        if acquired:
            logger.info("samsung_session_lock acquired by %s (fast path)", who)
        else:
            logger.info(
                "samsung_session_lock busy — %s waiting up to %ds (poll=%.1fs)",
                who, timeout_seconds, poll_interval,
            )
            start = time.monotonic()
            while time.monotonic() - start < timeout_seconds:
                await asyncio.sleep(poll_interval)
                acquired = await conn.fetchval(
                    "SELECT pg_try_advisory_lock(hashtext($1))", SAMSUNG_LOCK_KEY,
                )
                if acquired:
                    waited = time.monotonic() - start
                    logger.info(
                        "samsung_session_lock acquired by %s after %.1fs wait",
                        who, waited,
                    )
                    break
            if not acquired:
                raise RuntimeError(
                    f"samsung_session_lock acquire timeout: {who} "
                    f"waited {timeout_seconds}s — other Samsung task may be stuck"
                )

        try:
            yield
        finally:
            try:
                await conn.execute(
                    "SELECT pg_advisory_unlock(hashtext($1))", SAMSUNG_LOCK_KEY,
                )
                logger.info("samsung_session_lock released by %s", who)
            except Exception as exc:
                logger.warning(
                    "samsung_session_lock release failed for %s: %s — connection close will free it",
                    who, exc,
                )
    finally:
        await pool.release(conn)
