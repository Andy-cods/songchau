#!/usr/bin/env python3
"""
Song Châu ERP — Cài đặt schema Procrastinate + bảng ứng dụng.

Procrastinate cần các bảng riêng (procrastinate_jobs, procrastinate_periodic_defers,
procrastinate_events, v.v.) để hoạt động. Script này:

  1. Chạy Procrastinate CLI để tạo schema gốc
  2. Tạo bảng ứng dụng bổ sung (mv_refresh_log, bqms_samsung_po)
  3. Đăng ký periodic tasks

Chạy MỘT LẦN sau khi deploy database, TRƯỚC khi start worker.

Usage:
    python scripts/fix_procrastinate.py
    python scripts/fix_procrastinate.py --dsn postgresql://...
    python scripts/fix_procrastinate.py --skip-cli  # Chỉ chạy app DDL
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import os
import subprocess
import sys

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("fix_procrastinate")

# ---------------------------------------------------------------------------
# Database DSN
# ---------------------------------------------------------------------------

DSN = os.getenv(
    "DATABASE_URL",
    "postgresql://scadmin:SC2026_ERP_Pr0d_X9k2mQ7wR4@postgres:5432/songchau_erp",
)

# ---------------------------------------------------------------------------
# Application DDL — chạy SAU Procrastinate schema
# ---------------------------------------------------------------------------

APP_DDL = """
-- ═══════════════════════════════════════════════════════════════
-- Song Châu ERP — Bảng bổ sung cho Procrastinate tasks
-- ═══════════════════════════════════════════════════════════════

-- Log refresh materialized views (dùng bởi generate_daily_reports task)
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

-- Đảm bảo bảng bqms_samsung_po tồn tại
-- (có thể đã tạo bởi init.sql, nhưng đảm bảo an toàn)
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
# Procrastinate CLI schema
# ---------------------------------------------------------------------------

PROCRASTINATE_MANUAL_SQL = """
-- ═══════════════════════════════════════════════════════════════
-- Procrastinate schema — fallback nếu CLI không khả dụng
-- Dựa trên Procrastinate 2.14.0
-- ═══════════════════════════════════════════════════════════════

-- Queue registration
CREATE TABLE IF NOT EXISTS procrastinate_jobs (
    id              BIGSERIAL PRIMARY KEY,
    queue_name      TEXT NOT NULL DEFAULT 'default',
    task_name       TEXT NOT NULL,
    lock            TEXT,
    queueing_lock   TEXT,
    args            JSONB NOT NULL DEFAULT '{}'::jsonb,
    status          TEXT NOT NULL DEFAULT 'todo',
    scheduled_at    TIMESTAMPTZ,
    attempts        INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at      TIMESTAMPTZ,
    abort_requested BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS procrastinate_jobs_queue_name_idx
    ON procrastinate_jobs (queue_name);
CREATE INDEX IF NOT EXISTS procrastinate_jobs_task_name_idx
    ON procrastinate_jobs (task_name);
CREATE INDEX IF NOT EXISTS procrastinate_jobs_status_idx
    ON procrastinate_jobs (status);

-- Periodic defers tracking
CREATE TABLE IF NOT EXISTS procrastinate_periodic_defers (
    id              BIGSERIAL PRIMARY KEY,
    task_name       TEXT NOT NULL,
    defer_timestamp BIGINT,
    job_id          BIGINT REFERENCES procrastinate_jobs(id),
    queue_name      TEXT,
    CONSTRAINT procrastinate_periodic_defers_unique
        UNIQUE (task_name, defer_timestamp, queue_name)
);

-- Events log
CREATE TABLE IF NOT EXISTS procrastinate_events (
    id          BIGSERIAL PRIMARY KEY,
    job_id      BIGINT NOT NULL,
    type        TEXT NOT NULL,
    at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS procrastinate_events_job_id_idx
    ON procrastinate_events (job_id);
"""


def run_procrastinate_cli() -> bool:
    """
    Chạy Procrastinate CLI để tạo schema.
    Returns True nếu thành công, False nếu thất bại.
    """
    logger.info("Bước 1: Chạy Procrastinate CLI để tạo schema gốc...")

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
            timeout=30,
            cwd=os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        )

        if result.returncode == 0:
            logger.info("  CLI thành công: %s", result.stdout.strip() or "(no output)")
            return True
        else:
            logger.warning(
                "  CLI thất bại (exit %d): %s",
                result.returncode,
                result.stderr.strip(),
            )
            return False

    except FileNotFoundError:
        logger.warning("  Procrastinate CLI không tìm thấy — sẽ dùng SQL thủ công.")
        return False
    except subprocess.TimeoutExpired:
        logger.warning("  CLI timeout sau 30 giây.")
        return False
    except Exception as e:
        logger.warning("  CLI lỗi: %s", e)
        return False


async def apply_sql(conn, sql: str, label: str) -> None:
    """Chạy SQL DDL."""
    logger.info("Áp dụng: %s...", label)
    try:
        await conn.execute(sql)
        logger.info("  Thành công: %s", label)
    except Exception as e:
        logger.error("  Lỗi %s: %s", label, e)
        raise


async def verify_tables(conn) -> None:
    """Kiểm tra các bảng Procrastinate đã tồn tại."""
    logger.info("Kiểm tra bảng Procrastinate...")

    required_tables = [
        "procrastinate_jobs",
        "procrastinate_periodic_defers",
        "procrastinate_events",
        "mv_refresh_log",
    ]

    for table in required_tables:
        row = await conn.fetchrow(
            """
            SELECT EXISTS (
                SELECT FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = $1
            )
            """,
            table,
        )
        exists = row["exists"] if row else False
        status = "OK" if exists else "THIẾU"
        logger.info("  %-40s [%s]", table, status)

        if not exists:
            logger.error("Bảng '%s' không tồn tại sau khi setup!", table)


async def main(skip_cli: bool = False) -> None:
    """Setup Procrastinate schema + app DDL."""

    import asyncpg

    logger.info("=" * 60)
    logger.info("SONG CHÂU ERP — SETUP PROCRASTINATE SCHEMA")
    logger.info("=" * 60)
    logger.info("DSN: %s", DSN.split("@")[-1])
    logger.info("-" * 60)

    # Bước 1: Procrastinate CLI
    cli_success = False
    if not skip_cli:
        cli_success = run_procrastinate_cli()

    # Kết nối database
    try:
        conn = await asyncpg.connect(DSN)
        logger.info("Kết nối database thành công.")
    except Exception as e:
        logger.error("Không thể kết nối database: %s", e)
        sys.exit(1)

    try:
        # Nếu CLI thất bại, tạo schema thủ công
        if not cli_success:
            logger.info("")
            logger.info("Bước 1b: Tạo Procrastinate schema thủ công (SQL)...")
            await apply_sql(conn, PROCRASTINATE_MANUAL_SQL, "Procrastinate schema (manual)")

        # Bước 2: App DDL
        logger.info("")
        logger.info("Bước 2: Tạo bảng ứng dụng bổ sung...")
        await apply_sql(conn, APP_DDL, "Application DDL")

        # Bước 3: Verify
        logger.info("")
        await verify_tables(conn)

    finally:
        await conn.close()
        logger.info("Đã đóng kết nối database.")

    logger.info("")
    logger.info("=" * 60)
    logger.info("SETUP PROCRASTINATE HOÀN TẤT")
    logger.info("=" * 60)
    logger.info("Tiếp theo: chạy worker bằng lệnh:")
    logger.info("  procrastinate --app app.core.procrastinate_app.app worker")
    logger.info("=" * 60)


def cli() -> None:
    parser = argparse.ArgumentParser(
        description="Song Châu ERP — Setup Procrastinate schema",
    )
    parser.add_argument(
        "--skip-cli",
        action="store_true",
        help="Bỏ qua Procrastinate CLI, chỉ dùng SQL thủ công",
    )
    parser.add_argument(
        "--dsn",
        default=None,
        help="Override DSN kết nối database",
    )

    args = parser.parse_args()

    if args.dsn:
        global DSN
        DSN = args.dsn

    asyncio.run(main(skip_cli=args.skip_cli))


if __name__ == "__main__":
    cli()
