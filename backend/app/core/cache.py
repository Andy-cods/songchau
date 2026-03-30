"""
Redis caching layer for Song Chau ERP.

Provides:
  - RedisCache class with get/set/invalidate operations
  - @cached decorator for transparent function-level caching
  - Per-data-type TTL configuration

Usage:
    from app.core.cache import cache, cached

    # Direct usage
    await cache.set("mykey", {"data": 1}, ttl=300)
    val = await cache.get("mykey")

    # Decorator usage
    @cached(ttl_key="suppliers_list", prefix="suppliers")
    async def get_all_suppliers(status: str = "active"):
        ...
"""

from __future__ import annotations

import json
import hashlib
import logging
from functools import wraps
from typing import Any

import redis.asyncio as redis

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# TTL per data type (seconds)
# ---------------------------------------------------------------------------
CACHE_TTL: dict[str, int] = {
    "suppliers_list": 1800,       # 30 min
    "inventory_list": 300,        # 5 min
    "dashboard_kpi": 900,         # 15 min
    "bqms_kpi": 300,              # 5 min
    "user_profile": 3600,         # 1 hour
    "exchange_rates": 86400,      # 24 hours
    "reports": 600,               # 10 min
    "purchase_orders_list": 300,  # 5 min
    "sales_orders_list": 300,     # 5 min
    "notifications_list": 120,    # 2 min
    "workflow_list": 180,         # 3 min
}


class RedisCache:
    """Async Redis cache wrapper with JSON serialization."""

    def __init__(self) -> None:
        self._redis: redis.Redis | None = None

    # -- lifecycle -----------------------------------------------------------

    async def init(self, url: str) -> None:
        """Create the Redis connection pool."""
        self._redis = redis.from_url(
            url,
            decode_responses=True,
            socket_connect_timeout=5,
            socket_timeout=5,
            retry_on_timeout=True,
        )
        # Verify connectivity
        try:
            await self._redis.ping()
            logger.info("Redis cache connected: %s", url)
        except Exception as exc:
            logger.warning("Redis cache connection failed (non-fatal): %s", exc)

    async def close(self) -> None:
        """Gracefully close the Redis connection pool."""
        if self._redis:
            await self._redis.close()
            logger.info("Redis cache closed")

    @property
    def connected(self) -> bool:
        return self._redis is not None

    # -- basic operations ----------------------------------------------------

    async def get(self, key: str) -> Any | None:
        """Retrieve a cached value, returns None on miss or error."""
        if not self._redis:
            return None
        try:
            val = await self._redis.get(key)
            if val is not None:
                return json.loads(val)
        except Exception as exc:
            logger.warning("Cache GET error for key=%s: %s", key, exc)
        return None

    async def set(self, key: str, value: Any, ttl: int = 300) -> None:
        """Store a value with expiration. Silently fails on error."""
        if not self._redis:
            return
        try:
            serialized = json.dumps(value, default=str, ensure_ascii=False)
            await self._redis.setex(key, ttl, serialized)
        except Exception as exc:
            logger.warning("Cache SET error for key=%s: %s", key, exc)

    async def delete(self, key: str) -> None:
        """Delete a single key."""
        if not self._redis:
            return
        try:
            await self._redis.delete(key)
        except Exception as exc:
            logger.warning("Cache DELETE error for key=%s: %s", key, exc)

    async def delete_pattern(self, pattern: str) -> int:
        """Delete all keys matching a glob pattern. Returns count deleted."""
        if not self._redis:
            return 0
        count = 0
        try:
            async for key in self._redis.scan_iter(match=pattern, count=200):
                await self._redis.delete(key)
                count += 1
        except Exception as exc:
            logger.warning("Cache DELETE_PATTERN error for pattern=%s: %s", pattern, exc)
        return count

    async def invalidate(self, *prefixes: str) -> int:
        """Invalidate cache for one or more entity prefixes.

        Example:
            await cache.invalidate("suppliers", "dashboard")
        """
        total = 0
        for prefix in prefixes:
            total += await self.delete_pattern(f"cache:{prefix}:*")
        if total:
            logger.info("Invalidated %d cache keys for prefixes: %s", total, prefixes)
        return total

    async def ping(self) -> bool:
        """Health check — returns True if Redis responds to PING."""
        if not self._redis:
            return False
        try:
            return await self._redis.ping()
        except Exception:
            return False

    async def info(self) -> dict[str, Any]:
        """Return basic Redis server info for monitoring.

        Returns a dict with at minimum:
          - used_memory: bytes (int)
          - used_memory_human: human-readable string
          - connected_clients: int
        """
        if not self._redis:
            return {}
        try:
            # Fetch both memory and clients sections
            mem = await self._redis.info(section="memory")
            clients = await self._redis.info(section="clients")
            return {
                "used_memory": mem.get("used_memory", 0),
                "used_memory_human": mem.get("used_memory_human", "N/A"),
                "connected_clients": clients.get("connected_clients", mem.get("connected_clients", "N/A")),
            }
        except Exception:
            return {}


# ---------------------------------------------------------------------------
# Singleton
# ---------------------------------------------------------------------------
cache = RedisCache()


# ---------------------------------------------------------------------------
# Decorator
# ---------------------------------------------------------------------------

def _build_cache_key(prefix: str, args: tuple, kwargs: dict) -> str:
    """Build a deterministic cache key from function arguments."""
    key_parts = [prefix]
    # Include positional args, skip objects (like db connections, request)
    for a in args:
        if isinstance(a, (str, int, float, bool)):
            key_parts.append(str(a))
        elif isinstance(a, (list, tuple)):
            key_parts.append(hashlib.md5(json.dumps(a, default=str).encode()).hexdigest()[:8])
    # Include keyword args (sorted for determinism)
    for k, v in sorted(kwargs.items()):
        if isinstance(v, (str, int, float, bool, type(None))):
            key_parts.append(f"{k}={v}")
        elif isinstance(v, (list, tuple, dict)):
            h = hashlib.md5(json.dumps(v, default=str).encode()).hexdigest()[:8]
            key_parts.append(f"{k}={h}")
    return f"cache:{':'.join(key_parts)}"


def cached(ttl_key: str, prefix: str | None = None):
    """Decorator for caching async function results.

    Args:
        ttl_key: Key into CACHE_TTL dict for the expiration time.
        prefix: Cache key prefix. Defaults to function name.

    Example:
        @cached(ttl_key="suppliers_list", prefix="suppliers")
        async def list_suppliers(conn, *, status="active", limit=50):
            ...
    """

    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            pfx = prefix or func.__name__
            cache_key = _build_cache_key(pfx, args, kwargs)

            # Try cache first
            result = await cache.get(cache_key)
            if result is not None:
                return result

            # Cache miss — compute the real result
            result = await func(*args, **kwargs)

            # Store in cache (never cache None)
            if result is not None:
                ttl = CACHE_TTL.get(ttl_key, 300)
                await cache.set(cache_key, result, ttl)

            return result

        # Expose invalidation helper on the wrapper
        wrapper.cache_prefix = prefix or func.__name__  # type: ignore[attr-defined]
        return wrapper

    return decorator
