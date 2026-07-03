"""
Application-level rate limiting using Redis sliding window.

Acts as a backup layer behind Nginx rate limiting.

Usage as FastAPI dependency:
    from app.core.rate_limit import RateLimiter

    limiter = RateLimiter(limit=5, window=60)  # 5 requests per 60s

    @router.post("/login")
    async def login(request: Request, _=Depends(limiter)):
        ...
"""

import time
import logging
from typing import Any

# NOTE: KHÔNG dùng `from __future__ import annotations` ở file này. RateLimiter
# được dùng làm FastAPI Depends; PEP 563 string-annotations khiến FastAPI/pydantic
# không resolve được `request: Request` (forward-ref → "name 'Request' is not
# defined") khi build dependency từ module route KHÁC. Để annotation eager.
from fastapi import Request, HTTPException, status

from app.core.cache import cache

logger = logging.getLogger(__name__)


class RateLimiter:
    """Callable FastAPI dependency implementing sliding-window rate limiting.

    Uses Redis INCR + EXPIRE for an efficient counter-based approach.
    Gracefully degrades (allows request) if Redis is unavailable.
    """

    def __init__(
        self,
        limit: int = 30,
        window: int = 60,
        key_prefix: str = "rl",
    ) -> None:
        """
        Args:
            limit: Maximum number of requests allowed within the window.
            window: Time window in seconds.
            key_prefix: Redis key prefix for namespacing.
        """
        self.limit = limit
        self.window = window
        self.key_prefix = key_prefix

    def _get_client_key(self, request: Request) -> str:
        """Build a rate-limit key from client IP + endpoint path."""
        client_ip = request.client.host if request.client else "unknown"
        path = request.url.path
        return f"{self.key_prefix}:{client_ip}:{path}"

    async def check(self, key: str) -> tuple[bool, int, int]:
        """Check if the request is within rate limits.

        Returns:
            (allowed, current_count, remaining)
        """
        if not cache.connected or cache._redis is None:
            # Redis unavailable — fail open
            return True, 0, self.limit

        try:
            pipe = cache._redis.pipeline()
            pipe.incr(key)
            pipe.ttl(key)
            results = await pipe.execute()

            current_count: int = results[0]
            ttl: int = results[1]

            # First request in window — set expiry
            if ttl == -1:
                await cache._redis.expire(key, self.window)

            remaining = max(0, self.limit - current_count)
            allowed = current_count <= self.limit

            return allowed, current_count, remaining

        except Exception as exc:
            logger.warning("Rate limiter Redis error (failing open): %s", exc)
            return True, 0, self.limit

    async def __call__(self, request: Request) -> None:
        """FastAPI dependency interface."""
        key = self._get_client_key(request)
        allowed, current, remaining = await self.check(key)

        if not allowed:
            logger.warning(
                "Rate limit exceeded: %s (count=%d, limit=%d)",
                key, current, self.limit,
            )
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail={
                    "error": "RATE_LIMIT_EXCEEDED",
                    "message": "Quá nhiều yêu cầu. Vui lòng thử lại sau.",
                    "retry_after_seconds": self.window,
                },
                headers={"Retry-After": str(self.window)},
            )


# ---------------------------------------------------------------------------
# Pre-configured limiters for common use cases
# ---------------------------------------------------------------------------

# Auth endpoints: 5 attempts per 60 seconds
auth_rate_limit = RateLimiter(limit=5, window=60, key_prefix="rl:auth")

# General API: 120 requests per 60 seconds
api_rate_limit = RateLimiter(limit=120, window=60, key_prefix="rl:api")

# File uploads: 10 per minute
upload_rate_limit = RateLimiter(limit=10, window=60, key_prefix="rl:upload")

# Report generation: 5 per minute (expensive queries)
report_rate_limit = RateLimiter(limit=5, window=60, key_prefix="rl:report")
