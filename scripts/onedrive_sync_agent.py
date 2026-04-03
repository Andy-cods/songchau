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

# Scan ALL folders (full depth, no subfolder filter)
# Business file types only — skip archives, executables, video, CAD, code
SYNC_EXTENSIONS = {
    # Excel (data kinh doanh)
    ".xlsx", ".xls", ".xlsm",
    # PDF (hóa đơn, chứng từ, tờ khai, catalog)
    ".pdf",
    # Word (hợp đồng, công văn)
    ".docx", ".doc",
    # CSV (data export)
    ".csv",
    # Images (biên nhận, ảnh chứng từ) — chỉ nhẹ
    ".jpg", ".jpeg", ".png",
}
# Skip: .zip .rar .7z .exe .mp4 .stp .x_t .dwg .dll .py .pyc .pptx
MAX_FILE_SIZE_MB = 50  # Skip files > 50MB
MAX_TOTAL_GB = 15  # Stop syncing when total reaches 15GB (VPS has 25GB free)
SKIP_PATTERNS = ["~$", "Thumbs.db", "desktop.ini", ".DS_Store"]
# Skip folders that are too deep or contain non-business data
SKIP_FOLDERS = {"__pycache__", "node_modules", ".git", ".venv", "venv", "env",
                "site-packages", "dist-packages", ".cache", "AppData", "SETUP"}

# Max depth per top-level folder to avoid scanning 94K RFQ subfolders
# Puplic/BQMS has 94K files in deep subfolders — only sync top 3 levels
MAX_FOLDER_DEPTH = 4  # from OneDrive root

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
    """Scan ENTIRE OneDrive Song Châu — all business files, full depth."""
    files = []

    if not LOCAL_ONEDRIVE.exists():
        log.error("OneDrive folder not found: %s", LOCAL_ONEDRIVE)
        sys.exit(1)

    # Walk entire tree with depth limit (avoid 94K RFQ subfolders)
    total_size = 0
    for dirpath, dirnames, filenames in os.walk(LOCAL_ONEDRIVE):
        # Skip non-business folders
        dirnames[:] = [d for d in dirnames if d not in SKIP_FOLDERS]

        # Check depth — skip too deep
        rel_dir = os.path.relpath(dirpath, LOCAL_ONEDRIVE)
        depth = 0 if rel_dir == "." else rel_dir.count(os.sep) + 1
        if depth > MAX_FOLDER_DEPTH:
            dirnames.clear()  # don't descend further
            continue

        for fname in filenames:
            fpath = Path(dirpath) / fname
            if fpath.suffix.lower() not in SYNC_EXTENSIONS:
                continue
            if any(p in fname for p in SKIP_PATTERNS):
                continue
            files.append(fpath)

    log.info("Scanned %d business files from OneDrive (depth <= %d)", len(files), MAX_FOLDER_DEPTH)

    # Filter: skip too large, track total size
    filtered = []
    seen_paths = set()
    skipped_large = 0
    for f in files:
        try:
            size = f.stat().st_size
        except Exception:
            continue
        if size > MAX_FILE_SIZE_MB * 1024 * 1024:
            skipped_large += 1
            continue
        # Check total size limit
        if (total_size + size) > MAX_TOTAL_GB * 1024 * 1024 * 1024:
            log.warning("Total size limit %dGB reached, stopping", MAX_TOTAL_GB)
            break
        rel = str(f.relative_to(LOCAL_ONEDRIVE))
        if rel in seen_paths:
            continue
        seen_paths.add(rel)
        filtered.append(f)
        total_size += size

    if skipped_large:
        log.info("Skipped %d files > %dMB", skipped_large, MAX_FILE_SIZE_MB)
    log.info("Total to sync: %d files, %.1f GB", len(filtered), total_size / 1024 / 1024 / 1024)

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
