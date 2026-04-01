"""
Deploy Phase 2 Revenue Chain files to VPS /opt/erp/
Usage: python scripts/deploy_phase2.py
"""

import os
import sys
import time
import paramiko
from pathlib import Path

VPS_HOST = "103.56.158.129"
VPS_USER = "root"
VPS_PASS = "x2dk4Tf2fHUSPKmeWPMBaB7"
REMOTE_BASE = "/opt/erp"
LOCAL_BASE = Path(__file__).resolve().parent.parent

BACKEND_FILES = [
    "backend/migrations/phase2_revenue_chain.sql",
    "backend/app/api/v1/__init__.py",
    "backend/app/api/v1/supplier_quotes.py",
    "backend/app/api/v1/shipment_tracking.py",
    "backend/app/api/v1/invoice_management.py",
    "backend/app/api/v1/deal_chain.py",
    "backend/app/api/v1/exchange_rates_api.py",
    "backend/app/api/v1/revenue_tasks.py",
    "backend/app/tasks/revenue_chain.py",
]

FRONTEND_FILES = [
    "frontend/src/lib/constants.ts",
    "frontend/src/app/(dashboard)/supplier-quotes/page.tsx",
    "frontend/src/app/(dashboard)/supplier-quotes/new/page.tsx",
    "frontend/src/app/(dashboard)/supplier-quotes/[id]/page.tsx",
    "frontend/src/app/(dashboard)/shipments/page.tsx",
    "frontend/src/app/(dashboard)/shipments/[id]/page.tsx",
    "frontend/src/app/(dashboard)/invoices/page.tsx",
    "frontend/src/app/(dashboard)/invoices/[id]/page.tsx",
    "frontend/src/app/(dashboard)/chains/page.tsx",
    "frontend/src/app/(dashboard)/chains/[code]/page.tsx",
]


def ensure_remote_dir(sftp, path):
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


def deploy():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(VPS_HOST, username=VPS_USER, password=VPS_PASS, timeout=15)
    sftp = ssh.open_sftp()

    print("=" * 60)
    print("PHASE 2 DEPLOYMENT — Revenue Chain")
    print("=" * 60)

    all_files = BACKEND_FILES + FRONTEND_FILES
    uploaded = 0
    skipped = 0

    for rel_path in all_files:
        local_path = LOCAL_BASE / rel_path
        remote_path = f"{REMOTE_BASE}/{rel_path}"

        if not local_path.exists():
            print(f"  SKIP: {rel_path}")
            skipped += 1
            continue

        ensure_remote_dir(sftp, os.path.dirname(remote_path))
        sftp.put(str(local_path), remote_path)
        uploaded += 1
        print(f"  OK: {rel_path}")

    print(f"\n  Uploaded: {uploaded}, Skipped: {skipped}")

    # Run DB migration
    print("\n--- DB Migration ---")
    stdin, stdout, stderr = ssh.exec_command(
        f'cat {REMOTE_BASE}/backend/migrations/phase2_revenue_chain.sql | docker exec -i sc-postgres psql -U scadmin -d songchau_erp'
    )
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    # Count successes
    creates = out.count("CREATE") + out.count("ALTER")
    errors = err.count("ERROR")
    print(f"  {creates} statements OK, {errors} errors")
    if errors:
        for line in err.split("\n"):
            if "ERROR" in line:
                print(f"  {line.strip()[:100]}")

    # Rebuild
    print("\n--- Rebuilding API + Frontend ---")
    stdin, stdout, stderr = ssh.exec_command(
        f'cd {REMOTE_BASE} && docker compose build api frontend 2>&1 | tail -5'
    )
    print(stdout.read().decode("utf-8", errors="replace"))

    print("--- Restarting ---")
    stdin, stdout, stderr = ssh.exec_command(
        f'cd {REMOTE_BASE} && docker compose up -d --force-recreate api frontend 2>&1'
    )
    print(stdout.read().decode("utf-8", errors="replace"))

    time.sleep(20)

    # Health check
    print("--- Health Check ---")
    stdin, stdout, stderr = ssh.exec_command('docker ps --format "{{.Names}} {{.Status}}" | grep -v Restarting')
    print(stdout.read().decode("utf-8", errors="replace"))

    # Test endpoints
    print("--- Testing Phase 2 Endpoints ---")
    stdin, stdout, stderr = ssh.exec_command(
        'docker exec sc-api curl -s -X POST http://localhost:8000/api/v1/auth/login '
        '-H "Content-Type: application/json" '
        '-d \'{"email":"thang@songchau.vn","password":"SongChau@2026"}\''
    )
    import json
    try:
        token = json.loads(stdout.read().decode())["access_token"]
    except Exception:
        print("  AUTH FAILED")
        sftp.close()
        ssh.close()
        return

    endpoints = [
        "GET /api/v1/supplier-quotes",
        "GET /api/v1/shipments",
        "GET /api/v1/invoices",
        "GET /api/v1/chains",
        "GET /api/v1/exchange-rates/latest?from=CNY&to=VND",
        "GET /api/v1/quotations/templates",
        "GET /api/v1/price-analytics/overview?months=6",
        "GET /api/v1/smart-classify/results?page=1",
        "GET /api/v1/scheduled-reports",
    ]

    ok = 0
    for ep in endpoints:
        method, path = ep.split(" ", 1)
        stdin, stdout, stderr = ssh.exec_command(
            f'docker exec sc-api curl -s -o /dev/null -w "%{{http_code}}" '
            f'-H "Authorization: Bearer {token}" "http://localhost:8000{path}"'
        )
        code = stdout.read().decode().strip()
        status = "PASS" if code == "200" else "FAIL"
        if code == "200":
            ok += 1
        print(f"  [{status}] {code} {ep}")

    print(f"\n  Result: {ok}/{len(endpoints)} passed")
    print("=" * 60)

    sftp.close()
    ssh.close()


if __name__ == "__main__":
    deploy()
