# Observability — Song Châu ERP API

Owner: Thang
Last updated: 2026-06-14

This document describes the structured-logging + Prometheus metrics layer
shipped with `sc-api` (FastAPI). It exists so on-call engineers can answer the
three questions every incident asks:

1. **What is slow?**     → `/metrics` histograms (HTTP + sourcing engine)
2. **For which user?**   → JSON logs with `request_id` + `user_id` correlation
3. **Why is it slow?**   → cache-hit + fallback counters (`fx_cache_hit_total`,
   `rule_fallback_total`)

---

## 1. Structured JSON Logs

Implementation: `backend/app/core/logging_config.py` — installed in
`backend/app/main.py` via `setup_logging(service="sc-api")` at import time.

Every record is a single JSON object printed to **stdout** (so Docker/Loki/CW
pick it up natively). No `python-json-logger` dependency — pure stdlib.

### Always-present fields

| Field       | Source                                  |
|-------------|-----------------------------------------|
| `timestamp` | UTC ISO-8601                            |
| `level`     | `INFO` / `WARNING` / `ERROR` …          |
| `logger`    | `app.api.v1.sourcing` etc.              |
| `service`   | constant `sc-api`                       |
| `message`   | the log message                         |

### Request-scoped correlation fields (auto-injected via `contextvars`)

| Field        | Set by                                                       |
|--------------|--------------------------------------------------------------|
| `request_id` | `X-Request-ID` header, else new UUID (`request_tracing` mw)  |
| `user_id`    | `request.state.user_id` if auth middleware populated it      |
| `route`      | `METHOD /api/v1/...`                                         |

Because these live in `contextvars`, ANY logger call inside a request handler
inherits them automatically — including loggers in service modules
(`sourcing_pricing_engine`, ETL helpers, etc.). No manual threading required.

### Per-handler optional fields

Pass via `logger.info("...", extra={...})`. The formatter copies any JSON-
serializable extras onto the record. Conventions:

| Field         | When                                                |
|---------------|-----------------------------------------------------|
| `latency_ms`  | request-completion + sourcing engine                 |
| `status_code` | request-completion                                   |
| `item_type`   | sourcing operations                                  |
| `currency`    | sourcing operations                                  |

### Example log line

```json
{
  "timestamp": "2026-06-14T08:42:11.512Z",
  "level": "INFO",
  "logger": "app.services.sourcing_pricing_engine",
  "service": "sc-api",
  "message": "calc_suggest_done",
  "request_id": "9b7d1...",
  "user_id": "42",
  "route": "POST /api/v1/sourcing/calc-suggest",
  "item_type": "default",
  "currency": "USD",
  "suggested_sale_vnd": 4747064,
  "latency_ms": 12.43
}
```

### Adding context manually

```python
from app.core.logging_config import request_context

with request_context(request_id="job-abc", user_id="cron"):
    logger.info("batch_started", extra={"item_count": 117})
```

Use this in Procrastinate workers / cron tasks where there is no HTTP request
to populate context for you.

---

## 2. Prometheus `/metrics`

Implementation: [`prometheus-fastapi-instrumentator==7.0.0`](https://github.com/trallnag/prometheus-fastapi-instrumentator)
wired in `backend/app/main.py`.

- **Endpoint:** `GET /metrics`  (Prometheus exposition format `text/plain; version=0.0.4`)
- **Excluded from scrape:** `/metrics`, `/api/docs`, `/api/openapi.json`
- **Auth:** none (the endpoint is reachable inside the Docker network; expose
  publicly only via the Prometheus scrape job — never via nginx unauth).

### Auto-collected HTTP histogram

The instrumentator registers the standard
`http_request_duration_seconds_{bucket,sum,count}` histogram with labels
`method`, `handler`, `status`. Use it for:

- Per-route p50 / p95 / p99 latency
- Error-rate alerts (`{status=~"5.."}`)
- Throughput (`rate(http_requests_total[5m])`)

### Custom Sourcing metrics

All three live in `backend/app/services/sourcing_pricing_engine.py` and
register against the same default `prometheus_client.REGISTRY`, so a single
scrape returns everything.

| Metric                            | Type      | Labels                              | Meaning                                                                 |
|-----------------------------------|-----------|-------------------------------------|-------------------------------------------------------------------------|
| `calc_suggest_latency_seconds`    | Histogram | `item_type`                         | End-to-end latency of `compute_sale_vnd()` per item_type                |
| `fx_cache_hit_total`              | Counter   | `currency`, `result` ∈ {hit, miss}  | In-process FX TTL cache lookups (60s TTL — see `_FX_TTL_SEC`)           |
| `rule_fallback_total`             | Counter   | `requested_item_type`               | Number of times an unknown `item_type` fell back to the `default` rule  |

### Sample PromQL

```promql
# p95 sourcing engine latency by item_type
histogram_quantile(0.95,
  sum by (le, item_type) (rate(calc_suggest_latency_seconds_bucket[5m]))
)

# FX cache effectiveness (closer to 1.0 = better)
sum(rate(fx_cache_hit_total{result="hit"}[5m])) /
sum(rate(fx_cache_hit_total[5m]))

# Item types that need a real rule row (top fallbacks per hour)
topk(10, sum by (requested_item_type) (rate(rule_fallback_total[1h])))
```

### Sample alerts (informational — wire into Alertmanager separately)

- **HighCalcSuggestLatency** — p95 `calc_suggest_latency_seconds` > 0.5s for 5m
- **FxCacheStarvation** — hit ratio < 0.5 for 10m (DB or cache TTL misconfigured)
- **UnknownItemTypeSurge** — `rate(rule_fallback_total[5m]) > 1` (someone is
  posting `item_type` values that aren't in `sourcing_pricing_rules`)

---

## 3. Local verification

```bash
cd backend
uvicorn app.main:app --reload --port 8000

# Exercise the engine once so custom metrics show up
curl -X POST http://localhost:8000/api/v1/sourcing/calc-suggest \
  -H 'Authorization: Bearer <jwt>' -H 'Content-Type: application/json' \
  -d '{"cost_amount": 100, "currency": "USD", "exchange_rate": 25000}'

# Scrape
curl -s http://localhost:8000/metrics | grep -E 'calc_suggest|fx_cache|rule_fallback'
```

Expected lines:

```
# HELP calc_suggest_latency_seconds Latency of sourcing compute_sale_vnd() ...
# TYPE calc_suggest_latency_seconds histogram
calc_suggest_latency_seconds_bucket{item_type="default",le="0.001"} 0.0
...
fx_cache_hit_total{currency="USD",result="hit"} 1.0
```

---

## 4. Why no Grafana?

There is no Grafana in the current Song Châu stack — Prometheus alone is the
scrape target. When a dashboard is needed, point Grafana at the existing
Prometheus and import the PromQL above. Until then this document IS the
dashboard spec.

---

## 5. Files

- `backend/app/core/logging_config.py` — JSON formatter + contextvars
- `backend/app/main.py` — `setup_logging()`, request_context middleware,
  `/metrics` registration
- `backend/app/services/sourcing_pricing_engine.py` — three custom metrics
- `backend/requirements.txt` — `prometheus-fastapi-instrumentator==7.0.0`,
  `prometheus-client==0.20.0`
