"""BQMS Won Quotation Sync — refresh contract data per RFQ on demand.

Thang 2026-06-13: previously the won/contract data flow was:
  scheduler nightly  →  scrape_contracts(limit=10, all pending)  →  staging
  manual cron run    →  upsert_won_from_contract_staging        →  bqms_won_quotations

Problem: when user marks an RFQ as 'won' via the BQMS UI, the
`bqms_won_quotations` row may not exist yet (Samsung's contract drill
only happens nightly). User then sees an empty Trúng BG drawer.

Solution: event-driven Procrastinate task `bqms_sync_won_for_rfq` that
the UI can defer the moment user marks result='won'. Task:
  1. Acquire pg_advisory_lock samsung_session_lock (shared with push +
     periodic_scrape — see BQMS Push Concurrency memory note).
  2. Call scrape_contracts(limit=1, filter_request_no=rfq_number).
  3. Call upsert_won_from_contract_staging(...).
  4. Return summary.

Also adds a lightweight periodic task `bqms_won_sync_periodic` (cron
'15 * * * *') gated by app_config flag `bqms_won_sync_periodic_enabled`
(default OFF). Runs upsert_won_from_contract_staging on ALL pending
staging rows so weekly-batch contract scrapes are picked up promptly
even without a UI trigger.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from datetime import datetime, timezone
from typing import Any

import psycopg2
import psycopg2.extras

from app.core.config import settings
from app.core.procrastinate_app import app, SYNC_DSN

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Event-driven: triggered when user flips bqms_rfq.result → 'won'.
# ---------------------------------------------------------------------------

@app.task(name="bqms_sync_won_for_rfq", queue="bqms")
def bqms_sync_won_for_rfq(rfq_number: str, user_id: str | None = None, timestamp: int = 0) -> dict[str, Any]:
    """Refresh won-quotation data for ONE RFQ on demand.

    Args:
        rfq_number: RFQ to refresh (e.g. 'QT26039894').
        user_id: optional UUID of the user who triggered the refresh
                 (for audit_log linkage).

    Returns:
        {
          "rfq_number": str,
          "scrape_summary": {list_count, drilled_count, ...},
          "upsert_summary": {inserted, updated, skipped, errors},
          "duration_seconds": float,
        }
    """
    started_at = datetime.now(timezone.utc)
    t0 = time.monotonic()
    logger.info("bqms_sync_won_for_rfq: rfq=%s start", rfq_number)

    rfq_number = (rfq_number or "").strip()
    if not rfq_number:
        return {"error": "rfq_number empty", "duration_seconds": 0.0}

    result: dict[str, Any] = {
        "rfq_number": rfq_number,
        "started_at": started_at.isoformat(),
        "scrape_summary": {},
        "upsert_summary": {},
        "errors": [],
    }

    try:
        result.update(asyncio.run(_run_one(rfq_number, user_id)))
    except Exception as exc:
        logger.exception("bqms_sync_won_for_rfq failed: rfq=%s err=%s", rfq_number, exc)
        result["errors"].append(str(exc)[:500])

    result["duration_seconds"] = round(time.monotonic() - t0, 2)
    _log_audit(rfq_number, user_id, result)
    logger.info(
        "bqms_sync_won_for_rfq: rfq=%s done %.1fs",
        rfq_number, result["duration_seconds"],
    )
    return result


async def _run_one(rfq_number: str, user_id: str | None) -> dict[str, Any]:
    """Acquire Samsung lock → scrape 1 contract → upsert won row."""
    import asyncpg

    from app.etl.bqms_contract_scraper import scrape_contracts
    from app.services.bqms_won_quotations_sync import (
        upsert_won_from_contract_staging,
    )
    from app.services.samsung_session_lock import samsung_session_lock

    db_url = (
        str(settings.DATABASE_URL)
        .replace("+asyncpg", "")
        .replace("postgresql+asyncpg", "postgresql")
    )
    pool = await asyncpg.create_pool(db_url, min_size=1, max_size=2)

    out: dict[str, Any] = {"scrape_summary": {}, "upsert_summary": {}, "errors": []}

    try:
        # Cross-task ordering with push + periodic_scrape — first-acquire wins,
        # rest queue. Timeout = 10 min (contract drill ~1 min, push ~2 min).
        async with samsung_session_lock(
            pool, who=f"won_sync:rfq={rfq_number}", timeout_seconds=600,
        ):
            # scrape_contracts current signature (per bqms_contract_scraper.py):
            #   scrape_contracts(limit, drill_items, save_raw_json, db_pool)
            # We can't push a per-RFQ filter into the scraper yet (it pulls
            # the LIST page then drills). Workaround: drill the first page
            # so a recently-signed contract for `rfq_number` lands in
            # staging. Upsert then targets ALL pending staging rows — the
            # (rfq, bqms_code) WHERE filter in the upsert helper would be
            # ideal but isn't yet wired. For now we drain everything and
            # rely on UPSERT idempotency.
            #
            # Thang 2026-06-13 (BQMS polish 4): bumped limit 20 → 100 so a
            # 'won' RFQ whose contract sits deeper than the first page
            # isn't silently missed. Scrape cost scales linearly with the
            # drill count (~1s per item) so 100 ≈ ~1-2 min within the
            # 10-min Samsung lock budget.
            try:
                scr = await scrape_contracts(
                    limit=100,
                    drill_items=True,
                    save_raw_json=False,
                    db_pool=pool,
                )
                out["scrape_summary"] = {
                    "list_count": scr.get("list_count", 0),
                    "drilled_count": scr.get("drilled_count", 0),
                    "duration_seconds": scr.get("duration_seconds", 0),
                }
            except Exception as exc:
                logger.warning("scrape_contracts failed for %s: %s", rfq_number, exc)
                out["errors"].append(f"scrape: {str(exc)[:300]}")

        # Upsert happens OUTSIDE the Samsung lock — pure DB ops.
        try:
            upsert = await upsert_won_from_contract_staging(pool, limit=None)
            out["upsert_summary"] = upsert
        except Exception as exc:
            logger.warning("upsert_won failed for %s: %s", rfq_number, exc)
            out["errors"].append(f"upsert: {str(exc)[:300]}")

    finally:
        await pool.close()

    return out


# ---------------------------------------------------------------------------
# Thang 2026-06-13 (Bug fix T4): Global manual drain — same logic as the
# periodic task but UNGATED (the periodic flag is OFF by default). UI's
# "Cập nhật trúng" button dispatches this so user gets an instant drain
# without flipping the periodic flag.
# ---------------------------------------------------------------------------

@app.task(name="bqms_sync_won_for_all_pending", queue="bqms")
def bqms_sync_won_for_all_pending(
    user_id: str | None = None,
    timestamp: int = 0,
) -> dict[str, Any]:
    """Drain ALL pending rows from contract staging → bqms_won_quotations.

    Pure DB UPSERT — no Samsung scrape, no session lock contention.
    Idempotent: re-runs are safe.
    """
    started_at = datetime.now(timezone.utc)
    t0 = time.monotonic()
    logger.info("bqms_sync_won_for_all_pending: start (by=%s)", user_id)

    out: dict[str, Any] = {
        "started_at": started_at.isoformat(),
        "upsert_summary": {},
        "errors": [],
    }
    try:
        out.update(asyncio.run(_run_periodic()))
    except Exception as exc:
        logger.exception("bqms_sync_won_for_all_pending failed: %s", exc)
        out["errors"].append(str(exc)[:500])

    out["duration_seconds"] = round(time.monotonic() - t0, 2)
    _log_audit("__ALL__", user_id, out)
    logger.info(
        "bqms_sync_won_for_all_pending: done %.1fs %s",
        out["duration_seconds"], out.get("upsert_summary"),
    )
    return out


# ---------------------------------------------------------------------------
# Periodic backfill — drain contract staging hourly (idempotent, no scrape).
# ---------------------------------------------------------------------------

def _periodic_enabled() -> bool:
    """Check `app_config.bqms_won_sync_periodic_enabled` — default OFF."""
    try:
        with psycopg2.connect(SYNC_DSN) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT value FROM app_config "
                    "WHERE key = 'bqms_won_sync_periodic_enabled'"
                )
                row = cur.fetchone()
                if not row:
                    return False
                v = row[0]
                if isinstance(v, bool):
                    return v
                if isinstance(v, str):
                    return v.lower() in ("true", "1", "yes")
                return bool(v)
    except Exception as exc:
        logger.warning("_periodic_enabled check failed: %s — OFF", exc)
        return False


@app.periodic(cron="15 * * * *")
@app.task(name="bqms_won_sync_periodic", queue="bqms")
def bqms_won_sync_periodic(timestamp: int = 0) -> dict[str, Any]:
    """Hourly drain of contract staging → bqms_won_quotations.

    No Samsung scrape — pure DB upsert. Off by default; flip
    `app_config.bqms_won_sync_periodic_enabled=true` to enable.
    """
    if not _periodic_enabled():
        return {"status": "disabled", "skipped": True}

    started_at = datetime.now(timezone.utc)
    t0 = time.monotonic()
    logger.info("bqms_won_sync_periodic: start")

    out: dict[str, Any] = {"upsert_summary": {}, "errors": []}
    try:
        out.update(asyncio.run(_run_periodic()))
    except Exception as exc:
        logger.exception("bqms_won_sync_periodic failed: %s", exc)
        out["errors"].append(str(exc)[:500])

    out["started_at"] = started_at.isoformat()
    out["duration_seconds"] = round(time.monotonic() - t0, 2)
    logger.info("bqms_won_sync_periodic: done %.1fs %s",
                out["duration_seconds"], out.get("upsert_summary"))
    return out


async def _run_periodic() -> dict[str, Any]:
    import asyncpg
    from app.services.bqms_won_quotations_sync import (
        upsert_won_from_contract_staging,
    )

    db_url = (
        str(settings.DATABASE_URL)
        .replace("+asyncpg", "")
        .replace("postgresql+asyncpg", "postgresql")
    )
    pool = await asyncpg.create_pool(db_url, min_size=1, max_size=2)
    try:
        summary = await upsert_won_from_contract_staging(pool, limit=None)
        return {"upsert_summary": summary, "errors": []}
    finally:
        await pool.close()


# ---------------------------------------------------------------------------
# Audit log — sync helper (psycopg2 because Procrastinate worker is sync)
# ---------------------------------------------------------------------------

def _log_audit(rfq_number: str, user_id: str | None, result: dict[str, Any]) -> None:
    """Write audit_log row so the BQMS history drawer surfaces the refresh."""
    try:
        with psycopg2.connect(SYNC_DSN) as conn:
            with conn.cursor() as cur:
                # user_id may be None (cron) or UUID string (UI trigger).
                cur.execute(
                    """
                    INSERT INTO audit_log
                        (user_id, action, table_name, record_id, new_data, created_at)
                    VALUES (%s::uuid, 'bqms.won_sync.refresh', 'bqms_won_quotations',
                            %s, %s::jsonb, NOW())
                    """,
                    (
                        user_id if user_id else None,
                        rfq_number,
                        json.dumps(
                            {
                                "rfq_number": rfq_number,
                                "scrape_summary": result.get("scrape_summary"),
                                "upsert_summary": result.get("upsert_summary"),
                                "errors": result.get("errors"),
                                "duration_seconds": result.get("duration_seconds"),
                            },
                            default=str,
                        ),
                    ),
                )
                conn.commit()
    except Exception as exc:
        logger.warning("audit_log won_sync failed for %s: %s", rfq_number, exc)
