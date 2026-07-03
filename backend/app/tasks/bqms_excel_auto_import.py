"""BQMS Excel auto-import — runs every 2 minutes.

Watches the 4 BQMS Excel files in /data/onedrive-staging that the
SFTP watcher pushes from Thang's local OneDrive. When any file is
newer than its last_import_at recorded in file_review_status, the
task triggers `import_precise.py --table <target_table>`.

Files watched (paths relative to /data/onedrive-staging):
    Puplic/BQMS/Thong ke hoi hang BQMS.xlsx              -> bqms_rfq
    Puplic/BQMS/Thong ke giao hang/Thong ke giao hang 2026.xlsx     -> bqms_deliveries
    Puplic/BQMS/Thong ke giao hang/Thong ke giao hang 2025.xlsx     -> bqms_deliveries
    Puplic/BQMS/Thong ke giao hang/Thong ke giao hang 2023-2024.xlsx -> bqms_deliveries

Idempotent: re-runs are safe. UPSERT in import_precise.py prevents duplicates.
"""

from __future__ import annotations

import logging
import re
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import psycopg2
import psycopg2.extras

from app.core.procrastinate_app import app, SYNC_DSN

logger = logging.getLogger(__name__)

STAGING_ROOT = Path('/data/onedrive-staging')
IMPORT_SCRIPT = '/app/scripts/import_precise.py'
IMPORT_CWD = '/app'
IMPORT_TIMEOUT = 600  # seconds; full bqms_rfq import on ~7k rows is ~30s

# Group files by target table — import_precise reads ALL files for a table in
# one call, so we collapse the deliveries trio to a single subprocess run.
GROUPS: dict[str, list[str]] = {
    # Per user 2026-05-18 (Thang): DISABLED bqms_rfq auto-import.
    # ERP is now the source-of-truth for RFQ data (see TH1/TH2/TH3 policy in
    # bqms_quote_scenario.py). New RFQs come from BQMS portal scrape only —
    # auto-importing Excel would overwrite ERP-side edits + V1 prices.
    # 'bqms_rfq': [
    #     'Puplic/BQMS/Thong ke hoi hang BQMS.xlsx',
    # ],
    # Per user 2026-05-04: only ingest deliveries from 2026 onward.
    # Old 2023-2024 + 2025 files are kept on disk but no longer
    # auto-imported. Historical data archived to
    # bqms_deliveries_archive_pre2026.
    #
    # Thang 2026-06-01: KEEP ONLY bqms_deliveries (báo cáo doanh thu hàng ngày).
    # bqms_won_quotations + các nguồn khác DISABLED — user chỉ muốn auto-import
    # phần Báo cáo, không động vào dữ liệu Trúng BG / RFQ khác.
    'bqms_deliveries': [
        'Puplic/BQMS/Thong ke giao hang/Thong ke giao hang 2026.xlsx',
    ],
    # 'bqms_won_quotations' DISABLED 2026-06-01 per Thang — không auto-import
    # sheet TRUNG BG nữa. Khi user muốn cập nhật, làm thủ công qua
    # admin/migration hoặc import_precise CLI.
    # 'bqms_won_quotations': [
    #     'Puplic/BQMS/Thong ke hoi hang BQMS.xlsx',
    # ],
}


@app.periodic(cron='*/2 * * * *')
@app.task(name='bqms_excel_auto_import', queue='etl')
def bqms_excel_auto_import(timestamp: int = 0, force: bool = False) -> dict[str, Any]:
    """Detect changed BQMS Excel files in staging and trigger import_precise.

    force=True: bỏ qua mtime check + bỏ qua flag check → luôn re-import.
    Dùng bởi endpoint /daily-report/force-import khi user bấm "Import lại ngay".
    """
    started = datetime.now(timezone.utc)
    t0 = time.monotonic()
    logger.info('bqms_excel_auto_import: starting (utc=%s, force=%s)', started.isoformat(), force)

    result: dict[str, Any] = {
        'imported': [],   # [(table, files, inserted)]
        'unchanged': [],  # [table]
        'missing': [],    # [rel_path]
        'errors': [],     # [(table, error)]
    }

    if not STAGING_ROOT.exists():
        logger.warning('staging root missing: %s', STAGING_ROOT)
        result['errors'].append(('_setup', f'staging missing: {STAGING_ROOT}'))
        return result

    # Phase E2 (Thang 2026-05-12): Honor app_config.bqms_excel_auto_import_enabled
    # flag — when false, skip entirely. Allows user to wipe data without it
    # being re-imported every 2 min from OneDrive Thong ke hoi hang BQMS.xlsx.
    # force=True bypass flag (user explicit click "Import lại ngay").
    if not force:
        try:
            _flag_conn = psycopg2.connect(SYNC_DSN)
            with _flag_conn.cursor() as _cur:
                _cur.execute(
                    "SELECT value FROM app_config WHERE key='bqms_excel_auto_import_enabled' LIMIT 1"
                )
                _row = _cur.fetchone()
                if _row is not None:
                    _val = str(_row[0]).strip().lower().strip('"')
                    if _val in ('false', '0', 'no', 'off'):
                        logger.info('bqms_excel_auto_import: SKIPPED (flag=false)')
                        _flag_conn.close()
                        result['errors'].append(('_flag', 'disabled by app_config'))
                        return result
            _flag_conn.close()
        except Exception as _flag_exc:
            logger.warning('flag check failed: %s', _flag_exc)

    conn = psycopg2.connect(SYNC_DSN)
    try:
        for table, rel_files in GROUPS.items():
            try:
                _process_group(conn, table, rel_files, result, force=force)
            except Exception as exc:
                logger.exception('group %s failed: %s', table, exc)
                result['errors'].append((table, str(exc)[:300]))
    finally:
        conn.close()

    duration = round(time.monotonic() - t0, 2)
    logger.info(
        'bqms_excel_auto_import: done imported=%d unchanged=%d missing=%d errors=%d in %ss',
        len(result['imported']), len(result['unchanged']),
        len(result['missing']), len(result['errors']), duration,
    )
    return result


def _process_group(
    conn: psycopg2.extensions.connection,
    table: str,
    rel_files: list[str],
    result: dict[str, Any],
    force: bool = False,
) -> None:
    """For a (table, files) group, decide if we need to re-import + do it.

    force=True: bỏ qua mtime check → luôn re-import bất kể file đã thay đổi
    hay chưa. Dùng khi user bấm "Import lại ngay" trên UI.
    """
    needs_import = bool(force)
    file_states: list[tuple[str, datetime, datetime | None]] = []

    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        # Per-table last successful run from etl_sync_log. Avoids the bug
        # where two groups share the same file but only the FIRST one
        # imports because file_review_status is per-file (not per-table).
        cur.execute(
            """
            SELECT MAX(completed_at) FROM etl_sync_log
            WHERE sync_type = %s AND status = 'success'
            """,
            (f'auto_import_{table}',),
        )
        row = cur.fetchone()
        last_table_run: datetime | None = row['max'] if row else None

        for rel in rel_files:
            full = STAGING_ROOT / rel
            if not full.exists():
                logger.debug('  missing: %s', rel)
                result['missing'].append(rel)
                continue

            file_mtime = datetime.fromtimestamp(full.stat().st_mtime, tz=timezone.utc)
            basename = full.name
            file_states.append((basename, file_mtime, last_table_run))

            if last_table_run is None or last_table_run < file_mtime:
                needs_import = True

    if not file_states:
        # All files missing — nothing to do
        result['unchanged'].append(table)
        return

    if not needs_import:
        result['unchanged'].append(table)
        return

    # ── Run import_precise.py ──────────────────────────────────────────
    sync_log_id = _create_sync_log(conn, table, rel_files)
    logger.info('  importing %s (sync_log_id=%s)', table, sync_log_id)

    proc = subprocess.run(
        ['python', IMPORT_SCRIPT, '--source', str(STAGING_ROOT / 'Puplic' / 'BQMS'),
         '--table', table],
        capture_output=True, text=True, timeout=IMPORT_TIMEOUT, cwd=IMPORT_CWD,
    )

    inserted = _parse_inserted(proc.stdout or '')
    success = (proc.returncode == 0)
    err_msg = (proc.stderr or '')[-500:] if not success else None

    _update_sync_log(conn, sync_log_id, success, inserted, err_msg)

    # Update file_review_status for every present file in the group.
    # Note: file_states[i][0] is the basename (matches existing manual-import rows).
    with conn.cursor() as cur:
        for basename, file_mtime, _ in file_states:
            cur.execute(
                """INSERT INTO file_review_status (file_path, status, reviewed_at, last_import_result)
                   VALUES (%s, %s, %s, %s::jsonb)
                   ON CONFLICT (file_path) DO UPDATE SET
                       status = EXCLUDED.status,
                       reviewed_at = EXCLUDED.reviewed_at,
                       last_import_result = EXCLUDED.last_import_result,
                       updated_at = NOW()""",
                (
                    basename,
                    'imported' if success else 'error',
                    file_mtime,
                    psycopg2.extras.Json({
                        'inserted': inserted,
                        'sync_log_id': sync_log_id,
                        'auto': True,
                        'returncode': proc.returncode,
                    }),
                ),
            )
    conn.commit()

    if success:
        result['imported'].append((table, rel_files, inserted))
        logger.info('  -> %s ok: %d rows inserted', table, inserted)
    else:
        result['errors'].append((table, err_msg or f'returncode={proc.returncode}'))
        logger.warning('  -> %s failed: %s', table, err_msg)


def _parse_inserted(stdout: str) -> int:
    """Extract INSERT + UPDATE count from import_precise summary table.

    import_precise prints a summary like:
        TABLE                          INSERT   UPDATE     SKIP    ERROR
        ------------------------------------------------------------------
        bqms_deliveries                   135      207        0        0
        ------------------------------------------------------------------
        TOTAL                             135      207        0        0

    Trả về INSERT+UPDATE để user thấy số row thực sự đã được động (cả mới
    + đã cập nhật). Trước đây chỉ match "insert" regex → luôn = 0.
    """
    m = re.search(r'TOTAL\s+(\d+)\s+(\d+)\s+\d+\s+\d+', stdout)
    if m:
        return int(m.group(1)) + int(m.group(2))
    # Fallback (older format): just count first "N insert" if any
    m = re.search(r'(\d+)\s+insert', stdout, re.IGNORECASE)
    return int(m.group(1)) if m else 0


def _create_sync_log(
    conn: psycopg2.extensions.connection,
    table: str,
    rel_files: list[str],
) -> int | None:
    try:
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO etl_sync_log (sync_type, status, started_at, source_file)
                   VALUES (%s, 'running', NOW(), %s)
                   RETURNING id""",
                (f'auto_import_{table}', ','.join(rel_files)[:500]),
            )
            row = cur.fetchone()
            conn.commit()
            return row[0] if row else None
    except Exception as exc:
        logger.warning('_create_sync_log: %s', exc)
        return None


def _update_sync_log(
    conn: psycopg2.extensions.connection,
    sync_id: int | None,
    success: bool,
    inserted: int,
    err_msg: str | None,
) -> None:
    if not sync_id:
        return
    try:
        with conn.cursor() as cur:
            cur.execute(
                """UPDATE etl_sync_log SET
                       status = %s,
                       completed_at = NOW(),
                       rows_inserted = %s,
                       error_message = %s
                   WHERE id = %s""",
                ('success' if success else 'error', inserted, err_msg, sync_id),
            )
            conn.commit()
    except Exception as exc:
        logger.warning('_update_sync_log: %s', exc)
