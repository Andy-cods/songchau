"""OneDrive → VPS continuous incremental sync.

Runs forever (or via Windows Task Scheduler every X minutes). On each
pass it walks the local OneDrive folder, compares mtime+size against a
local state file, and SFTP-pushes only the new/changed files. Deletes
on the VPS the files that vanished locally.

Usage:
    python scripts/onedrive_continuous_sync.py             # run once + exit
    python scripts/onedrive_continuous_sync.py --watch     # loop forever, scan every 60s
    python scripts/onedrive_continuous_sync.py --watch --interval 30

State file: %LOCALAPPDATA%/SongChauOneDriveSync/state.json
Log file:   %LOCALAPPDATA%/SongChauOneDriveSync/sync.log
"""
from __future__ import annotations

import argparse
import functools
import json
import logging
import os
import socket
import stat as stat_module
import sys
import threading
import time
import unicodedata
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path
from typing import Any

import paramiko

PARALLEL_WORKERS = int(os.environ.get('SC_SYNC_WORKERS', '8'))

# Force UTF-8
if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
print = functools.partial(print, flush=True)

# ─── Config ────────────────────────────────────────────────────────────

VPS_HOST = '103.56.158.129'
VPS_PORT = 22
VPS_USER = 'root'
VPS_PASS = '2poeu8xn9w'  # placeholder — will fall back to env IMV_PASSWORD pattern; replace as needed
VPS_PASS = os.environ.get('SC_VPS_PASS', 'x2dk4Tf2fHUSPKmeWPMBaB7')
VPS_DEST = '/data/onedrive-staging'

LOCAL_ROOT = os.environ.get('SC_ONEDRIVE_LOCAL', r'C:\Users\ASUS\OneDrive - SONG CHAU CO., LTD')

# Sync mode A: explicit file allowlist (preferred — tight scope, no folder walks).
# Used for the 4 BQMS Excel files that are the *only* source feeding bqms_rfq +
# bqms_deliveries tables. Push interval can be aggressive (60s) since each
# stat() call is O(1) and pushes are tiny (~3.5MB total).
WATCHED_FILES = [
    'Puplic/BQMS/Thong ke hoi hang BQMS.xlsx',
    'Puplic/BQMS/Thong ke giao hang/Thong ke giao hang 2026.xlsx',
    'Puplic/BQMS/Thong ke giao hang/Thong ke giao hang 2025.xlsx',
    'Puplic/BQMS/Thong ke giao hang/Thong ke giao hang 2023-2024.xlsx',
]
# Override via env: SC_WATCHED_FILES="path1\npath2\n..."
if os.environ.get('SC_WATCHED_FILES'):
    WATCHED_FILES = [s.strip() for s in os.environ['SC_WATCHED_FILES'].splitlines() if s.strip()]

# Sync mode B: folder walk (broader scope, slower). Only used if WATCHED_FILES is empty.
WATCHED_FOLDERS: list[str] = []
# Add more by editing SC_WATCHED_FOLDERS env var (newline-separated)
if os.environ.get('SC_WATCHED_FOLDERS'):
    WATCHED_FOLDERS = [s.strip() for s in os.environ['SC_WATCHED_FOLDERS'].splitlines() if s.strip()]

MAX_FILE_SIZE = 200 * 1024 * 1024
SKIP_NAMES = {'desktop.ini', 'Thumbs.db', '.DS_Store'}
SKIP_PREFIXES = ('~$', '.tmp')
SKIP_EXTS = {'.tmp', '.lnk', '.crdownload'}

STATE_DIR = Path(os.environ.get('LOCALAPPDATA', os.path.expanduser('~'))) / 'SongChauOneDriveSync'
STATE_DIR.mkdir(parents=True, exist_ok=True)
STATE_FILE = STATE_DIR / 'state.json'
LOG_FILE = STATE_DIR / 'sync.log'

# ─── Logging ───────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.FileHandler(LOG_FILE, encoding='utf-8'),
        logging.StreamHandler(sys.stdout),
    ],
)
log = logging.getLogger('onedrive_sync')


# ─── State ─────────────────────────────────────────────────────────────

def load_state() -> dict[str, dict[str, Any]]:
    if not STATE_FILE.exists():
        return {}
    try:
        return json.loads(STATE_FILE.read_text(encoding='utf-8'))
    except Exception as exc:
        log.warning('state load failed: %s', exc)
        return {}


def save_state(state: dict[str, Any]) -> None:
    tmp = STATE_FILE.with_suffix('.tmp')
    tmp.write_text(json.dumps(state, ensure_ascii=False, indent=0), encoding='utf-8')
    tmp.replace(STATE_FILE)


# ─── Filesystem walk ───────────────────────────────────────────────────

def should_skip(name: str, full: str) -> bool:
    if name in SKIP_NAMES:
        return True
    if any(name.startswith(p) for p in SKIP_PREFIXES):
        return True
    _, ext = os.path.splitext(name)
    if ext.lower() in SKIP_EXTS:
        return True
    try:
        if os.path.getsize(full) > MAX_FILE_SIZE:
            return True
    except OSError:
        return True
    return False


def scan_local() -> dict[str, dict[str, Any]]:
    """Return rel_path → {size, mtime} for files we want to sync.

    Mode A (preferred): WATCHED_FILES set → stat each file directly (O(N), tiny).
    Mode B: WATCHED_FILES empty → walk WATCHED_FOLDERS (legacy bulk mode).
    """
    out: dict[str, dict[str, Any]] = {}

    if WATCHED_FILES:
        for rel in WATCHED_FILES:
            full = os.path.join(LOCAL_ROOT, rel.replace('/', os.sep))
            if not os.path.exists(full):
                log.debug('watched file missing: %s', rel)
                continue
            try:
                st = os.stat(full)
            except OSError:
                continue
            out[rel] = {'size': st.st_size, 'mtime': int(st.st_mtime)}
        return out

    for folder in WATCHED_FOLDERS:
        base = os.path.join(LOCAL_ROOT, folder.replace('/', os.sep))
        if not os.path.exists(base):
            log.debug('skip missing %s', base)
            continue
        for dirpath, dirnames, filenames in os.walk(base):
            # Skip junk dirs
            dirnames[:] = [d for d in dirnames if not d.startswith('.')]
            for fname in filenames:
                full = os.path.join(dirpath, fname)
                if should_skip(fname, full):
                    continue
                try:
                    st = os.stat(full)
                except OSError:
                    continue
                rel = os.path.relpath(full, LOCAL_ROOT).replace(os.sep, '/')
                out[rel] = {
                    'size': st.st_size,
                    'mtime': int(st.st_mtime),
                }
    return out


# ─── SFTP helpers ──────────────────────────────────────────────────────

def remote_path_join(base: str, rel: str) -> str:
    return base.rstrip('/') + '/' + rel.replace('\\', '/')


def sftp_mkdir_p(sftp, remote_dir: str) -> None:
    if remote_dir in ('/', ''):
        return
    try:
        sftp.stat(remote_dir)
        return
    except IOError:
        pass
    parent = remote_dir.rsplit('/', 1)[0]
    if parent and parent != remote_dir:
        sftp_mkdir_p(sftp, parent)
    try:
        sftp.mkdir(remote_dir)
    except IOError as exc:
        try:
            sftp.stat(remote_dir)
        except IOError:
            raise exc


def sftp_remove(sftp, path: str) -> bool:
    try:
        sftp.remove(path)
        return True
    except IOError:
        return False


def sftp_remove_empty_dir(sftp, path: str) -> None:
    try:
        sftp.rmdir(path)
    except IOError:
        pass


# ─── Sync logic ────────────────────────────────────────────────────────

def diff(prev: dict, current: dict) -> tuple[list, list, list]:
    added, changed, removed = [], [], []
    for rel, info in current.items():
        prev_info = prev.get(rel)
        if not prev_info:
            added.append(rel)
        elif prev_info['size'] != info['size'] or prev_info['mtime'] != info['mtime']:
            changed.append(rel)
    for rel in prev:
        if rel not in current:
            removed.append(rel)
    return added, changed, removed


def sync_once() -> dict[str, Any]:
    started = datetime.now()
    log.info('=== sync pass starting ===')

    if not os.path.exists(LOCAL_ROOT):
        log.error('LOCAL_ROOT missing: %s', LOCAL_ROOT)
        return {'error': 'LOCAL_ROOT missing'}

    prev_state = load_state()
    current = scan_local()
    added, changed, removed = diff(prev_state, current)

    log.info('local files: %d (added=%d, changed=%d, removed=%d)',
             len(current), len(added), len(changed), len(removed))

    to_push = added + changed
    if not to_push and not removed:
        log.info('nothing to do')
        save_state(current)
        return {
            'duration_s': round((datetime.now() - started).total_seconds(), 1),
            'pushed': 0, 'removed': 0, 'total': len(current),
        }

    # Open one SSH transport + N parallel SFTP channels for true concurrency.
    log.info('connecting to %s as %s (parallel=%d)', VPS_HOST, VPS_USER, PARALLEL_WORKERS)
    tls = threading.local()
    transports: list[paramiko.Transport] = []
    transports_lock = threading.Lock()

    def get_sftp() -> paramiko.SFTPClient:
        if getattr(tls, 'sftp', None) is None:
            t = paramiko.Transport((VPS_HOST, VPS_PORT))
            t.banner_timeout = 30
            t.connect(username=VPS_USER, password=VPS_PASS)
            tls.sftp = paramiko.SFTPClient.from_transport(t)
            with transports_lock:
                transports.append(t)
        return tls.sftp

    made_dirs: set[str] = set()
    mkdir_lock = threading.Lock()
    counter_lock = threading.Lock()
    counters = {'pushed': 0, 'bytes': 0, 'failed': 0}

    def push_one(rel: str) -> None:
        local_full = os.path.join(LOCAL_ROOT, rel.replace('/', os.sep))
        if not os.path.exists(local_full):
            return
        remote = remote_path_join(VPS_DEST, rel)
        remote_dir = remote.rsplit('/', 1)[0]
        try:
            sftp = get_sftp()
            with mkdir_lock:
                if remote_dir not in made_dirs:
                    sftp_mkdir_p(sftp, remote_dir)
                    made_dirs.add(remote_dir)
            sftp.put(local_full, remote)
            size = current[rel]['size']
            with counter_lock:
                counters['pushed'] += 1
                counters['bytes'] += size
                if counters['pushed'] % 200 == 0:
                    log.info('  pushed %d / %d  (%.1f MB)',
                             counters['pushed'], len(to_push), counters['bytes'] / 1024 / 1024)
        except Exception as exc:
            with counter_lock:
                counters['failed'] += 1
            log.warning('push failed %s: %s', rel, str(exc)[:120])

    try:
        with ThreadPoolExecutor(max_workers=PARALLEL_WORKERS, thread_name_prefix='sftp') as ex:
            list(ex.map(push_one, to_push))

        # Removals on a single channel (rare path, no need to parallelize)
        if removed:
            del_sftp = get_sftp()
            removed_count = 0
            for rel in removed:
                remote = remote_path_join(VPS_DEST, rel)
                if sftp_remove(del_sftp, remote):
                    removed_count += 1
            if removed_count:
                log.info('removed %d files on VPS', removed_count)
    finally:
        for t in transports:
            try:
                t.close()
            except Exception:
                pass

    pushed = counters['pushed']
    push_bytes = counters['bytes']
    failed = counters['failed']

    save_state(current)
    duration = round((datetime.now() - started).total_seconds(), 1)
    log.info('=== sync done: pushed=%d (%.1f MB) removed=%d failed=%d in %ss ===',
             pushed, push_bytes / 1024 / 1024, len(removed), failed, duration)

    # POST result back to VPS so the dashboard chip updates
    try:
        notify_vps_local_indexer()
    except Exception as exc:
        log.debug('notify failed: %s', exc)

    return {
        'duration_s': duration,
        'pushed': pushed,
        'pushed_mb': round(push_bytes / 1024 / 1024, 1),
        'removed': len(removed),
        'failed': failed,
        'total': len(current),
    }


def notify_vps_local_indexer() -> None:
    """Ping the VPS to re-run local_filesystem_index right after we push.
    Best-effort — do not fail the sync if this errors.
    """
    import urllib.request
    import urllib.error
    try:
        # Login to get token
        req = urllib.request.Request(
            'https://erp.songchau.vn/api/v1/auth/login',
            data=json.dumps({
                'email': os.environ.get('SC_USER', 'thang@songchau.vn'),
                'password': os.environ.get('SC_PWD', 'SongChau@2026'),
            }).encode('utf-8'),
            headers={'Content-Type': 'application/json'},
            method='POST',
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            token = json.loads(resp.read())['access_token']
        # Trigger local sync
        req2 = urllib.request.Request(
            'https://erp.songchau.vn/api/v1/etl/sync-local',
            headers={'Authorization': f'Bearer {token}'},
            method='POST',
        )
        with urllib.request.urlopen(req2, timeout=10):
            log.info('VPS local-indexer triggered')
    except urllib.error.HTTPError as exc:
        if exc.code == 409:
            log.debug('indexer already running on VPS')
        else:
            log.debug('notify VPS got %s', exc.code)


# ─── Watch mode ────────────────────────────────────────────────────────

def watch(interval: int) -> None:
    log.info('watch mode — scanning every %ds', interval)
    log.info('local: %s', LOCAL_ROOT)
    log.info('remote: %s@%s:%s', VPS_USER, VPS_HOST, VPS_DEST)
    if WATCHED_FILES:
        log.info('mode: file-list (%d files)', len(WATCHED_FILES))
        for f in WATCHED_FILES:
            log.info('  - %s', f)
    else:
        log.info('mode: folder-walk: %s', ', '.join(WATCHED_FOLDERS))
    while True:
        try:
            sync_once()
        except KeyboardInterrupt:
            log.info('keyboard interrupt — exiting')
            break
        except Exception as exc:
            log.exception('sync pass failed: %s', exc)
        time.sleep(interval)


# ─── Entry ─────────────────────────────────────────────────────────────

def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    p.add_argument('--watch', action='store_true', help='Loop forever, sync every --interval')
    p.add_argument('--interval', type=int, default=60, help='Watch loop interval in seconds (default 60)')
    p.add_argument('--state-info', action='store_true', help='Print state file location and exit')
    args = p.parse_args()

    if args.state_info:
        print(f'state: {STATE_FILE}')
        print(f'log:   {LOG_FILE}')
        return 0

    if args.watch:
        watch(args.interval)
        return 0
    else:
        result = sync_once()
        print(json.dumps(result, ensure_ascii=False))
        return 0 if 'error' not in result else 1


if __name__ == '__main__':
    sys.exit(main())
