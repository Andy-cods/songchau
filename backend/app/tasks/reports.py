"""
Report Generation Tasks — daily materialised-view refresh at 07:00.

Steps
-----
1. Iterate all known materialised views and REFRESH them CONCURRENTLY.
2. Log each refresh result (duration, row count) to mv_refresh_log.
3. Emit a report_ready WebSocket event so dashboards update live.

Uses a dedicated sync psycopg2 connection to stay compatible with
Procrastinate workers that run outside FastAPI's async event loop.
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from typing import Any

import psycopg2
import psycopg2.extras

from app.core.procrastinate_app import app, SYNC_DSN

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Materialized views to refresh (in dependency order)
# ---------------------------------------------------------------------------

MATERIALIZED_VIEWS: list[str] = [
    # BQMS
    "bqms_kpi",
    # Inventory / warehouse
    "mv_stock_summary",
    "mv_stock_aging",
    # Procurement
    "mv_po_monthly",
    "mv_supplier_performance",
    # Workflow
    "mv_workflow_summary",
    # Finance
    "mv_daily_spend",
]


# ---------------------------------------------------------------------------
# Periodic task — 07:00 every day
# ---------------------------------------------------------------------------

@app.periodic(cron="0 7 * * *")
@app.task(name="generate_daily_reports", queue="reports")
def generate_daily_reports(timestamp: int = 0) -> dict[str, Any]:  # type: ignore[misc]
    """
    Refresh all materialized views and log results.

    Returns a summary dict with per-view timing information.
    """
    started_at = datetime.now(timezone.utc)
    logger.info("generate_daily_reports: starting (utc=%s)", started_at.isoformat())

    results: list[dict[str, Any]] = []
    total_errors = 0

    conn = psycopg2.connect(SYNC_DSN)
    try:
        conn.autocommit = True  # REFRESH MATERIALIZED VIEW cannot run inside a transaction

        for view_name in MATERIALIZED_VIEWS:
            result = _refresh_view(conn, view_name, started_at)
            results.append(result)
            if result.get("error"):
                total_errors += 1

    finally:
        conn.close()

    summary: dict[str, Any] = {
        "views_refreshed":  len(results) - total_errors,
        "views_failed":     total_errors,
        "total_duration_s": round(sum(r.get("duration_s", 0) for r in results), 3),
        "views":            results,
        "generated_at":     started_at.isoformat(),
    }

    logger.info(
        "generate_daily_reports: done views_ok=%d views_err=%d total=%.2fs",
        summary["views_refreshed"], summary["views_failed"],
        summary["total_duration_s"],
    )

    # Emit WebSocket notification (best-effort)
    _emit_report_ready(summary)

    return summary


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _refresh_view(
    conn: psycopg2.extensions.connection,
    view_name: str,
    started_at: datetime,
) -> dict[str, Any]:
    """
    REFRESH a single materialized view and record the result in mv_refresh_log.

    Returns a dict with keys: view_name, duration_s, row_count, error.
    """
    t0 = time.monotonic()
    error_msg: str | None = None
    row_count: int | None = None

    try:
        with conn.cursor() as cur:
            # Try concurrent refresh first (requires unique index on the view)
            try:
                cur.execute(
                    f"REFRESH MATERIALIZED VIEW CONCURRENTLY {view_name}"  # noqa: S608
                )
                logger.debug("generate_daily_reports: refreshed %s (concurrent)", view_name)
            except psycopg2.errors.FeatureNotSupported:
                # View has no unique index — fall back to blocking refresh
                cur.execute(f"REFRESH MATERIALIZED VIEW {view_name}")  # noqa: S608
                logger.debug("generate_daily_reports: refreshed %s (blocking)", view_name)

            # Approximate row count after refresh
            try:
                cur.execute(f"SELECT COUNT(*) FROM {view_name}")  # noqa: S608
                row_count = cur.fetchone()[0]
            except Exception:
                row_count = None

    except Exception as exc:
        error_msg = str(exc)
        logger.warning(
            "generate_daily_reports: failed to refresh %s: %s", view_name, exc
        )

    duration_s = round(time.monotonic() - t0, 3)

    # Log the attempt to mv_refresh_log (best-effort — table may not exist yet)
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO mv_refresh_log
                    (view_name, refreshed_at, duration_ms, row_count, error)
                VALUES (%s, %s, %s, %s, %s)
                """,
                (
                    view_name,
                    started_at,
                    int(duration_s * 1000),
                    row_count,
                    error_msg,
                ),
            )
    except Exception as log_exc:
        logger.debug(
            "generate_daily_reports: could not write to mv_refresh_log: %s", log_exc
        )

    return {
        "view_name":  view_name,
        "duration_s": duration_s,
        "row_count":  row_count,
        "error":      error_msg,
    }


# ---------------------------------------------------------------------------
# WebSocket emit (sync bridge)
# ---------------------------------------------------------------------------

def _emit_report_ready(summary: dict[str, Any]) -> None:
    """Emit report_ready Socket.IO event from a sync worker context."""
    import asyncio

    try:
        from app.websocket.handlers import emit_report_ready
        asyncio.run(
            emit_report_ready(
                "daily_summary",
                target_role="manager",
                details={
                    "views_refreshed": summary["views_refreshed"],
                    "generated_at":    summary["generated_at"],
                },
            )
        )
    except RuntimeError as exc:
        if "cannot be called from a running event loop" in str(exc):
            logger.debug("_emit_report_ready: skipping (event loop already running)")
        else:
            logger.warning("_emit_report_ready: RuntimeError: %s", exc)
    except Exception as exc:
        logger.warning("_emit_report_ready: failed to emit WebSocket event: %s", exc)
