"""
Procrastinate tasks for M08: Scheduled Report Generation.

Periodic tasks that check scheduled_reports and generate + email reports.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

import psycopg

from app.core.procrastinate_app import app, SYNC_DSN

logger = logging.getLogger(__name__)


@app.periodic(cron="0 7 * * *")  # Daily at 07:00 UTC+7
@app.task(name="generate_scheduled_reports", queue="reports")
def generate_scheduled_reports(timestamp: int = 0) -> dict[str, Any]:
    """Check for due scheduled reports and generate them."""
    import asyncio

    async def _run():
        import asyncpg as apg
        from app.core.config import settings

        dsn = (
            f"postgresql://{settings.POSTGRES_USER}:{settings.POSTGRES_PASSWORD}"
            f"@postgres:5432/{settings.POSTGRES_DB}"
        )
        conn = await apg.connect(dsn)

        try:
            # Find active schedules that need to run
            schedules = await conn.fetch(
                """
                SELECT * FROM scheduled_reports
                WHERE is_active = true
                  AND (last_run_at IS NULL OR last_run_at < NOW() - interval '23 hours')
                ORDER BY id
                """
            )

            results = []
            for schedule in schedules:
                schedule_dict = dict(schedule)
                try:
                    from app.services.report_scheduler import generate_report, send_report_email

                    # Create execution record
                    exec_id = await conn.fetchval(
                        """
                        INSERT INTO report_executions (schedule_id, report_type, status, started_at)
                        VALUES ($1, $2, 'running', NOW())
                        RETURNING id
                        """,
                        schedule["id"], schedule["report_type"],
                    )

                    # Generate
                    report_result = await generate_report(conn, schedule_dict)

                    # Send email
                    email_sent = await send_report_email(conn, schedule_dict, report_result)

                    # Update execution
                    await conn.execute(
                        """
                        UPDATE report_executions
                        SET status = 'completed', completed_at = NOW(), file_path = $2
                        WHERE id = $1
                        """,
                        exec_id, report_result.get("file_path"),
                    )

                    await conn.execute(
                        "UPDATE scheduled_reports SET last_run_at = NOW() WHERE id = $1",
                        schedule["id"],
                    )

                    results.append({
                        "schedule_id": schedule["id"],
                        "status": "completed",
                        "email_sent": email_sent,
                    })

                except Exception as exc:
                    logger.error("Report generation failed for schedule %d: %s", schedule["id"], exc)
                    results.append({
                        "schedule_id": schedule["id"],
                        "status": "failed",
                        "error": str(exc),
                    })

            return {"generated": len(results), "results": results}

        finally:
            await conn.close()

    return asyncio.run(_run())
