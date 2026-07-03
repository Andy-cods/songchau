"""Sourcing pricing engine — compute suggested sale_vnd from cost + item_type rule.

Khớp template "Bảng tính giá 2026" (sheet "Tính giá") của Thang:
    I = G * H             — Đơn giá nhập VND  = cost_amount * exchange_rate
    K = I * J             — Thành tiền nhập   = I * qty
    L = vn_shipping_fee_vnd  — Vận chuyển VN
    M = fedex_fee_vnd        — Vận chuyển Fedex
    N = (K + M) * import_tax_pct/100   — Thuế NK; =0 khi is_domestic_vn
    O = (K + M + N) * vat_pct/100      — Thuế VAT
    P = K * purchase_cost_pct/100      — Chi phí mua hộ (25%)
    Q = (K + M + P) * transfer_fee_pct/100 + swift_fee_usd * USD_VND
                                       — Chi phí khác (phí chuyển tiền + Swift)
    R = (K + L + M + N + O + P + Q) * profit_pct/100
        profit_pct = profit_pct_domestic nếu is_domestic_vn (20%), else profit_pct_import (12%)
    S = (K + L + M + N + P + Q + R + O) / J    — Giá make = đơn giá bán đề xuất

Used by:
- POST /sourcing/calc-suggest (live preview cho sale form)

Thang 2026-06-13.
"""
from __future__ import annotations

import logging
import os
import time
from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from typing import Any

import asyncpg

logger = logging.getLogger(__name__)


# ─────────── FX staleness guard (Thang 2026-06-21) ───────────
# A live-FX quote must NOT silently use a stale rate. When the engine sources
# the rate from the exchange_rates table (no explicit caller override), and the
# newest rate_date is older than this many days, raise so the modal surfaces
# "tỷ giá quá hạn". A user-typed manual `exchange_rate` always wins and bypasses
# this guard (it returns before the DB-lookup branch). The /admin/exchange-rates
# PUT path also satisfies the guard by writing a today-dated row.
try:
    FX_STALENESS_DAYS = int(os.getenv("FX_STALENESS_DAYS", "7"))
except (TypeError, ValueError):
    FX_STALENESS_DAYS = 7


# ─────────── Prometheus custom metrics (Thang 2026-06-14) ───────────
# Three metrics surface the health of the sourcing pricing path:
#   1. calc_suggest_latency_seconds  — Histogram (by item_type)
#   2. fx_cache_hit_total            — Counter   (by currency, hit/miss)
#   3. rule_fallback_total           — Counter   (when item_type → 'default')
#
# All register against prometheus_client's default REGISTRY, so the
# prometheus-fastapi-instrumentator /metrics endpoint exposes them in
# the same scrape as auto-collected HTTP histograms.
#
# Wrapped in try/except so a missing prometheus_client package does NOT
# break pricing — observability degrades, business logic continues.
try:
    from prometheus_client import Counter, Histogram

    CALC_SUGGEST_LATENCY = Histogram(
        "calc_suggest_latency_seconds",
        "Latency of sourcing compute_sale_vnd() in seconds, labelled by item_type.",
        labelnames=("item_type",),
        buckets=(0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0),
    )
    FX_CACHE_HITS = Counter(
        "fx_cache_hit_total",
        "FX rate cache lookups, labelled by currency and result (hit|miss).",
        labelnames=("currency", "result"),
    )
    RULE_FALLBACK = Counter(
        "rule_fallback_total",
        "Count of get_rule() lookups that fell back to the 'default' pricing rule.",
        labelnames=("requested_item_type",),
    )
    _PROM_ENABLED = True
except Exception:  # noqa: BLE001 — prometheus_client optional at import time
    CALC_SUGGEST_LATENCY = None  # type: ignore[assignment]
    FX_CACHE_HITS = None  # type: ignore[assignment]
    RULE_FALLBACK = None  # type: ignore[assignment]
    _PROM_ENABLED = False
    logger.warning("prometheus_client unavailable; sourcing metrics disabled")


def _metric_inc(metric, labels: dict[str, str]) -> None:
    if not _PROM_ENABLED or metric is None:
        return
    try:
        metric.labels(**labels).inc()
    except Exception:  # noqa: BLE001
        pass


def _metric_observe(metric, labels: dict[str, str], value: float) -> None:
    if not _PROM_ENABLED or metric is None:
        return
    try:
        metric.labels(**labels).observe(value)
    except Exception:  # noqa: BLE001
        pass


# FIX B5 (Thang 2026-06-13): DEFAULT_FX_TO_VND hardcode removed.
# Tỷ giá phải đến từ:
#   1. Caller (UI passes `exchange_rate` từ snapshot lúc nhập), HOẶC
#   2. `fetch_fx_to_vnd()` đọc từ bảng `exchange_rates` (giá trị mới nhất).
# Không còn fallback hardcode — nếu DB thiếu rate cho currency, engine
# raise ValueError để UI hiển thị banner "Tỷ giá chưa cập nhật".


# ─────────── ICE #1: in-process TTL cache (Thang 2026-06-13) ───────────
# /calc-suggest fires on every keystroke; FX + pricing rules change at most
# daily/monthly. A small TTL cache eliminates ~95% of those DB round-trips
# at zero risk: keys are scoped per (currency,) / (item_type,) — no PII —
# and TTLs are short enough that any admin edit propagates quickly.
#
# Stdlib-only (no cachetools dep). Single worker process → bounded entries.
_FX_TTL_SEC = 60          # FX rates: 60s — admin edit visible within 1 min
_RULE_TTL_SEC = 300       # Pricing rules: 5 min — they change monthly at most
_fx_cache: dict[str, tuple[float, Decimal | None]] = {}   # cur → (expires_at, rate)
_rule_cache: dict[str, tuple[float, dict[str, Any]]] = {}  # item_type → (expires_at, rule)


def _cache_get(cache: dict, key: str) -> Any | None:
    item = cache.get(key)
    if not item:
        return None
    expires_at, value = item
    if expires_at < time.monotonic():
        cache.pop(key, None)
        return None
    return value


def _cache_set(cache: dict, key: str, value: Any, ttl: float) -> None:
    cache[key] = (time.monotonic() + ttl, value)


def invalidate_pricing_caches() -> None:
    """Call after admin mutates exchange_rates or sourcing_pricing_rules."""
    _fx_cache.clear()
    _rule_cache.clear()


def _fx_cache_key(currency: str, as_of_date: date | None) -> str:
    """Cache key for an FX lookup.

    Dated lookups (`as_of_date` given) must NOT be cross-cached with the
    "latest" lookup, otherwise a historical quote_date would poison the
    live rate (and vice versa). The date is folded into the key.
    """
    return currency if as_of_date is None else f"{currency}@{as_of_date.isoformat()}"


async def _fetch_fx_row(
    conn: asyncpg.Connection,
    currency: str,
    as_of_date: date | None,
) -> asyncpg.Record | None:
    """Shared query for fetch_fx_to_vnd + fetch_fx_meta.

    When `as_of_date` is given, return the most-recent rate effective ON OR
    BEFORE that date (historical-by-quote-date). Else return the latest rate.
    Selects both `rate` and `rate_date` so callers can display/snapshot the
    exact effective date.
    """
    if as_of_date is not None:
        return await conn.fetchrow(
            """
            SELECT rate, rate_date
              FROM exchange_rates
             WHERE from_currency = $1 AND to_currency = 'VND'
               AND rate_date <= $2
             ORDER BY rate_date DESC, created_at DESC
             LIMIT 1
            """,
            currency,
            as_of_date,
        )
    return await conn.fetchrow(
        """
        SELECT rate, rate_date
          FROM exchange_rates
         WHERE from_currency = $1 AND to_currency = 'VND'
         ORDER BY rate_date DESC, created_at DESC
         LIMIT 1
        """,
        currency,
    )


async def fetch_fx_to_vnd(
    conn: asyncpg.Connection,
    currency: str,
    as_of_date: date | None = None,
) -> Decimal | None:
    """Lookup VND-conversion rate for `currency` from exchange_rates table.

    When `as_of_date` is given, returns the most-recent rate effective ON OR
    BEFORE that date (historical rate by quote/inquiry date); otherwise returns
    the latest rate. Returns Decimal rate or None if no row exists. VND→VND
    short-circuits to 1. Result memoised in-process for `_FX_TTL_SEC` seconds,
    keyed by (currency, as_of_date) so dated lookups never alias the latest.
    """
    cur = (currency or "VND").upper().strip()
    if cur == "VND":
        return Decimal("1")
    ckey = _fx_cache_key(cur, as_of_date)
    cached = _cache_get(_fx_cache, ckey)
    if cached is not None:
        _metric_inc(FX_CACHE_HITS, {"currency": cur, "result": "hit"})
        return cached
    _metric_inc(FX_CACHE_HITS, {"currency": cur, "result": "miss"})
    try:
        row = await _fetch_fx_row(conn, cur, as_of_date)
    except Exception as exc:  # noqa: BLE001 — bảng có thể chưa migrate
        logger.warning("fetch_fx_to_vnd(%s) DB error: %s", cur, exc)
        return None
    if not row:
        # Negative cache too — avoids hammering DB when rate is genuinely missing.
        _cache_set(_fx_cache, ckey, None, _FX_TTL_SEC)
        return None
    try:
        rate = Decimal(str(row["rate"]))
    except Exception:
        return None
    _cache_set(_fx_cache, ckey, rate, _FX_TTL_SEC)
    return rate


async def fetch_fx_meta(
    conn: asyncpg.Connection,
    currency: str,
    as_of_date: date | None = None,
) -> tuple[Decimal | None, date | None]:
    """Like fetch_fx_to_vnd but also returns the rate's effective `rate_date`.

    Used to DISPLAY and SNAPSHOT the exact date a quote's FX rate came from.
    VND→VND short-circuits to (1, as_of_date or today). Not cached (called on
    save, not per-keystroke) — reuses the same query as fetch_fx_to_vnd.
    Returns (rate, rate_date); (None, None) when no row exists.
    """
    cur = (currency or "VND").upper().strip()
    if cur == "VND":
        return (Decimal("1"), as_of_date or date.today())
    try:
        row = await _fetch_fx_row(conn, cur, as_of_date)
    except Exception as exc:  # noqa: BLE001 — bảng có thể chưa migrate
        logger.warning("fetch_fx_meta(%s) DB error: %s", cur, exc)
        return (None, None)
    if not row:
        return (None, None)
    try:
        rate = Decimal(str(row["rate"]))
    except Exception:
        return (None, None)
    rate_date = row["rate_date"] if isinstance(row["rate_date"], date) else None
    return (rate, rate_date)


def _D(v: Any, default: str = "0") -> Decimal:
    if v is None or v == "":
        return Decimal(default)
    try:
        return Decimal(str(v))
    except Exception:
        return Decimal(default)


def _round_vnd(v: Decimal) -> int:
    """Round lên đồng VND (không lấy phần lẻ)."""
    return int(v.quantize(Decimal("1"), rounding=ROUND_HALF_UP))


async def get_rule(conn: asyncpg.Connection, item_type: str | None) -> dict[str, Any]:
    """Lookup rule cho item_type → fall back 'default'.

    Returns dict shape:
      { item_type, markup_pct, tax_pct, shipping_fee_vnd,
        import_tax_pct, vat_pct, purchase_cost_pct, transfer_fee_pct,
        swift_fee_usd, profit_pct_import, profit_pct_domestic,
        description_vi, _fallback }
    Never raises — guarantees a usable rule.

    Result memoised in-process for `_RULE_TTL_SEC` seconds (ICE #1, 2026-06-13).
    """
    requested = (item_type or "default").strip() or "default"
    cached = _cache_get(_rule_cache, requested)
    if cached is not None:
        return cached

    # Try expanded schema first; fall back to legacy column subset if migration chưa chạy.
    sql_full = """
        SELECT item_type, markup_pct, tax_pct, shipping_fee_vnd,
               import_tax_pct, vat_pct, purchase_cost_pct,
               transfer_fee_pct, swift_fee_usd,
               profit_pct_import, profit_pct_domestic,
               description_vi
          FROM sourcing_pricing_rules
         WHERE item_type = $1
    """
    sql_legacy = """
        SELECT item_type, markup_pct, tax_pct, shipping_fee_vnd, description_vi
          FROM sourcing_pricing_rules
         WHERE item_type = $1
    """

    async def _fetch(it: str) -> asyncpg.Record | None:
        try:
            return await conn.fetchrow(sql_full, it)
        except asyncpg.UndefinedColumnError:
            return await conn.fetchrow(sql_legacy, it)

    row = await _fetch(requested)
    fallback = False
    if not row and requested != "default":
        fallback = True
        row = await _fetch("default")
        _metric_inc(RULE_FALLBACK, {"requested_item_type": requested})

    if not row:
        logger.warning("sourcing_pricing_rules missing 'default' row; using hardcoded fallback")
        _metric_inc(RULE_FALLBACK, {"requested_item_type": requested})
        fb = _hardcoded_rule()
        _cache_set(_rule_cache, requested, fb, _RULE_TTL_SEC)
        return fb

    rd = dict(row)
    out = {
        "item_type": rd["item_type"],
        "markup_pct": _D(rd.get("markup_pct"), "1.4"),
        "tax_pct": _D(rd.get("tax_pct"), "10"),
        "shipping_fee_vnd": _D(rd.get("shipping_fee_vnd"), "0"),
        "import_tax_pct": _D(rd.get("import_tax_pct"), "20"),
        "vat_pct": _D(rd.get("vat_pct"), str(rd.get("tax_pct") or "10")),
        "purchase_cost_pct": _D(rd.get("purchase_cost_pct"), "25"),
        "transfer_fee_pct": _D(rd.get("transfer_fee_pct"), "0.2"),
        "swift_fee_usd": _D(rd.get("swift_fee_usd"), "5"),
        "profit_pct_import": _D(rd.get("profit_pct_import"), "12"),
        "profit_pct_domestic": _D(rd.get("profit_pct_domestic"), "20"),
        "description_vi": rd.get("description_vi"),
        "_fallback": fallback,
    }
    _cache_set(_rule_cache, requested, out, _RULE_TTL_SEC)
    return out


def _hardcoded_rule() -> dict[str, Any]:
    return {
        "item_type": "default",
        "markup_pct": Decimal("1.4"),
        "tax_pct": Decimal("10"),
        "shipping_fee_vnd": Decimal("0"),
        "import_tax_pct": Decimal("20"),
        "vat_pct": Decimal("10"),
        "purchase_cost_pct": Decimal("25"),
        "transfer_fee_pct": Decimal("0.2"),
        "swift_fee_usd": Decimal("5"),
        "profit_pct_import": Decimal("12"),
        "profit_pct_domestic": Decimal("20"),
        "description_vi": "Hardcoded fallback (migration chưa chạy)",
        "_fallback": True,
    }


async def compute_sale_vnd(
    conn: asyncpg.Connection,
    item_type: str | None,
    cost_amount: float | Decimal,
    currency: str = "VND",
    exchange_rate: float | Decimal | None = None,
    qty: float | Decimal | None = None,
    fedex_fee_vnd: float | Decimal | None = None,
    vn_shipping_fee_vnd: float | Decimal | None = None,
    is_domestic_vn: bool = False,
    fx_date: date | None = None,
) -> dict[str, Any]:
    """Compute đầy đủ breakdown I, K, L, M, N, O, P, Q, R, S theo template "Bảng tính giá".

    Args mapped to template columns:
      cost_amount        → G (giá nhập gốc)
      exchange_rate      → H (tỷ giá VND)
      qty                → J (số lượng), default 1
      vn_shipping_fee_vnd → L (vận chuyển VN), default 0
      fedex_fee_vnd      → M (vận chuyển Fedex), default 0
      is_domestic_vn     → True → N=0 + dùng profit_pct_domestic (20%)
      item_type          → lookup pricing rule (markup/tax/profit %s)

    Returns:
      {
        suggested_sale_vnd: int (= S),
        breakdown: {
            I, K, L, M, N, O, P, Q, R, S, total_before_profit,
            qty, is_domestic_vn,
            exchange_rate_used, cost_amount, currency, cost_vnd_unit,
            rule_used: {...},
            params: { import_tax_pct, vat_pct, purchase_cost_pct,
                      transfer_fee_pct, swift_fee_usd, profit_pct_used },
        }
      }
    """
    _t_start = time.monotonic()
    _label_item_type = (item_type or "default").strip() or "default"

    cost = _D(cost_amount)
    if cost < 0:
        raise ValueError("cost_amount must be >= 0")

    currency_u = (currency or "VND").upper().strip()
    # exchange_rate_date = the rate_date actually used for the FX rate. When the
    # caller passes an explicit exchange_rate, or for VND, the rate isn't sourced
    # from a dated exchange_rates row — set it to fx_date (the quote date) or
    # None sensibly so the breakdown still carries a meaningful date.
    exchange_rate_date: date | None = None
    fx_age_days: int | None = None
    fx_stale: bool = False
    if exchange_rate is not None and float(exchange_rate) > 0:
        fx = _D(exchange_rate)
        # Rate supplied by caller (e.g. a frozen snapshot) — date is the quote
        # date when provided, else today (best display value, not authoritative).
        exchange_rate_date = fx_date or (None if currency_u == "VND" else date.today())
    elif currency_u == "VND":
        # VND→VND always 1; rate "date" is the quote date or today.
        fx = Decimal("1")
        exchange_rate_date = fx_date or date.today()
    else:
        # FIX B5 (Thang 2026-06-13): no hardcode — read from exchange_rates table.
        # 1b.2: when fx_date given, use the historical rate effective on/before it.
        db_fx, db_rate_date = await fetch_fx_meta(conn, currency_u, as_of_date=fx_date)
        if db_fx is None or db_fx <= 0:
            raise ValueError(
                f"Thiếu tỷ giá {currency_u}/VND — cập nhật tại /admin/exchange-rates"
                " hoặc truyền `exchange_rate` trong payload."
            )
        fx = db_fx
        exchange_rate_date = db_rate_date
        # Staleness guard (Thang 2026-06-21): the DB rate must be reasonably
        # fresh. Only enforced here — the manual-override branch returns above,
        # so a hand-typed tỷ giá always bypasses this.
        if db_rate_date is not None:
            fx_age_days = (date.today() - db_rate_date).days
            if fx_age_days > FX_STALENESS_DAYS:
                raise ValueError(
                    f"Tỷ giá {currency_u}/VND quá hạn ({fx_age_days} ngày, "
                    f"cập nhật {db_rate_date}). Cập nhật tại /admin/exchange-rates "
                    "hoặc nhập tỷ giá tay."
                )
            fx_stale = fx_age_days > FX_STALENESS_DAYS

    qty_d = _D(qty, "1")
    if qty_d <= 0:
        qty_d = Decimal("1")

    L = _D(vn_shipping_fee_vnd, "0")
    if L < 0:
        L = Decimal(0)
    M = _D(fedex_fee_vnd, "0")
    if M < 0:
        M = Decimal(0)

    rule = await get_rule(conn, item_type)
    import_tax_pct: Decimal = rule["import_tax_pct"]
    vat_pct: Decimal = rule["vat_pct"]
    purchase_cost_pct: Decimal = rule["purchase_cost_pct"]
    transfer_fee_pct: Decimal = rule["transfer_fee_pct"]
    swift_fee_usd: Decimal = rule["swift_fee_usd"]
    profit_pct = rule["profit_pct_domestic"] if is_domestic_vn else rule["profit_pct_import"]

    # Swift fee (Thang 2026-06-15): match "Bảng tính giá 2026" exactly. The Excel
    # column Q uses `5 × H` where H is THIS row's exchange rate (column H) — NOT a
    # separate USD rate. So the swift fee converts at `fx` (the cost-currency rate).

    # Column formulas
    I = cost * fx                                # Đơn giá nhập VND
    K = I * qty_d                                # Thành tiền nhập
    if is_domestic_vn:
        N = Decimal(0)                           # No import tax for domestic
    else:
        N = (K + M) * import_tax_pct / Decimal(100)
    O = (K + M + N) * vat_pct / Decimal(100)
    P = K * purchase_cost_pct / Decimal(100)
    Q = (K + M + P) * transfer_fee_pct / Decimal(100) + swift_fee_usd * fx
    base_for_profit = K + L + M + N + O + P + Q
    R = base_for_profit * profit_pct / Decimal(100)
    total_S_sum = K + L + M + N + P + Q + R + O   # khớp công thức S (note: trùng tham chiếu O+N)
    S = total_S_sum / qty_d

    # Observe end-to-end engine latency, labelled by item_type so dashboards
    # can spot a single rule lookup slowing down (e.g. cache miss storms).
    _metric_observe(
        CALC_SUGGEST_LATENCY,
        {"item_type": _label_item_type},
        time.monotonic() - _t_start,
    )

    # Structured log line — picked up by JsonFormatter; correlation fields
    # (request_id/user_id/route) injected automatically from contextvars.
    logger.info(
        "calc_suggest_done",
        extra={
            "item_type": _label_item_type,
            "currency": currency_u,
            "suggested_sale_vnd": _round_vnd(S),
            "latency_ms": round((time.monotonic() - _t_start) * 1000, 2),
        },
    )

    return {
        "suggested_sale_vnd": _round_vnd(S),
        "breakdown": {
            "I": _round_vnd(I),
            "K": _round_vnd(K),
            "L": _round_vnd(L),
            "M": _round_vnd(M),
            "N": _round_vnd(N),
            "O": _round_vnd(O),
            "P": _round_vnd(P),
            "Q": _round_vnd(Q),
            "R": _round_vnd(R),
            "S": _round_vnd(S),
            "total_before_profit": _round_vnd(base_for_profit),
            "total_with_profit": _round_vnd(total_S_sum),
            "qty": float(qty_d),
            "is_domestic_vn": bool(is_domestic_vn),
            "exchange_rate_used": float(fx),
            "exchange_rate_date": exchange_rate_date.isoformat() if exchange_rate_date else None,
            "fx_stale": bool(fx_stale),
            "fx_age_days": fx_age_days,
            "cost_amount": float(cost),
            "currency": currency_u,
            "cost_vnd_unit": _round_vnd(I),
            "rule_used": {
                "item_type": rule["item_type"],
                "description_vi": rule.get("description_vi"),
                "fallback_to_default": bool(rule.get("_fallback")),
            },
            "params": {
                "import_tax_pct": float(import_tax_pct),
                "vat_pct": float(vat_pct),
                "purchase_cost_pct": float(purchase_cost_pct),
                "transfer_fee_pct": float(transfer_fee_pct),
                "swift_fee_usd": float(swift_fee_usd),
                "profit_pct_used": float(profit_pct),
                "profit_pct_import": float(rule["profit_pct_import"]),
                "profit_pct_domestic": float(rule["profit_pct_domestic"]),
                "swift_rate_used": float(fx),
            },
        },
    }
