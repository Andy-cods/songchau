"""
Security middleware and utilities for Song Chau ERP.

Provides:
  - Input sanitization (XSS prevention)
  - SQL injection protection for dynamic sort columns
  - Content-Type validation middleware
  - Request size limiting
"""

from __future__ import annotations

import re
import html
import logging
from typing import Sequence

from fastapi import Request, HTTPException, status
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# XSS Sanitization
# ---------------------------------------------------------------------------

# Tags and patterns commonly used in XSS attacks
_DANGEROUS_PATTERNS = [
    re.compile(r"<script\b[^>]*>.*?</script>", re.IGNORECASE | re.DOTALL),
    re.compile(r"javascript\s*:", re.IGNORECASE),
    re.compile(r"on\w+\s*=", re.IGNORECASE),  # onclick=, onerror=, etc.
    re.compile(r"<iframe\b", re.IGNORECASE),
    re.compile(r"<object\b", re.IGNORECASE),
    re.compile(r"<embed\b", re.IGNORECASE),
    re.compile(r"<form\b", re.IGNORECASE),
    re.compile(r"expression\s*\(", re.IGNORECASE),
    re.compile(r"url\s*\(\s*['\"]?\s*data:", re.IGNORECASE),
]


def sanitize_input(value: str) -> str:
    """Strip dangerous HTML/JS from user input.

    Applies two-pass sanitization:
    1. Remove known dangerous patterns (script tags, event handlers)
    2. HTML-escape remaining angle brackets

    Args:
        value: Raw user input string.

    Returns:
        Sanitized string safe for storage and rendering.
    """
    if not value:
        return value

    result = value
    for pattern in _DANGEROUS_PATTERNS:
        result = pattern.sub("", result)

    # Escape remaining HTML entities
    result = html.escape(result, quote=True)
    return result.strip()


def sanitize_dict(data: dict) -> dict:
    """Recursively sanitize all string values in a dictionary."""
    sanitized = {}
    for key, value in data.items():
        if isinstance(value, str):
            sanitized[key] = sanitize_input(value)
        elif isinstance(value, dict):
            sanitized[key] = sanitize_dict(value)
        elif isinstance(value, list):
            sanitized[key] = [
                sanitize_input(v) if isinstance(v, str)
                else sanitize_dict(v) if isinstance(v, dict)
                else v
                for v in value
            ]
        else:
            sanitized[key] = value
    return sanitized


# ---------------------------------------------------------------------------
# SQL Injection Protection — Sort Column Validation
# ---------------------------------------------------------------------------

# Only alphanumeric, underscores, and dots (for table.column) allowed
_SAFE_COLUMN_RE = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_.]*$")


def validate_sort_column(column: str, allowed: Sequence[str]) -> str:
    """Validate a sort column against a whitelist.

    Args:
        column: User-provided column name.
        allowed: List of allowed column names.

    Returns:
        The validated column name.

    Raises:
        HTTPException(400) if column is not in the allowed list.
    """
    if not column:
        return allowed[0] if allowed else "created_at"

    # Basic pattern check
    if not _SAFE_COLUMN_RE.match(column):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "error": "INVALID_SORT_COLUMN",
                "message": f"Tên cột sắp xếp không hợp lệ: '{column}'",
            },
        )

    # Whitelist check
    if column not in allowed:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "error": "INVALID_SORT_COLUMN",
                "message": f"Không được phép sắp xếp theo cột '{column}'",
                "allowed": list(allowed),
            },
        )

    return column


def validate_sort_direction(direction: str) -> str:
    """Validate sort direction to prevent injection."""
    direction = direction.strip().upper()
    if direction not in ("ASC", "DESC"):
        return "DESC"
    return direction


# ---------------------------------------------------------------------------
# Content-Type Validation Middleware
# ---------------------------------------------------------------------------

class ContentTypeValidationMiddleware(BaseHTTPMiddleware):
    """Reject requests with wrong Content-Type for JSON endpoints.

    - POST/PUT/PATCH requests must have Content-Type: application/json
      (except multipart/form-data for file uploads)
    - Blocks requests with suspicious content types
    """

    EXEMPT_PATHS = {"/api/docs", "/api/openapi.json", "/api/health"}
    EXEMPT_PREFIXES = ("/ws/",)
    METHODS_REQUIRING_CONTENT_TYPE = {"POST", "PUT", "PATCH"}

    async def dispatch(self, request: Request, call_next):
        # Skip exempt paths
        path = request.url.path
        if path in self.EXEMPT_PATHS or any(path.startswith(p) for p in self.EXEMPT_PREFIXES):
            return await call_next(request)

        # Validate Content-Type for methods with body
        if request.method in self.METHODS_REQUIRING_CONTENT_TYPE:
            content_type = request.headers.get("content-type", "")

            # Allow JSON and multipart (file uploads)
            if content_type:
                allowed = (
                    content_type.startswith("application/json")
                    or content_type.startswith("multipart/form-data")
                    or content_type.startswith("application/x-www-form-urlencoded")
                )
                if not allowed:
                    logger.warning(
                        "Rejected request with Content-Type: %s from %s",
                        content_type,
                        request.client.host if request.client else "unknown",
                    )
                    return JSONResponse(
                        status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                        content={
                            "error": "UNSUPPORTED_MEDIA_TYPE",
                            "message": "Content-Type phải là application/json hoặc multipart/form-data",
                        },
                    )

        return await call_next(request)


# ---------------------------------------------------------------------------
# Request Size Limiting Middleware
# ---------------------------------------------------------------------------

class RequestSizeLimitMiddleware(BaseHTTPMiddleware):
    """Reject requests exceeding a size limit (defense in depth).

    Default: 50 MB (matches MAX_UPLOAD_SIZE_MB in config).
    """

    def __init__(self, app, max_size_mb: int = 50):
        super().__init__(app)
        self.max_size_bytes = max_size_mb * 1024 * 1024

    async def dispatch(self, request: Request, call_next):
        content_length = request.headers.get("content-length")
        if content_length and int(content_length) > self.max_size_bytes:
            return JSONResponse(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                content={
                    "error": "REQUEST_TOO_LARGE",
                    "message": f"Kích thước yêu cầu vượt quá giới hạn ({self.max_size_bytes // (1024*1024)} MB)",
                },
            )
        return await call_next(request)


# ---------------------------------------------------------------------------
# IP-based blocking (optional, for brute-force protection)
# ---------------------------------------------------------------------------

_BLOCKED_IPS: set[str] = set()


def block_ip(ip: str) -> None:
    """Add an IP to the in-memory blocklist."""
    _BLOCKED_IPS.add(ip)
    logger.warning("Blocked IP: %s", ip)


def unblock_ip(ip: str) -> None:
    """Remove an IP from the blocklist."""
    _BLOCKED_IPS.discard(ip)


class IPBlockMiddleware(BaseHTTPMiddleware):
    """Block requests from IPs in the blocklist."""

    async def dispatch(self, request: Request, call_next):
        client_ip = request.client.host if request.client else None
        if client_ip and client_ip in _BLOCKED_IPS:
            logger.warning("Request blocked from IP: %s", client_ip)
            return JSONResponse(
                status_code=status.HTTP_403_FORBIDDEN,
                content={"error": "FORBIDDEN", "message": "Access denied"},
            )
        return await call_next(request)
