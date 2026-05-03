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
    'bqms_rfq': [
        'Puplic/BQMS/Thong ke hoi hang BQMS.xlsx',
    ],
    'bqms_deliveries': [
        'Puplic/BQMS/Thong ke giao hang/Thong ke giao hang 2026.xlsx',
        'Puplic/BQMS/Thong ke giao hang/Thong ke giao hang 2025.xlsx',
        'Puplic/BQMS/Thong ke giao hang/Thong ke giao hang 2023-2024.xlsx',
    ],
}


@app.periodic(cron='*/2 * * * *')
@app.task(name='bqms_excel_auto_import', queue='etl')
def bqms_excel_auto_import(timestamp: int = 0) -> dict[str, Any]:
    """Detect changed BQMS Excel files in staging and trigger import_precise."""
    started = datetime.now(timezone.utc)
    t0 = time.monotonic()
    logger.info('bqms_excel_auto_import: starting (utc=%s)', started.isoformat())

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

    conn = psycopg2.connect(SYNC_DSN)
    try:
        for table, rel_files in GROUPS.items():
            try:
                _process_group(conn, table, rel_files, result)
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
) -> None:
    """For a (table, files) group, decide if we need to re-import + do it."""
    needs_import = False
    file_states: list[tuple[str, datetime, datetime | None]] = []

    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        for rel in rel_files:
            full = STAGING_ROOT / rel
            if not full.exists():
                logger.debug('  missing: %s', rel)
                result['missing'].append(rel)
                continue

            file_mtime = datetime.fromtimestamp(full.stat().st_mtime, tz=timezone.utc)

            # file_review_status uses basename (matches existing manual-import rows)
            basename = full.name
            cur.execute(
                "SELECT reviewed_at FROM file_review_status WHERE file_path = %s",
                (basename,),
            )
            row = cur.fetchone()
            last_import: datetime | None = row['reviewed_at'] if row else None

            file_states.append((basename, file_mtime, last_import))

            if last_import is None or last_import < file_mtime:
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
    """Best-effort: extract inserted count from import_precise stdout."""
    # import_precise prints lines like:
    #   "Total: 6543 inserted, 12 skipped"
    m = re.search(r'(\d+)\s+insert', stdout, re.IGNORECASE)
    if m:
        return int(m.group(1))
    return 0


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
