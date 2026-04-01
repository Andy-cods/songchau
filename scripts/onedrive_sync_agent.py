#!/usr/bin/env python3
"""
Song Châu OneDrive Sync Agent — Chạy trên máy local của Thắng.

Cách hoạt động:
  1. Watch folder OneDrive Song Châu trên local
  2. Khi phát hiện file Excel thay đổi → upload lên VPS qua SFTP
  3. Trigger import trên VPS (gọi API hoặc chạy import script)
  4. Log kết quả

Cách chạy:
  python scripts/onedrive_sync_agent.py                    # Sync 1 lần
  python scripts/onedrive_sync_agent.py --watch             # Watch liên tục
  python scripts/onedrive_sync_agent.py --watch --interval 300  # Watch mỗi 5 phút
  python scripts/onedrive_sync_agent.py --full              # Full sync toàn bộ
"""

import argparse
import hashlib
import json
import logging
import os
import sys
import time
from datetime import datetime
from pathlib import Path

import paramiko

# ─── Config ───────────────────────────────────────────────────
VPS_HOST = "103.56.158.129"
VPS_USER = "root"
VPS_PASS = "x2dk4Tf2fHUSPKmeWPMBaB7"
VPS_STAGING = "/data/onedrive-staging"
VPS_ERP_DIR = "/opt/erp"

# Local OneDrive Song Châu folder
LOCAL_ONEDRIVE = Path(r"C:\Users\ASUS\OneDrive - SONG CHAU CO., LTD")

# Key subfolders to sync (most important business data)
SYNC_FOLDERS = [
    "Puplic/BQMS",
    "Puplic/IMV",
    "Puplic/EAE",
    "Puplic/LG",
    "Puplic/AMA Quotation",
    "Puplic",
    "TỔNG HỢP",
    "SMT",
]

EXCEL_EXTENSIONS = {".xlsx", ".xls", ".xlsm"}
MAX_FILE_SIZE_MB = 50  # Skip files > 50MB (likely backups/copies)
SKIP_PATTERNS = ["~$", "Copy", "- Copy", "Backup", "OLD", "test"]

# State file — tracks what we've synced
STATE_FILE = Path(__file__).parent / ".onedrive_sync_state.json"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("sync-agent")


# ─── State Management ────────────────────────────────────────

def load_state() -> dict:
    if STATE_FILE.exists():
        return json.loads(STATE_FILE.read_text())
    return {"files": {}, "last_sync": None}


def save_state(state: dict):
    state["last_sync"] = datetime.now().isoformat()
    STATE_FILE.write_text(json.dumps(state, indent=2, default=str))


def file_hash(path: Path) -> str:
    """Quick hash: size + mtime (fast, good enough for change detection)."""
    stat = path.stat()
    return f"{stat.st_size}_{int(stat.st_mtime)}"


# ─── File Discovery ──────────────────────────────────────────

def discover_files(full: bool = False) -> list[Path]:
    """Find all Excel files in OneDrive Song Châu."""
    files = []

    if not LOCAL_ONEDRIVE.exists():
        log.error("OneDrive folder not found: %s", LOCAL_ONEDRIVE)
        sys.exit(1)

    # Scan key folders (max depth 2 to avoid 70K+ RFQ subfolders)
    for subfolder in SYNC_FOLDERS:
        folder = LOCAL_ONEDRIVE / subfolder
        if not folder.exists():
            continue
        for f in folder.iterdir():
            if f.is_file() and f.suffix.lower() in EXCEL_EXTENSIONS and not f.name.startswith("~$"):
                files.append(f)
            elif f.is_dir():
                for f2 in f.iterdir():
                    if f2.is_file() and f2.suffix.lower() in EXCEL_EXTENSIONS and not f2.name.startswith("~$"):
                        files.append(f2)

    # Also scan root-level Excel files
    for f in LOCAL_ONEDRIVE.iterdir():
        if f.is_file() and f.suffix.lower() in EXCEL_EXTENSIONS and not f.name.startswith("~$"):
            if f not in files:
                files.append(f)

    # Filter: skip too large, skip copies/backups, deduplicate
    filtered = []
    seen_names = set()
    for f in files:
        # Skip temp files and patterns
        if any(p in f.name for p in SKIP_PATTERNS):
            continue
        # Skip files > MAX_FILE_SIZE_MB
        if f.stat().st_size > MAX_FILE_SIZE_MB * 1024 * 1024:
            continue
        # Deduplicate by name (keep first found)
        if f.name in seen_names:
            continue
        seen_names.add(f.name)
        filtered.append(f)

    log.info("Discovered %d Excel files (%d after filtering)", len(files), len(filtered))
    return filtered


def find_changed_files(files: list[Path], state: dict, full: bool = False) -> list[Path]:
    """Compare with state to find new/changed files."""
    if full:
        return files

    changed = []
    for f in files:
        key = str(f.relative_to(LOCAL_ONEDRIVE))
        current_hash = file_hash(f)
        if state["files"].get(key) != current_hash:
            changed.append(f)

    return changed


# ─── SFTP Upload ─────────────────────────────────────────────

def upload_files(files: list[Path]) -> tuple[int, int]:
    """Upload changed files to VPS via SFTP."""
    if not files:
        return 0, 0

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(VPS_HOST, username=VPS_USER, password=VPS_PASS, timeout=15)
    sftp = ssh.open_sftp()

    uploaded = 0
    errors = 0

    for f in files:
        rel_path = f.relative_to(LOCAL_ONEDRIVE)
        remote_path = f"{VPS_STAGING}/{rel_path}"
        remote_dir = os.path.dirname(remote_path)

        try:
            # Fix: convert Windows backslashes to Linux forward slashes
            remote_path = remote_path.replace("\\", "/")
            remote_dir = os.path.dirname(remote_path)
            # Ensure remote directory exists
            _ensure_remote_dir(sftp, remote_dir)
            sftp.put(str(f), remote_path)
            uploaded += 1
            size_kb = f.stat().st_size / 1024
            log.info("  ✓ %s (%.0f KB)", rel_path, size_kb)
        except Exception as exc:
            errors += 1
            log.warning("  ✗ %s: %s", rel_path, exc)

    sftp.close()
    ssh.close()
    return uploaded, errors


def _ensure_remote_dir(sftp, path: str):
    """Create remote directory recursively."""
    parts = path.split("/")
    current = ""
    for part in parts:
        if not part:
            current = "/"
            continue
        current = f"{current}/{part}" if current != "/" else f"/{part}"
        try:
            sftp.stat(current)
        except FileNotFoundError:
            sftp.mkdir(current)


# ─── Trigger Import on VPS ───────────────────────────────────

def trigger_import() -> dict:
    """Run import_precise.py on VPS to import uploaded files into DB."""
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(VPS_HOST, username=VPS_USER, password=VPS_PASS, timeout=15)

    log.info("Triggering import on VPS...")
    stdin, stdout, stderr = ssh.exec_command(
        f"docker exec sc-api python scripts/import_precise.py --source {VPS_STAGING}",
        timeout=300,
    )
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")

    ssh.close()

    # Parse result
    result = {"output": out[-1000:], "errors": err[-500:] if err else ""}

    # Count rows from output
    for line in out.split("\n"):
        if "inserted" in line.lower() or "upsert" in line.lower():
            log.info("  %s", line.strip())
        if "DONE" in line or "total" in line.lower():
            log.info("  %s", line.strip())

    return result


# ─── Main Sync ────────────────────────────────────────────────

def sync_once(full: bool = False):
    """Run one sync cycle."""
    state = load_state()

    log.info("=" * 50)
    log.info("OneDrive Sync — %s", "FULL" if full else "DELTA")
    log.info("Source: %s", LOCAL_ONEDRIVE)
    log.info("Target: %s:%s", VPS_HOST, VPS_STAGING)
    if state["last_sync"]:
        log.info("Last sync: %s", state["last_sync"])
    log.info("=" * 50)

    # 1. Discover files
    all_files = discover_files(full)

    # 2. Find changed
    changed = find_changed_files(all_files, state, full)
    log.info("Changed files: %d / %d total", len(changed), len(all_files))

    if not changed:
        log.info("No changes detected. Nothing to sync.")
        save_state(state)
        return

    # 3. Upload to VPS
    uploaded, errors = upload_files(changed)
    log.info("Uploaded: %d, Errors: %d", uploaded, errors)

    # 4. Trigger import
    if uploaded > 0:
        result = trigger_import()

    # 5. Update state
    for f in changed:
        key = str(f.relative_to(LOCAL_ONEDRIVE))
        state["files"][key] = file_hash(f)
    save_state(state)

    log.info("Sync complete! %d files uploaded.", uploaded)


def watch_loop(interval: int = 300):
    """Continuously watch for changes."""
    log.info("Watch mode — checking every %d seconds (Ctrl+C to stop)", interval)
    log.info("Watching: %s", LOCAL_ONEDRIVE)

    # First run: full sync
    sync_once(full=True)

    while True:
        try:
            log.info("\nSleeping %d seconds...", interval)
            time.sleep(interval)
            sync_once(full=False)
        except KeyboardInterrupt:
            log.info("\nStopped by user.")
            break
        except Exception as exc:
            log.error("Sync error: %s", exc)
            time.sleep(60)  # wait a bit before retry


# ─── CLI ──────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Song Châu OneDrive Sync Agent")
    parser.add_argument("--watch", action="store_true", help="Watch mode — sync liên tục")
    parser.add_argument("--interval", type=int, default=300, help="Watch interval (giây, mặc định 300)")
    parser.add_argument("--full", action="store_true", help="Full sync (bỏ qua cache)")
    parser.add_argument("--dry-run", action="store_true", help="Chỉ list files, không upload")
    args = parser.parse_args()

    if args.dry_run:
        files = discover_files(full=True)
        for f in files:
            print(f"  {f.relative_to(LOCAL_ONEDRIVE)} ({f.stat().st_size / 1024:.0f} KB)")
        print(f"\nTotal: {len(files)} files")
        sys.exit(0)

    if args.watch:
        watch_loop(args.interval)
    else:
        sync_once(full=args.full)
