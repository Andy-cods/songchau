"""slowapi-based rate limiter for heavy Sourcing + BQMS endpoints.

Thang 2026-06-13 — protects expensive ops (quote-batch generation, push-to-sec
Samsung session-locked tasks) from accidental click-spam or runaway clients.

Key strategy:
  * If the request carries a valid `Authorization: Bearer <jwt>` header, use
    the JWT `sub` (user_id) as the limiter key — fairer across NAT/office IPs.
  * Else fall back to remote IP (slowapi.util.get_remote_address).

This complements (does NOT replace) the existing Redis-backed
`app.core.rate_limit.RateLimiter` dependency-style limiter, which is still used
for auth endpoints. slowapi gives us terse `@limiter.limit("10/minute")`
decorators on FastAPI route functions — cleaner per-endpoint config.

Storage: in-memory (slowapi default). At our scale (single sc-api container)
this is sufficient. If we scale-out, swap to redis storage via
`Limiter(storage_uri="redis://...")`.
"""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import Request
from fastapi.responses import JSONResponse
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from app.core.security import decode_token

logger = logging.getLogger(__name__)


def _identify(request: Request) -> str:
    """Return a stable identity for rate-limit bucketing.

    Prefers JWT `sub` (user_id) from the Authorization header, falls back to
    the remote IP. JWT decode failures are swallowed silently (key falls back
    to IP) — the auth dependency will reject the request anyway.
    """
    auth = request.headers.get("Authorization") or request.headers.get("authorization")
    if auth and auth.lower().startswith("bearer "):
        raw = auth.split(" ", 1)[1].strip()
        try:
            payload = decode_token(raw)
            sub = payload.get("sub")
            if sub:
                return f"user:{sub}"
        except Exception:
            pass
    return f"ip:{get_remote_address(request)}"


# Default limit is intentionally generous — heavy endpoints opt-in with their
# own @limiter.limit("N/minute") decorator. Non-decorated endpoints get the
# default safety net.
limiter = Limiter(
    key_func=_identify,
    default_limits=["200/minute"],
    headers_enabled=True,
)


def rate_limit_exceeded_handler(request: Request, exc: RateLimitExceeded) -> JSONResponse:
    """Friendly 429 response in Vietnamese — frontend toasts the `detail` field."""
    logger.warning(
        "Rate limit exceeded: key=%s path=%s limit=%s",
        _identify(request),
        request.url.path,
        getattr(exc, "detail", None) or "?",
    )
    return JSONResponse(
        status_code=429,
        content={
            "detail": "Quá nhiều yêu cầu — vui lòng đợi 1 phút rồi thử lại.",
            "error": "RATE_LIMIT_EXCEEDED",
            "limit": str(getattr(exc, "detail", "")),
        },
        headers={"Retry-After": "60"},
    )
