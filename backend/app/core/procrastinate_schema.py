"""
Procrastinate schema setup — creates / migrates all required database tables.

Run this once during initial deployment (or after upgrading Procrastinate)
before starting any workers or scheduling tasks.

Usage
-----
    # From the backend container or local virtualenv:
    python -m app.core.procrastinate_schema

    # Or, equivalently, using the Procrastinate CLI directly:
    procrastinate --app app.core.procrastinate_app.app schema --apply

The script also creates the application-specific mv_refresh_log table used by
the report-generation task to record materialized-view refresh history.
"""

from __future__ import annotations

import logging
import subprocess
import sys

import psycopg2

from app.core.procrastinate_app import SYNC_DSN

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Application-specific DDL (run AFTER Procrastinate schema)
# ---------------------------------------------------------------------------

_APP_DDL = """
-- Materialized-view refresh log (used by generate_daily_reports task)
CREATE TABLE IF NOT EXISTS mv_refresh_log (
    id           BIGSERIAL PRIMARY KEY,
    view_name    TEXT        NOT NULL,
    refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    duration_ms  INTEGER,
    row_count    BIGINT,
    error        TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mv_refresh_log_view_name
    ON mv_refresh_log (view_name, refreshed_at DESC);

-- BQMS Samsung PO table (upserted by bqms_nightly_sync task)
CREATE TABLE IF NOT EXISTS bqms_samsung_po (
    id           BIGSERIAL PRIMARY KEY,
    po_number    TEXT        NOT NULL UNIQUE,
    supplier_name TEXT,
    total_amount  NUMERIC(18, 2),
    po_date       DATE,
    status        TEXT        NOT NULL DEFAULT 'pending',
    pdf_path      TEXT,
    raw_data      JSONB,
    synced_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bqms_samsung_po_status
    ON bqms_samsung_po (status);

CREATE INDEX IF NOT EXISTS idx_bqms_samsung_po_synced_at
    ON bqms_samsung_po (synced_at DESC);
"""


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def setup_procrastinate_schema(*, apply_app_ddl: bool = True) -> None:
    """
    Create all Procrastinate tables in the database, then apply application-
    specific DDL.

    Parameters
    ----------
    apply_app_ddl : If True (default) also run _APP_DDL after Procrastinate
                    schema is applied.
    """
    logger.info("setup_procrastinate_schema: applying Procrastinate schema …")

    # -----------------------------------------------------------------------
    # Step 1 — Let Procrastinate create its own tables via the CLI.
    # Using the CLI ensures we always apply the correct migration for the
    # installed version.
    # -----------------------------------------------------------------------
    cmd = [
        sys.executable, "-m", "procrastinate",
        "--app", "app.core.procrastinate_app.app",
        "schema", "--apply",
    ]

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            check=True,
        )
        logger.info("setup_procrastinate_schema: CLI output: %s", result.stdout.strip())
    except subprocess.CalledProcessError as exc:
        logger.error(
            "setup_procrastinate_schema: CLI failed (exit %d):\n%s\n%s",
            exc.returncode, exc.stdout, exc.stderr,
        )
        raise RuntimeError("Procrastinate schema application failed") from exc

    # -----------------------------------------------------------------------
    # Step 2 — Apply application-specific DDL
    # -----------------------------------------------------------------------
    if apply_app_ddl:
        logger.info("setup_procrastinate_schema: applying application DDL …")
        conn = psycopg2.connect(SYNC_DSN)
        try:
            with conn:
                with conn.cursor() as cur:
                    cur.execute(_APP_DDL)
            logger.info("setup_procrastinate_schema: application DDL applied successfully")
        except Exception as exc:
            logger.error("setup_procrastinate_schema: application DDL failed: %s", exc)
            raise
        finally:
            conn.close()

    logger.info("setup_procrastinate_schema: all done")


# ---------------------------------------------------------------------------
# Allow running as a script: python -m app.core.procrastinate_schema
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    setup_procrastinate_schema()
