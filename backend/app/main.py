from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import time
import uuid
import logging

from app.core.config import settings
from app.core.database import db_pool
from app.core.cache import cache
from app.core.procrastinate_app import app as procrastinate_app
from app.core.slowapi_limiter import limiter, rate_limit_exceeded_handler
from app.core.logging_config import setup_logging, request_context
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from app.api.health import router as health_router
from app.api.v1 import v1_router
from app.websocket import sio_app  # Socket.IO ASGI app

# Install structured JSON logging BEFORE any logger is used so first-line logs
# during module import are JSON-formatted too. setup_logging() is idempotent.
setup_logging(service="sc-api")
logger = logging.getLogger(__name__)

# Track startup time for uptime calculation
_startup_time: float | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _startup_time
    # Startup
    await db_pool.init()
    logger.info("Database pool initialized")
    await cache.init(settings.REDIS_URL)
    logger.info("Redis cache initialized")
    # Open Procrastinate app so handlers can call defer_async() directly
    # without per-call `async with proc_app.open_async():` wraps. The worker
    # process opens its own pool via run_worker.py; this is FastAPI-side only.
    await procrastinate_app.open_async()
    logger.info("Procrastinate app opened (FastAPI)")
    _startup_time = time.monotonic()
    yield
    # Shutdown
    try:
        await procrastinate_app.close_async()
        logger.info("Procrastinate app closed")
    except Exception:
        logger.exception("Error closing Procrastinate app")
    await cache.close()
    logger.info("Redis cache closed")
    await db_pool.close()
    logger.info("Database pool closed")


app = FastAPI(
    title="Song Châu ERP API",
    version="1.0.0",
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
    lifespan=lifespan,
)

# Rate limiting — slowapi (Thang 2026-06-13). Per-user (JWT sub) when
# Authorization header is present, else per remote IP. Heavy Sourcing + BQMS
# endpoints decorated explicitly with @limiter.limit("…/minute") inline. Default
# is permissive (200/min) so it does not affect non-decorated endpoints.
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

# Security middleware (order matters — outermost first)
from app.core.security_middleware import (
    ContentTypeValidationMiddleware,
    RequestSizeLimitMiddleware,
    IPBlockMiddleware,
)

app.add_middleware(IPBlockMiddleware)
app.add_middleware(RequestSizeLimitMiddleware, max_size_mb=settings.MAX_UPLOAD_SIZE_MB)
app.add_middleware(ContentTypeValidationMiddleware)

# CORS — restrict origins in production
_cors_origins = ["*"] if settings.APP_ENV == "development" else [
    settings.APP_URL,
] if settings.APP_URL else ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
)


@app.middleware("http")
async def request_tracing(request: Request, call_next):
    request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
    request.state.request_id = request_id

    route = f"{request.method} {request.url.path}"
    # User id may be attached later by auth deps; surface whatever is there.
    user_id = getattr(request.state, "user_id", None)

    start = time.monotonic()
    with request_context(request_id=request_id, user_id=user_id, route=route):
        response = await call_next(request)
        duration_ms = (time.monotonic() - start) * 1000

        response.headers["X-Request-ID"] = request_id

        # Structured per-request log line — picked up automatically by JSON
        # formatter; latency_ms appears as a top-level field.
        log_extra = {
            "latency_ms": round(duration_ms, 2),
            "status_code": response.status_code,
        }
        if duration_ms > 1000:
            logger.warning("request_complete_slow", extra=log_extra)
        else:
            logger.info("request_complete", extra=log_extra)

    return response


# ─────────────────── Prometheus /metrics endpoint ───────────────────
# prometheus-fastapi-instrumentator auto-collects HTTP request histograms
# (latency, status code, method, handler) and exposes them at /metrics in
# Prometheus exposition format. Custom Sourcing metrics live in
# app/services/sourcing_pricing_engine.py and register against the same
# default REGISTRY, so they appear in the same scrape.
try:
    from prometheus_fastapi_instrumentator import Instrumentator

    Instrumentator(
        should_group_status_codes=False,
        should_ignore_untemplated=True,
        should_respect_env_var=False,
        excluded_handlers=["/metrics", "/api/docs", "/api/openapi.json"],
    ).instrument(app).expose(
        app,
        endpoint="/metrics",
        include_in_schema=False,
        tags=["observability"],
    )
    logger.info("Prometheus /metrics endpoint registered")

    # Eagerly import sourcing_pricing_engine so its Histogram/Counter metrics
    # (calc_suggest_latency_seconds, fx_cache_hit_total, rule_fallback_total)
    # register with the default REGISTRY at startup — otherwise they only appear
    # in /metrics output AFTER the first sourcing API call (lazy import inside
    # handlers). This ensures Prometheus / dashboards see HELP+TYPE lines from
    # the very first scrape. Thang 2026-06-14.
    try:
        # NB: use importlib.import_module — `import app.services.X` would rebind
        # the local name `app` to the package, shadowing our FastAPI `app` and
        # breaking later `@app.middleware(...)` decorators.
        import importlib as _importlib
        _importlib.import_module("app.services.sourcing_pricing_engine")
        logger.info("Sourcing pricing engine pre-loaded for Prometheus registry")
    except Exception:  # noqa: BLE001
        logger.exception("Failed to pre-load sourcing_pricing_engine; custom metrics may be missing until first call")
except Exception:  # noqa: BLE001
    # Instrumentator is optional at runtime — if the package isn't installed
    # yet (fresh dev env before `pip install -r requirements.txt`), API still
    # boots; observability is degraded but no crash.
    logger.exception("prometheus-fastapi-instrumentator not available; /metrics disabled")


# BQMS user-edit guard (Thang 2026-05-15) — when `bqms_user_edit_disabled` is
# true in app_config, BLOCK all mutating BQMS endpoints. Read-only (GET) and
# scrape/push/admin operations remain enabled.
_BQMS_EDIT_DISABLED_PATHS_ALLOW = (
    # Push pipeline + scrape triggers + admin/read paths under /api/v1/bqms/
    "/api/v1/bqms/scrape-",
    "/api/v1/bqms/data-gaps/",
    "/api/v1/bqms/sync",
    "/api/v1/bqms/admin/",
    "/api/v1/bqms/rfq/parse",
    "/api/v1/bqms/rfq/generate",
    "/api/v1/bqms/rfq/submit",
    "/api/v1/bqms/quote-file/regen-pdf",
    "/api/v1/bqms/scrape-control/toggle",
    "/api/v1/bqms/bidding/",
    "/api/v1/bqms/contracts/merge",
)
_BQMS_EDIT_DISABLED_PATH_SUFFIXES = (
    "/push-to-sec",
    "/push-preview/upload-image",
)


# 60-second in-memory cache so middleware doesn't hit DB on every request.
_BQMS_FLAG_CACHE: dict = {"value": False, "expires_at": 0.0}


async def _bqms_user_edit_disabled_flag() -> bool:
    """Check app_config.bqms_user_edit_disabled with 60s TTL cache.

    Returns False if any error (fail-open — don't accidentally block prod
    if app_config table is unreachable).
    """
    import time
    now = time.time()
    if _BQMS_FLAG_CACHE["expires_at"] > now:
        return bool(_BQMS_FLAG_CACHE["value"])
    val = None
    try:
        import asyncpg
        from app.core.config import settings as _s
        dsn = str(_s.DATABASE_URL).replace("+asyncpg", "").replace(
            "postgresql+asyncpg", "postgresql"
        )
        c = await asyncpg.connect(dsn)
        try:
            val = await c.fetchval(
                "SELECT value FROM app_config WHERE key='bqms_user_edit_disabled'"
            )
        finally:
            await c.close()
    except Exception:
        _BQMS_FLAG_CACHE["value"] = False
        _BQMS_FLAG_CACHE["expires_at"] = now + 60
        return False
    disabled = False
    if isinstance(val, bool):
        disabled = val
    elif isinstance(val, str):
        disabled = val.strip().strip('"').lower() in ("true", "1", "yes")
    _BQMS_FLAG_CACHE["value"] = disabled
    _BQMS_FLAG_CACHE["expires_at"] = now + 60
    return disabled


@app.middleware("http")
async def bqms_user_edit_guard(request: Request, call_next):
    path = request.url.path
    if (
        request.method in ("POST", "PATCH", "PUT", "DELETE")
        and path.startswith("/api/v1/bqms/")
        and not any(path.startswith(p) for p in _BQMS_EDIT_DISABLED_PATHS_ALLOW)
        and not any(path.endswith(s) for s in _BQMS_EDIT_DISABLED_PATH_SUFFIXES)
    ):
        if await _bqms_user_edit_disabled_flag():
            from fastapi.responses import JSONResponse
            return JSONResponse(
                status_code=403,
                content={
                    "detail": (
                        "BQMS user editing is currently disabled. Data sourced "
                        "from Samsung scrape only. To re-enable: UPDATE app_config "
                        "SET value='false' WHERE key='bqms_user_edit_disabled'."
                    )
                },
            )
    return await call_next(request)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "SAMEORIGIN"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    # Cache-Control (W2-11, Thang 2026-07-03): mặc định KHÔNG cache gì hết —
    # toàn bộ JSON/API response (dữ liệu nội bộ, giá, khách hàng...) luôn ép
    # no-store để không rò dữ liệu qua cache trình duyệt/proxy dùng chung máy.
    #
    # NGOẠI LỆ CHỌN LỌC: response ẢNH mà chính endpoint đã tự đặt Cache-Control
    # riêng (luôn SAU khi đã qua RBAC require_role) — middleware này KHÔNG ghi
    # đè nữa, để trình duyệt cache được (vd trang /bqms không phải tải lại
    # toàn bộ ảnh mỗi lần vào). Nhận diện bằng 1 trong 2 cách:
    #   (a) sentinel header `X-SC-Image-Cache: 1` — dùng bởi endpoint có
    #       ETag/304 (bqms_images.py _file_response_cached), vì response 304
    #       Not-Modified theo chuẩn HTTP KHÔNG có Content-Type nên dò
    #       content-type sẽ bỏ sót đúng cái response cần giữ cache nhất.
    #   (b) Content-Type: image/* + đã có sẵn Cache-Control — bắt luôn 2
    #       endpoint ảnh cũ hơn (bqms.py dossier-job/image, dossier-system-
    #       image) vốn đã đặt `private, max-age=...` từ lâu nhưng bị chính
    #       middleware này âm thầm ghi đè — không cần sửa lại từng chỗ.
    # Ảnh nào KHÔNG tự set Cache-Control thì vẫn bị ép no-store như cũ — an
    # toàn theo mặc định, endpoint phải chủ động "xin" cache thay vì bị cache
    # ngầm. Sentinel bị xoá khỏi response cuối cùng — không rò chi tiết nội
    # bộ ra client.
    is_image_sentinel = response.headers.get("x-sc-image-cache") == "1"
    if is_image_sentinel:
        del response.headers["x-sc-image-cache"]
    already_cacheable_image = is_image_sentinel or (
        response.headers.get("content-type", "").startswith("image/")
        and bool(response.headers.get("cache-control"))
    )
    if not already_cacheable_image:
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
        response.headers["Pragma"] = "no-cache"
    # Strict-Transport-Security for HTTPS environments
    if request.url.scheme == "https":
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response


# Routers
import os as _os
_SC_ROLE = _os.getenv("SC_ROLE", "").strip().lower()

app.include_router(health_router)

# W2-05: server cổng NCC riêng (45.124.95.32) chạy SC_ROLE=vendor → CHỈ mount
# vendor_router + health, KHÔNG mount /api/v1 (nội bộ ERP: giá, khách hàng, đấu
# thầu admin, BQMS...). Server ERP chính (SC_ROLE trống/khác) mount đầy đủ như cũ.
# → trên server vendor, mọi /api/v1/* trả 404 (cô lập dữ liệu nội bộ khỏi NCC).
if _SC_ROLE != "vendor":
    app.include_router(v1_router, prefix="/api/v1")

# Vendor Portal API (separate prefix — vendors cannot access /api/v1)
from app.api.vendor import vendor_router
app.include_router(vendor_router, prefix="/api/vendor")

# Public Bid Portal (magic-link) — XOÁ HẲN W2-10 (Thang 2026-07-03).
# Trước: NO-auth token-protected magic-link (2026-05-14) → UNMOUNTED 2026-06-18
# (thay bằng tài khoản đăng nhập NCC). Nay xoá file app/api/public_bid.py hẳn để
# giảm bề mặt tấn công. Bản sao lưu ở scratchpad/deleted_dead_code_20260703/ nếu
# cần khôi phục. Bảng procurement_bid_tokens GIỮ (chưa drop — cần Thang quyết).

# ---------------------------------------------------------------------------
# Socket.IO — must be mounted AFTER all HTTP routes so the ASGI app does not
# intercept regular HTTP requests.  The full endpoint becomes:
#   ws://<host>/ws/socket.io/?EIO=4&transport=websocket
# ---------------------------------------------------------------------------
app.mount("/ws", sio_app)
