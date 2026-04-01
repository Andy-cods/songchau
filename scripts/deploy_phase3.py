"""
Deploy Phase 3 Operations Intelligence to VPS.
Usage: python scripts/deploy_phase3.py
"""

import os
import sys
import time
import json
import paramiko
from pathlib import Path

VPS_HOST = "103.56.158.129"
VPS_USER = "root"
VPS_PASS = "x2dk4Tf2fHUSPKmeWPMBaB7"
REMOTE_BASE = "/opt/erp"
LOCAL_BASE = Path(__file__).resolve().parent.parent

BACKEND_FILES = [
    "backend/migrations/phase3_operations.sql",
    "backend/app/api/v1/__init__.py",
    "backend/app/api/v1/smart_inventory.py",
    "backend/app/api/v1/smart_notifications.py",
    "backend/app/api/v1/profit_analysis.py",
    "backend/app/api/v1/task_assignments.py",
]

FRONTEND_FILES = [
    "frontend/src/lib/constants.ts",
    "frontend/src/app/(dashboard)/inventory/forecast/page.tsx",
    "frontend/src/app/(dashboard)/notifications/settings/page.tsx",
    "frontend/src/app/(dashboard)/analytics/profit/page.tsx",
    "frontend/src/app/(dashboard)/tasks/page.tsx",
    "frontend/src/app/(dashboard)/tasks/workload/page.tsx",
]

# Also check for dynamic route pages
OPTIONAL_FILES = [
    "frontend/src/app/(dashboard)/inventory/forecast/[product_id]/page.tsx",
    "frontend/src/app/(dashboard)/tasks/new/page.tsx",
]


def ensure_remote_dir(sftp, path):
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


def deploy():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(VPS_HOST, username=VPS_USER, password=VPS_PASS, timeout=15)
    sftp = ssh.open_sftp()

    print("=" * 60)
    print("PHASE 3 DEPLOYMENT — Operations Intelligence")
    print("=" * 60)

    all_files = BACKEND_FILES + FRONTEND_FILES + OPTIONAL_FILES
    uploaded = 0
    for rel_path in all_files:
        local_path = LOCAL_BASE / rel_path
        remote_path = f"{REMOTE_BASE}/{rel_path}"
        if not local_path.exists():
            continue
        ensure_remote_dir(sftp, os.path.dirname(remote_path))
        sftp.put(str(local_path), remote_path)
        uploaded += 1
        print(f"  OK: {rel_path}")
    print(f"\n  Uploaded: {uploaded}")

    # DB migration
    print("\n--- DB Migration ---")
    stdin, stdout, stderr = ssh.exec_command(
        f'cat {REMOTE_BASE}/backend/migrations/phase3_operations.sql | docker exec -i sc-postgres psql -U scadmin -d songchau_erp 2>&1'
    )
    out = stdout.read().decode("utf-8", errors="replace")
    creates = out.count("CREATE") + out.count("ALTER")
    print(f"  {creates} statements OK")

    # Rebuild + restart
    print("\n--- Rebuild + Restart ---")
    stdin, stdout, stderr = ssh.exec_command(
        f'cd {REMOTE_BASE} && docker compose build api frontend 2>&1 | tail -5'
    )
    print(stdout.read().decode("utf-8", errors="replace"))
    stdin, stdout, stderr = ssh.exec_command(
        f'cd {REMOTE_BASE} && docker compose up -d --force-recreate api frontend 2>&1'
    )
    print(stdout.read().decode("utf-8", errors="replace"))
    stdin, stdout, stderr = ssh.exec_command(
        f'cd {REMOTE_BASE} && docker compose restart nginx 2>&1'
    )
    print("Nginx restarted")

    time.sleep(20)

    # Test
    print("\n--- Testing ---")
    stdin, stdout, stderr = ssh.exec_command(
        'docker exec sc-api curl -s -X POST http://localhost:8000/api/v1/auth/login '
        '-H "Content-Type: application/json" '
        '-d \'{"email":"thang@songchau.vn","password":"SongChau@2026"}\''
    )
    try:
        token = json.loads(stdout.read().decode())["access_token"]
    except Exception:
        print("  AUTH FAILED")
        sftp.close()
        ssh.close()
        return

    endpoints = [
        # Phase 1
        "GET /api/v1/quotations/templates",
        "GET /api/v1/price-analytics/overview?months=6",
        # Phase 2
        "GET /api/v1/supplier-quotes",
        "GET /api/v1/shipments",
        "GET /api/v1/invoices",
        "GET /api/v1/chains",
        # Phase 3
        "GET /api/v1/smart-inventory/dashboard",
        "GET /api/v1/smart-inventory/alerts",
        "GET /api/v1/smart-notifications?page=1",
        "GET /api/v1/smart-notifications/unread-count",
        "GET /api/v1/profit-analysis/overview?months=6",
        "GET /api/v1/profit-analysis/by-maker?months=6",
        "GET /api/v1/task-assignments?page=1",
        "GET /api/v1/task-assignments/workload",
    ]

    ok = 0
    for ep in endpoints:
        method, path = ep.split(" ", 1)
        stdin, stdout, stderr = ssh.exec_command(
            f'docker exec sc-api curl -s -o /dev/null -w "%{{http_code}}" '
            f'-H "Authorization: Bearer {token}" "http://localhost:8000{path}"'
        )
        code = stdout.read().decode().strip()
        if code == "200":
            ok += 1
        print(f"  [{'PASS' if code == '200' else 'FAIL'}] {code} {ep}")

    print(f"\n  Result: {ok}/{len(endpoints)} passed")
    print("=" * 60)

    sftp.close()
    ssh.close()


if __name__ == "__main__":
    deploy()
