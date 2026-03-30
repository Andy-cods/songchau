from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
import time
import uuid
import logging

from app.core.config import settings
from app.core.database import db_pool
from app.api.health import router as health_router
from app.api.v1 import v1_router
from app.websocket import sio_app  # Socket.IO ASGI app

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await db_pool.init()
    logger.info("Database pool initialized")
    yield
    # Shutdown
    await db_pool.close()
    logger.info("Database pool closed")


app = FastAPI(
    title="Song Châu ERP API",
    version="1.0.0",
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def request_tracing(request: Request, call_next):
    request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
    request.state.request_id = request_id

    start = time.monotonic()
    response = await call_next(request)
    duration_ms = (time.monotonic() - start) * 1000

    response.headers["X-Request-ID"] = request_id

    if duration_ms > 1000:
        logger.warning(
            "Slow request: %s %s %.0fms",
            request.method, request.url.path, duration_ms
        )

    return response


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "SAMEORIGIN"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    return response


# Routers
app.include_router(health_router)
app.include_router(v1_router, prefix="/api/v1")

# ---------------------------------------------------------------------------
# Socket.IO — must be mounted AFTER all HTTP routes so the ASGI app does not
# intercept regular HTTP requests.  The full endpoint becomes:
#   ws://<host>/ws/socket.io/?EIO=4&transport=websocket
# ---------------------------------------------------------------------------
app.mount("/ws", sio_app)
