"""Structured JSON logging configuration for Song Châu ERP API.

Replaces ad-hoc `logger.info(...)` formatting with structured JSON records that
ship cleanly into Loki / ELK / CloudWatch without regex parsing.

Key fields injected on every record (when available):
- ``timestamp``    : ISO-8601 UTC
- ``level``        : log level name
- ``logger``       : module logger name
- ``message``      : log message
- ``request_id``   : correlation id (X-Request-ID header / generated UUID)
- ``user_id``      : authenticated user id from request.state
- ``route``        : ``METHOD path`` of the active request
- ``latency_ms``   : HTTP latency (only on request-completion log lines)
- ``item_type``    : Sourcing item_type when relevant
- ``currency``     : Sourcing currency when relevant

The correlation fields ``request_id``, ``user_id``, ``route`` are propagated via
``contextvars`` so ANY logger called inside a request handler picks them up —
no need to thread them manually through service functions.

Usage:
    from app.core.logging_config import setup_logging, request_context
    setup_logging()                                # main.py — once at startup
    with request_context(request_id=..., user_id=..., route=...):
        logger.info("processing", extra={"item_type": "default"})

Thang 2026-06-14.
"""
from __future__ import annotations

import json
import logging
import os
import sys
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import datetime, timezone
from typing import Any, Iterator

# ─────────────────────── context vars ───────────────────────
# Populated by the FastAPI request_tracing middleware (or any caller) so that
# downstream loggers automatically include these fields.

_request_id_ctx: ContextVar[str | None] = ContextVar("request_id", default=None)
_user_id_ctx: ContextVar[str | None] = ContextVar("user_id", default=None)
_route_ctx: ContextVar[str | None] = ContextVar("route", default=None)


def set_request_context(
    *,
    request_id: str | None = None,
    user_id: str | None = None,
    route: str | None = None,
) -> dict[str, object]:
    """Set context vars; returns reset tokens for later teardown."""
    tokens: dict[str, object] = {}
    if request_id is not None:
        tokens["request_id"] = _request_id_ctx.set(request_id)
    if user_id is not None:
        tokens["user_id"] = _user_id_ctx.set(user_id)
    if route is not None:
        tokens["route"] = _route_ctx.set(route)
    return tokens


def reset_request_context(tokens: dict[str, object]) -> None:
    for name, tok in tokens.items():
        ctx = {"request_id": _request_id_ctx, "user_id": _user_id_ctx, "route": _route_ctx}[name]
        try:
            ctx.reset(tok)  # type: ignore[arg-type]
        except Exception:
            pass


@contextmanager
def request_context(
    *,
    request_id: str | None = None,
    user_id: str | None = None,
    route: str | None = None,
) -> Iterator[None]:
    tokens = set_request_context(request_id=request_id, user_id=user_id, route=route)
    try:
        yield
    finally:
        reset_request_context(tokens)


# ─────────────────────── JSON formatter ───────────────────────

# Attributes already provided by LogRecord — we skip these when copying user
# `extra=` fields into the JSON payload (otherwise we'd duplicate everything).
_STD_LOGRECORD_ATTRS = {
    "name", "msg", "args", "levelname", "levelno", "pathname", "filename",
    "module", "exc_info", "exc_text", "stack_info", "lineno", "funcName",
    "created", "msecs", "relativeCreated", "thread", "threadName",
    "processName", "process", "message", "asctime", "taskName",
}


class JsonFormatter(logging.Formatter):
    """Minimal stdlib JSON formatter — no python-json-logger dependency.

    Emits one JSON object per record. Honors `extra=` keys, exceptions, and the
    request-scoped contextvars defined above.
    """

    def __init__(self, service: str = "sc-api") -> None:
        super().__init__()
        self._service = service

    def format(self, record: logging.LogRecord) -> str:  # noqa: D401
        payload: dict[str, Any] = {
            "timestamp": datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "service": self._service,
            "message": record.getMessage(),
        }

        # Inject request-scoped correlation fields if present.
        req_id = _request_id_ctx.get()
        if req_id:
            payload["request_id"] = req_id
        usr_id = _user_id_ctx.get()
        if usr_id:
            payload["user_id"] = usr_id
        route = _route_ctx.get()
        if route:
            payload["route"] = route

        # Copy any user-supplied extras (e.g. logger.info(..., extra={"latency_ms": 12}))
        for k, v in record.__dict__.items():
            if k in _STD_LOGRECORD_ATTRS or k.startswith("_"):
                continue
            if k in payload:
                continue
            try:
                json.dumps(v, default=str)
                payload[k] = v
            except Exception:
                payload[k] = str(v)

        if record.exc_info:
            payload["exc_info"] = self.formatException(record.exc_info)
        if record.stack_info:
            payload["stack_info"] = record.stack_info

        return json.dumps(payload, default=str, ensure_ascii=False)


# ─────────────────────── setup ───────────────────────

def setup_logging(level: str | int | None = None, *, service: str = "sc-api") -> None:
    """Install JsonFormatter on the root + uvicorn loggers.

    Call once at process start (FastAPI lifespan startup). Idempotent — repeated
    calls just replace existing handlers on the configured loggers.
    """
    lvl_raw = level or os.getenv("LOG_LEVEL", "INFO")
    if isinstance(lvl_raw, str):
        lvl = logging.getLevelName(lvl_raw.upper())
        if not isinstance(lvl, int):
            lvl = logging.INFO
    else:
        lvl = lvl_raw

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter(service=service))

    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(lvl)

    # Align uvicorn loggers so their access/error lines are also JSON.
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access", "fastapi"):
        lg = logging.getLogger(name)
        lg.handlers.clear()
        lg.addHandler(handler)
        lg.setLevel(lvl)
        lg.propagate = False
