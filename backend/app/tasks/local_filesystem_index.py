"""Local filesystem indexer — walks the OneDrive staging mount and upserts
metadata into onedrive_file_index.

Why this exists:
  M365 Graph API credentials are empty in production; the user pushes
  files to /data/onedrive-staging via SFTP. The previous crawler only
  worked through Graph and produced 0 rows. This task scans the actual
  filesystem so the Documents browser, search, and "freshness" indicator
  reflect reality.

Runs every 15 minutes. Idempotent: re-runs are safe.
"""

from __future__ import annotations

import hashlib
import logging
import mimetypes
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import psycopg2
import psycopg2.extras

from app.core.procrastinate_app import app, SYNC_DSN

logger = logging.getLogger(__name__)

STAGING_ROOT = Path('/data/onedrive-staging')
BATCH_SIZE = 500
SKIP_DIRS = {'.git', '__pycache__', '.cache', 'node_modules'}
SKIP_FILE_PREFIXES = ('~$', '.DS_Store', 'Thumbs.db')


def _stable_id(rel_path: str) -> str:
    """Stable graph_item_id for a local file — unique per path."""
    return 'local:' + hashlib.sha1(rel_path.encode('utf-8')).hexdigest()[:32]


def _ext_of(name: str) -> str | None:
    if '.' not in name:
        return None
    return name.rsplit('.', 1)[1].lower()


@app.periodic(cron='*/15 * * * *')
@app.task(name='local_filesystem_index', queue='etl')
def local_filesystem_index(timestamp: int = 0) -> dict[str, Any]:
    """Scan /data/onedrive-staging recursively and upsert file metadata."""
    started_at = datetime.now(timezone.utc)
    logger.info('local_filesystem_index: starting')

    result: dict[str, Any] = {
        'files_indexed': 0,
        'folders_indexed': 0,
        'items_deleted': 0,
        'errors': 0,
        'duration_seconds': 0.0,
    }
    t0 = time.monotonic()
    sync_log_id = None

    if not STAGING_ROOT.exists():
        logger.warning('local_filesystem_index: staging root missing %s', STAGING_ROOT)
        result['errors'] = 1
        result['error_message'] = f'Staging root missing: {STAGING_ROOT}'
        return result

    try:
        sync_log_id = _create_sync_log(started_at)
        seen_ids: set[str] = set()
        batch: list[tuple] = []

        conn = psycopg2.connect(SYNC_DSN)
        try:
            with conn:
                with conn.cursor() as cur:
                    for dirpath, dirnames, filenames in os.walk(STAGING_ROOT):
                        # Skip junk dirs
                        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
                        rel_dir = os.path.relpath(dirpath, STAGING_ROOT)
                        if rel_dir == '.':
                            rel_dir = ''

                        # Index this folder itself (skip root)
                        if rel_dir:
                            folder_path = '/' + rel_dir.replace(os.sep, '/')
                            folder_name = Path(dirpath).name
                            sid = _stable_id(folder_path)
                            seen_ids.add(sid)
                            try:
                                stat = os.stat(dirpath)
                                batch.append((
                                    sid,
                                    _stable_id('/' + os.path.dirname(rel_dir).replace(os.sep, '/')) if os.path.dirname(rel_dir) else None,
                                    folder_name,
                                    folder_path,
                                    None,
                                    0,
                                    None,
                                    True,
                                    datetime.fromtimestamp(stat.st_ctime, tz=timezone.utc),
                                    datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc),
                                    None,
                                ))
                                result['folders_indexed'] += 1
                            except OSError as exc:
                                logger.warning('stat failed %s: %s', dirpath, exc)
                                result['errors'] += 1

                        for fname in filenames:
                            if fname.startswith(SKIP_FILE_PREFIXES):
                                continue
                            full = os.path.join(dirpath, fname)
                            rel_path = os.path.relpath(full, STAGING_ROOT)
                            file_path = '/' + rel_path.replace(os.sep, '/')
                            sid = _stable_id(file_path)
                            seen_ids.add(sid)
                            try:
                                stat = os.stat(full)
                            except OSError as exc:
                                logger.warning('stat failed %s: %s', full, exc)
                                result['errors'] += 1
                                continue

                            mime, _ = mimetypes.guess_type(fname)
                            parent_dir = os.path.dirname(rel_path)
                            parent_id = (
                                _stable_id('/' + parent_dir.replace(os.sep, '/'))
                                if parent_dir else None
                            )

                            batch.append((
                                sid,
                                parent_id,
                                fname,
                                file_path,
                                _ext_of(fname),
                                stat.st_size,
                                mime,
                                False,
                                datetime.fromtimestamp(stat.st_ctime, tz=timezone.utc),
                                datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc),
                                None,
                            ))
                            result['files_indexed'] += 1

                            if len(batch) >= BATCH_SIZE:
                                _upsert_batch(cur, batch)
                                batch.clear()

                    if batch:
                        _upsert_batch(cur, batch)

                    if seen_ids:
                        result['items_deleted'] = _mark_deleted(cur, seen_ids)
        finally:
            conn.close()

    except Exception as exc:
        logger.exception('local_filesystem_index: error: %s', exc)
        result['errors'] += 1
        result['error_message'] = str(exc)[:500]
    finally:
        result['duration_seconds'] = round(time.monotonic() - t0, 2)
        if sync_log_id:
            status = 'success' if result['errors'] == 0 else 'partial'
            _update_sync_log(sync_log_id, status, result)

    logger.info(
        'local_filesystem_index: done — files=%d folders=%d deleted=%d duration=%.1fs',
        result['files_indexed'], result['folders_indexed'],
        result['items_deleted'], result['duration_seconds'],
    )
    return result


# ─── DB helpers ───────────────────────────────────────────────


def _upsert_batch(cur: Any, batch: list[tuple]) -> None:
    psycopg2.extras.execute_values(
        cur,
        """
        INSERT INTO onedrive_file_index (
            graph_item_id, graph_parent_id, name, file_path,
            file_extension, file_size, mime_type, is_folder,
            remote_created_at, remote_modified_at, etag,
            sync_status, last_synced_at, updated_at,
            is_cached, local_path
        ) VALUES %s
        ON CONFLICT (graph_item_id) DO UPDATE SET
            graph_parent_id    = EXCLUDED.graph_parent_id,
            name               = EXCLUDED.name,
            file_path          = EXCLUDED.file_path,
            file_extension     = EXCLUDED.file_extension,
            file_size          = EXCLUDED.file_size,
            mime_type          = EXCLUDED.mime_type,
            is_folder          = EXCLUDED.is_folder,
            remote_modified_at = EXCLUDED.remote_modified_at,
            sync_status        = 'indexed',
            is_cached          = true,
            local_path         = EXCLUDED.local_path,
            last_synced_at     = NOW(),
            updated_at         = NOW()
        """,
        [
            (
                item[0], item[1], item[2], item[3],
                item[4], item[5], item[6], item[7],
                item[8], item[9], item[10],
                'indexed',
                datetime.now(timezone.utc),
                datetime.now(timezone.utc),
                True,
                '/data/onedrive-staging' + item[3],
            )
            for item in batch
        ],
        page_size=BATCH_SIZE,
    )


def _mark_deleted(cur: Any, seen_ids: set[str]) -> int:
    cur.execute(
        "CREATE TEMP TABLE _seen_local_ids (graph_item_id TEXT PRIMARY KEY) ON COMMIT DROP"
    )
    psycopg2.extras.execute_values(
        cur,
        "INSERT INTO _seen_local_ids (graph_item_id) VALUES %s",
        [(gid,) for gid in seen_ids],
        page_size=1000,
    )
    cur.execute(
        """
        UPDATE onedrive_file_index
        SET sync_status = 'deleted', updated_at = NOW()
        WHERE sync_status != 'deleted'
          AND graph_item_id LIKE 'local:%'
          AND graph_item_id NOT IN (SELECT graph_item_id FROM _seen_local_ids)
        """
    )
    return cur.rowcount


def _create_sync_log(started_at: datetime) -> int:
    conn = psycopg2.connect(SYNC_DSN)
    try:
        with conn, conn.cursor() as cur:
            cur.execute(
                "INSERT INTO etl_sync_log (sync_type, started_at, status) "
                "VALUES ('local_filesystem_index', %s, 'running') RETURNING id",
                (started_at,),
            )
            return cur.fetchone()[0]
    finally:
        conn.close()


def _update_sync_log(log_id: int, status: str, result: dict[str, Any]) -> None:
    conn = psycopg2.connect(SYNC_DSN)
    try:
        with conn, conn.cursor() as cur:
            cur.execute(
                """
                UPDATE etl_sync_log SET
                    status = %s,
                    completed_at = NOW(),
                    files_processed = %s,
                    rows_inserted = %s,
                    rows_updated = %s,
                    error_message = %s
                WHERE id = %s
                """,
                (
                    status,
                    result.get('files_indexed', 0) + result.get('folders_indexed', 0),
                    result.get('files_indexed', 0),
                    result.get('items_deleted', 0),
                    result.get('error_message'),
                    log_id,
                ),
            )
    finally:
        conn.close()
