"""
Audit-Log Retention Task — daily prune of transient + audit tables.

Schedule
--------
@app.periodic(cron="0 2 * * *")  # 02:00 ICT every day (off-peak)

Policies (kept in one place — see also docs/audit-retention.md)
---------------------------------------------------------------
1. notifications
   - DELETE rows older than 90 days (regardless of is_read).
   - Rationale: notifications are transient UI hints; the underlying
     event (workflow, leave, sourcing order) keeps its own audit trail.

2. sourcing_order_status_history
   - Keep last 2 years online.
   - Archive older rows into sourcing_order_status_history_archive
     (created on first run via CREATE TABLE … LIKE … INCLUDING ALL).
   - Hot table stays small; archive table is read-rare, suitable for
     pg_dump backups + eventual cold storage.

3. sourcing_supplier_prices.*_by_email audit columns
   - NOT pruned (column-level forensic data tied to live rows).
   - When a supplier_price row is hard-deleted, audit goes with it.

4. procrastinate_jobs
   - DELETE rows where status='succeeded' AND finished_at < NOW() - 30d.
   - Procrastinate does NOT ship a built-in periodic prune task by
     default; the documented `builtin_tasks.remove_old_jobs` exists
     but must be explicitly scheduled. We do that here in one place so
     all retention is co-located.
   - 'failed' jobs are KEPT for post-mortem (manual purge via SQL).

Idempotency
-----------
- Pure DELETE / INSERT…SELECT with WHERE clauses — running twice is a
  no-op on the second run.
- Wrapped in a single connection; each policy commits independently so
  a failure in one does not block the others.

Manual run
----------
    docker exec sc-worker python -c \
        "from app.tasks.audit_retention import prune_audit_logs; \
         print(prune_audit_logs(timestamp=0))"
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

import psycopg2
import psycopg2.extras

from app.core.procrastinate_app import app, SYNC_DSN

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Retention windows (single source of truth — keep in sync with docs)
# ---------------------------------------------------------------------------

NOTIFICATIONS_RETAIN_DAYS               = 90
SOURCING_HISTORY_RETAIN_DAYS            = 365 * 2     # 2 years online
PROCRASTINATE_SUCCEEDED_RETAIN_DAYS     = 30


# ---------------------------------------------------------------------------
# Task entry point
# ---------------------------------------------------------------------------

@app.periodic(cron="0 2 * * *")  # 02:00 UTC ≈ 09:00 ICT — off-peak
@app.task(name="prune_audit_logs", queue="maintenance")
def prune_audit_logs(timestamp: int = 0) -> dict[str, Any]:  # type: ignore[misc]
    """Run all retention policies and return counts deleted/archived."""
    started = datetime.now(timezone.utc)
    logger.info("prune_audit_logs: start (utc=%s)", started.isoformat())

    result: dict[str, Any] = {"started_at": started.isoformat()}

    conn = psycopg2.connect(SYNC_DSN)
    try:
        result["notifications_deleted"]      = _prune_notifications(conn)
        result["sourcing_history_archived"]  = _archive_sourcing_history(conn)
        result["procrastinate_jobs_deleted"] = _prune_procrastinate_jobs(conn)
    finally:
        conn.close()

    result["finished_at"] = datetime.now(timezone.utc).isoformat()
    logger.info("prune_audit_logs: done %s", result)
    return result


# ---------------------------------------------------------------------------
# Policy 1 — notifications
# ---------------------------------------------------------------------------

def _prune_notifications(conn: psycopg2.extensions.connection) -> int:
    """DELETE notifications older than NOTIFICATIONS_RETAIN_DAYS."""
    sql = """
        DELETE FROM notifications
        WHERE created_at < NOW() - INTERVAL '%s days'
    """
    try:
        with conn:
            with conn.cursor() as cur:
                cur.execute(sql % NOTIFICATIONS_RETAIN_DAYS)
                count = cur.rowcount
        logger.info("notifications: deleted %d rows older than %d days",
                    count, NOTIFICATIONS_RETAIN_DAYS)
        return count
    except Exception as exc:
        logger.error("notifications prune failed: %s", exc)
        return -1


# ---------------------------------------------------------------------------
# Policy 2 — sourcing_order_status_history (archive then delete)
# ---------------------------------------------------------------------------

def _archive_sourcing_history(conn: psycopg2.extensions.connection) -> int:
    """Move rows older than 2 years into sourcing_order_status_history_archive."""
    try:
        with conn:
            with conn.cursor() as cur:
                # 1. Create archive table on first run (LIKE … INCLUDING ALL
                #    copies columns, defaults, NOT NULLs; we skip indexes to
                #    keep writes cheap).
                cur.execute("""
                    CREATE TABLE IF NOT EXISTS sourcing_order_status_history_archive
                        (LIKE sourcing_order_status_history INCLUDING DEFAULTS);
                """)

                # 2. Move (INSERT…SELECT then DELETE) in one tx so no row is
                #    lost if a crash occurs mid-archive.
                cur.execute("""
                    WITH moved AS (
                        DELETE FROM sourcing_order_status_history
                        WHERE at < NOW() - INTERVAL '%s days'
                        RETURNING *
                    )
                    INSERT INTO sourcing_order_status_history_archive
                    SELECT * FROM moved;
                """ % SOURCING_HISTORY_RETAIN_DAYS)
                count = cur.rowcount
        logger.info("sourcing_order_status_history: archived %d rows older than %d days",
                    count, SOURCING_HISTORY_RETAIN_DAYS)
        return count
    except Exception as exc:
        logger.error("sourcing_order_status_history archive failed: %s", exc)
        return -1


# ---------------------------------------------------------------------------
# Policy 3 — procrastinate_jobs
# ---------------------------------------------------------------------------

def _prune_procrastinate_jobs(conn: psycopg2.extensions.connection) -> int:
    """
    DELETE procrastinate_jobs where status='succeeded' AND aged > 30 days.

    We deliberately do NOT touch status='failed' rows — those are kept
    forever for debugging until manually purged.

    procrastinate_events (the per-job event stream) has ON DELETE CASCADE
    from procrastinate_jobs.id, so this prune naturally trims events too.
    """
    sql = """
        DELETE FROM procrastinate_jobs
        WHERE status = 'succeeded'
          AND COALESCE(
                  (SELECT MAX(at) FROM procrastinate_events e WHERE e.job_id = procrastinate_jobs.id),
                  procrastinate_jobs.scheduled_at
              ) < NOW() - INTERVAL '%s days'
    """
    try:
        with conn:
            with conn.cursor() as cur:
                cur.execute(sql % PROCRASTINATE_SUCCEEDED_RETAIN_DAYS)
                count = cur.rowcount
        logger.info("procrastinate_jobs: deleted %d succeeded rows older than %d days",
                    count, PROCRASTINATE_SUCCEEDED_RETAIN_DAYS)
        return count
    except Exception as exc:
        logger.error("procrastinate_jobs prune failed: %s", exc)
        return -1
