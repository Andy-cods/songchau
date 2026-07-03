"""Watchdog: detect + fail dossier jobs with stale heartbeat.

A job that goes 'running' but stops updating last_heartbeat_at for > 5 min
is considered crashed (worker died, network stuck, etc.). Watchdog marks it
'failed' so user knows + queue moves on.

Runs every 2 minutes via Procrastinate cron.
"""
from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from typing import Any

import psycopg2

from app.core.procrastinate_app import app, SYNC_DSN

logger = logging.getLogger(__name__)


@app.periodic(cron="*/2 * * * *")  # every 2 minutes
@app.task(name="bqms_dossier_watchdog", queue="default", queueing_lock="bqms_dossier_watchdog")
def bqms_dossier_watchdog(timestamp: int = 0) -> dict[str, Any]:
    """Mark stuck jobs as failed. Returns stats."""
    stats = {"checked": 0, "killed": 0, "errors": 0}
    try:
        with psycopg2.connect(SYNC_DSN, connect_timeout=5) as conn:
            with conn.cursor() as cur:
                # Find jobs running but with no heartbeat for >5 min
                cur.execute(
                    """
                    SELECT id, progress_step, EXTRACT(EPOCH FROM (NOW() - last_heartbeat_at)) AS age_sec
                      FROM bqms_dossier_jobs
                     WHERE status = 'running'
                       AND last_heartbeat_at IS NOT NULL
                       AND last_heartbeat_at < NOW() - INTERVAL '5 minutes'
                    """,
                )
                stuck = cur.fetchall()
                stats["checked"] = len(stuck)

                if stuck:
                    for job_id, step, age_sec in stuck:
                        try:
                            cur.execute(
                                """
                                UPDATE bqms_dossier_jobs
                                   SET status = 'failed',
                                       error = $1,
                                       finished_at = NOW()
                                 WHERE id = $2 AND status = 'running'
                                """.replace("$1", "%s").replace("$2", "%s"),
                                (
                                    f"Watchdog: stale heartbeat ({int(age_sec)}s > 300s). "
                                    f"Last step: {step or 'unknown'}",
                                    job_id,
                                ),
                            )
                            stats["killed"] += 1
                            logger.warning(
                                "Watchdog killed stuck dossier job %d (age %ds)", job_id, int(age_sec),
                            )
                        except Exception as exc:
                            logger.error("Failed to kill job %d: %s", job_id, exc)
                            stats["errors"] += 1
                    conn.commit()
    except Exception as exc:
        logger.exception("Watchdog top-level fail")
        stats["errors"] += 1
        stats["db_error"] = str(exc)[:200]

    if stats["checked"] or stats["killed"]:
        logger.info("dossier_watchdog: %s", stats)
    return stats
