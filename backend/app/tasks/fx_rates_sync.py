"""
FX Rates Sync — daily auto-refresh of exchange_rates from a public API.

FIX B5 (Thang 2026-06-13)
─────────────────────────
DEFAULT_FX_TO_VND hardcode đã được gỡ khỏi sourcing_pricing_engine.py.
Tỷ giá nay đọc từ bảng `exchange_rates`. Task này keep rates fresh:

Schedule
--------
@app.periodic(cron="0 8 * * *")  # 08:00 UTC == 15:00 ICT

Behaviour
---------
- Fetch rates from open.er-api.com (free, no API key) cho các currency
  trong SUPPORTED = [USD, JPY, KRW, CNY, RMB, EUR] → VND.
  Response: { "result":"success", "base_code":"USD", "rates": { "VND": 24500.0 } }
  where rates.VND = VND per 1 unit of base — exactly the VND-per-unit the
  pricing engine multiplies by (compute_sale_vnd: I = cost*fx). Stored directly,
  NO inversion.
- UPSERT vào exchange_rates với source='auto-open.er-api.com'.
- Idempotent: same-day reruns chỉ update giá trị rate (giữ lại row).
- Best-effort: API down → log warning + bỏ qua, không raise (rate manual
  qua /admin/exchange-rates vẫn tồn tại làm fallback).

Manual fallback
---------------
Nếu API ngoài không reachable (VPS firewall, etc.), admin update tay qua
endpoint:  PUT /api/v1/exchange-rates/{currency}  với body { rate_to_vnd }.

Dependencies
------------
- app.core.procrastinate_app: app, SYNC_DSN
- psycopg2 (sync, để chạy trong worker không async)
- urllib.request (stdlib — không thêm dependency)
"""

from __future__ import annotations

import json
import logging
import time
import urllib.error
import urllib.request
from datetime import date, datetime, timezone
from typing import Any

import psycopg2
import psycopg2.extras

from app.core.procrastinate_app import app, SYNC_DSN

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

# RMB là alias-row cho CNY trong selector — fetch CNY xong copy sang RMB.
SUPPORTED_FX: tuple[str, ...] = ("USD", "JPY", "KRW", "CNY", "EUR")

API_URL_TEMPLATE = "https://open.er-api.com/v6/latest/{base}"
API_TIMEOUT_SECONDS = 12
SOURCE_TAG = "auto-open.er-api.com"


# ---------------------------------------------------------------------------
# Periodic task — 08:00 UTC daily (= 15:00 ICT)
# ---------------------------------------------------------------------------

@app.periodic(cron="0 8 * * *")
@app.task(name="fx_rates_sync", queue="etl", queueing_lock="fx_rates_sync")
def fx_rates_sync(timestamp: int = 0) -> dict[str, Any]:
    """Fetch latest FX rates → VND from public API and upsert into exchange_rates."""
    started_at = datetime.now(timezone.utc)
    t0 = time.monotonic()
    logger.info("fx_rates_sync: start (utc=%s)", started_at.isoformat())

    today = date.today()
    fetched: dict[str, float] = {}
    errors: list[str] = []

    for cur in SUPPORTED_FX:
        try:
            rate = _fetch_rate_to_vnd(cur)
        except Exception as exc:  # noqa: BLE001
            logger.warning("fx_rates_sync: fetch %s failed: %s", cur, exc)
            errors.append(f"{cur}: {exc}")
            continue
        if rate is None or rate <= 0:
            errors.append(f"{cur}: invalid rate {rate!r}")
            continue
        fetched[cur] = rate

    # Mirror CNY → RMB (alias row used by selector)
    if "CNY" in fetched:
        fetched["RMB"] = fetched["CNY"]

    # NOTE: this task runs in the worker process, which is SEPARATE from the
    # running API process — so it cannot call invalidate_pricing_caches()
    # in-proc to flush the API's FX cache. This is acceptable because the
    # engine's _FX_TTL_SEC is only 60s, so fresh rates propagate within a
    # minute. (Future option: pg NOTIFY/LISTEN to invalidate eagerly.)
    upserted = 0
    if fetched:
        conn = psycopg2.connect(SYNC_DSN)
        try:
            conn.autocommit = False
            with conn.cursor() as cur_db:
                for currency, rate_val in fetched.items():
                    cur_db.execute(
                        """
                        INSERT INTO exchange_rates
                            (rate_date, from_currency, to_currency, rate, source)
                        VALUES (%s, %s, 'VND', %s, %s)
                        ON CONFLICT (rate_date, from_currency, to_currency) DO UPDATE
                            SET rate       = EXCLUDED.rate,
                                source     = EXCLUDED.source,
                                created_at = NOW()
                        -- W2-03 (Thang 2026-07-03): MANUAL ƯU TIÊN. Nếu cùng ngày
                        -- kế toán đã nhập tay (source LIKE 'manual%'), auto-fetch
                        -- KHÔNG được đè. Chỉ refresh các row do auto ghi trước đó.
                        WHERE exchange_rates.source NOT LIKE 'manual%'
                        """,
                        (today, currency, rate_val, SOURCE_TAG),
                    )
                    upserted += 1
            conn.commit()
        except Exception as exc:
            conn.rollback()
            logger.exception("fx_rates_sync: DB upsert failed: %s", exc)
            errors.append(f"DB: {exc}")
        finally:
            conn.close()

    summary: dict[str, Any] = {
        "fetched":       fetched,
        "upserted":      upserted,
        "errors":        errors,
        "started_at":    started_at.isoformat(),
        "duration_s":    round(time.monotonic() - t0, 2),
    }
    logger.info(
        "fx_rates_sync: done upserted=%d errors=%d in %.2fs",
        upserted, len(errors), summary["duration_s"],
    )
    return summary


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _fetch_rate_to_vnd(base_currency: str) -> float | None:
    """Call open.er-api.com/v6/latest/{base} and return rate `base_currency → VND`.

    rates.VND is VND-per-1-unit-of-base — stored directly (no inversion), exactly
    the value the pricing engine multiplies by. Returns None on missing field or
    non-positive number. Raises RuntimeError on transport error OR an API "error"
    result so the caller can record the message.
    """
    url = API_URL_TEMPLATE.format(base=base_currency)
    req = urllib.request.Request(
        url,
        headers={"Accept": "application/json", "User-Agent": "SongChauERP-FXSync/1.0"},
    )
    with urllib.request.urlopen(req, timeout=API_TIMEOUT_SECONDS) as resp:
        body = resp.read()
    try:
        data = json.loads(body)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"non-JSON response: {exc}") from exc
    if data.get("result") != "success":
        raise RuntimeError(f"API error: {data.get('error-type') or 'unknown'}")
    rate = (data.get("rates") or {}).get("VND")
    if rate is None:
        return None
    try:
        rv = float(rate)
    except (TypeError, ValueError):
        return None
    return rv if rv > 0 else None
