"""BQMS credential resolver — runtime, cross-process Samsung password override.

Problem
-------
Samsung BQMS password lives in the env (settings.BQMS_USERNAME / BQMS_PASSWORD)
baked into the container image at deploy time. When Samsung forces a password
change, the owner had to edit .env + restart all 3 containers (sc-api,
sc-worker, sc-scheduler). That is slow and error-prone.

Solution
--------
This module resolves the Samsung credentials at RUNTIME from `app_config`
(keys 'bqms_username' / 'bqms_password' — the override) with a SHORT in-process
cache (~30s TTL). The override is stored in Postgres, so:

    sc-api  writes it  (PUT /bqms/scraper-settings/credentials)
    sc-worker / sc-scheduler  read it  (next login picks up the new password
                                        within the cache TTL, NO restart needed)

When the override row is absent or empty, we FALL BACK to settings.BQMS_*,
so existing deployments keep working with zero regression.

Security
--------
The password is NEVER logged. Only the username + a `source` label + a boolean
`password_set` ever appear in logs / API responses.

Sync, not async
---------------
`get_bqms_credentials()` is a plain SYNC function (psycopg2, reusing the
SYNC_DSN pattern from app/tasks/fx_rates_sync.py) because most scraper login
sites run inside Playwright/worker code that is awaited but calls this at the
top synchronously, and the cache makes the DB hit rare anyway.
"""
from __future__ import annotations

import logging
import threading
import time
from typing import Optional, Tuple

import psycopg2

from app.core.config import settings
from app.core.procrastinate_app import SYNC_DSN

logger = logging.getLogger(__name__)

# Cache TTL — short so a password change propagates across processes quickly
# without a restart, but long enough to avoid a DB round-trip on every login.
_CACHE_TTL_SECONDS = 30.0
# When the DB read FAILED (not "override absent"), cache the env fallback only
# briefly so a transient blip right after a password change can't shadow the new
# override for a full TTL.
_DB_ERROR_TTL_SECONDS = 2.0

# app_config keys holding the runtime override.
_KEY_USERNAME = "bqms_username"
_KEY_PASSWORD = "bqms_password"

# In-process cache (per worker/api process). Guarded by a lock because scrapers
# may resolve concurrently from multiple greenlets/threads.
_cache_lock = threading.Lock()
_cache_value: Optional[Tuple[str, str, str]] = None  # (username, password, source)
_cache_expires_at: float = 0.0


def _read_override_from_db() -> tuple[Optional[str], Optional[str], bool]:
    """Read the bqms_username / bqms_password override from app_config.

    `value` is JSONB. A plain string stored as JSON comes back from psycopg2 as
    a Python str already (psycopg2 does not auto-decode JSONB, so the raw text
    is a JSON literal like '"secret"'). We select `value #>> '{}'` which casts
    a JSONB scalar to its text form WITHOUT the surrounding quotes, handling
    both string and (defensively) other scalar encodings uniformly.

    Returns (username_or_None, password_or_None, db_ok). On any DB error db_ok
    is False (None,None) so we fall back to env (fail-open, never crash a scrape
    over a config read) — the caller caches that fallback only briefly.
    """
    try:
        conn = psycopg2.connect(SYNC_DSN)
    except Exception as exc:  # noqa: BLE001
        logger.warning("bqms_credentials: DB connect failed, using env fallback: %s", exc)
        return None, None, False
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT key, value #>> '{}' FROM app_config WHERE key IN (%s, %s)",
                (_KEY_USERNAME, _KEY_PASSWORD),
            )
            rows = cur.fetchall()
    except Exception as exc:  # noqa: BLE001
        logger.warning("bqms_credentials: app_config read failed, using env fallback: %s", exc)
        return None, None, False
    finally:
        conn.close()

    username: Optional[str] = None
    password: Optional[str] = None
    for key, val in rows:
        if key == _KEY_USERNAME:
            username = val
        elif key == _KEY_PASSWORD:
            password = val
    return username, password, True


def _resolve(force: bool = False) -> Tuple[str, str, str]:
    """Resolve (username, password, source) with caching.

    source is 'db' when the override supplied the value, else 'env'.
    The username and password are resolved INDEPENDENTLY — e.g. username may
    come from env while password comes from the DB override.
    """
    global _cache_value, _cache_expires_at

    now = time.monotonic()
    if not force:
        with _cache_lock:
            if _cache_value is not None and now < _cache_expires_at:
                return _cache_value

    db_user, db_pwd, db_ok = _read_override_from_db()

    # Treat empty/whitespace override as "absent" → fall back to env.
    ov_user = db_user.strip() if isinstance(db_user, str) else None
    ov_pwd = db_pwd if isinstance(db_pwd, str) and db_pwd.strip() else None

    username = ov_user or (settings.BQMS_USERNAME or "")
    password = ov_pwd if ov_pwd is not None else (settings.BQMS_PASSWORD or "")

    # `source` describes where the PASSWORD came from (that's the secret that
    # matters for the runtime-override story shown in the admin UI).
    source = "db" if ov_pwd is not None else "env"

    resolved = (username, password, source)
    # Full TTL when the DB read succeeded; only a brief TTL when it FAILED, so a
    # transient DB error can't pin the env fallback over a fresh override.
    ttl = _CACHE_TTL_SECONDS if db_ok else _DB_ERROR_TTL_SECONDS
    with _cache_lock:
        _cache_value = resolved
        _cache_expires_at = time.monotonic() + ttl

    # NEVER log the password. Log only non-secret metadata.
    logger.debug(
        "bqms_credentials resolved: user=%s source=%s password_set=%s",
        username or "<empty>", source, bool(password),
    )
    return resolved


def get_bqms_credentials() -> Tuple[str, str]:
    """Return (username, password) for Samsung BQMS login.

    Reads the runtime override from app_config (cached ~30s) and falls back to
    settings.BQMS_USERNAME / settings.BQMS_PASSWORD when absent/empty.

    This is the single source every scraper login site should use instead of
    reading settings.BQMS_* directly, so a runtime password change (via
    PUT /bqms/scraper-settings/credentials) takes effect cross-process without
    a container restart.
    """
    username, password, _source = _resolve()
    return username, password


def get_bqms_credentials_meta() -> dict:
    """Return non-secret metadata about the resolved credentials.

    Used by GET /bqms/scraper-settings — NEVER includes the password value.
    """
    username, password, source = _resolve()
    return {
        "username": username or None,
        "password_set": bool(password),
        "source": source,  # 'db' if override password present, else 'env'
    }


def bust_bqms_credentials_cache() -> None:
    """Invalidate the in-process cache so the next resolve re-reads app_config.

    Call this after writing a new override (within the SAME process, e.g. the
    test-login endpoint that just saved the password) so the change is visible
    immediately rather than after the TTL. Other processes pick up the change
    on their own next cache expiry.
    """
    global _cache_value, _cache_expires_at
    with _cache_lock:
        _cache_value = None
        _cache_expires_at = 0.0
    logger.debug("bqms_credentials cache busted")
