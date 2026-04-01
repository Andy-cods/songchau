"""
Deploy Phase 1 files to VPS /opt/erp/
Usage: python scripts/deploy_phase1.py
"""

import os
import paramiko
from pathlib import Path

VPS_HOST = "103.56.158.129"
VPS_USER = "root"
VPS_PASS = "x2dk4Tf2fHUSPKmeWPMBaB7"
REMOTE_BASE = "/opt/erp"

# Local base = songchau-erp/
LOCAL_BASE = Path(__file__).resolve().parent.parent

# Files to deploy (local_relative -> remote_relative)
BACKEND_FILES = [
    # Migrations
    "backend/migrations/phase1_tables.sql",
    # Requirements
    "backend/requirements.txt",
    # Shared services
    "backend/app/services/gotenberg_service.py",
    "backend/app/services/gemini_service.py",
    "backend/app/services/report_scheduler.py",
    "backend/app/services/tools/__init__.py",
    "backend/app/services/tools/autofill_service.py",
    # Utils
    "backend/app/utils/email_sender.py",
    # API endpoints
    "backend/app/api/v1/__init__.py",
    "backend/app/api/v1/quotation_templates.py",
    "backend/app/api/v1/price_analytics.py",
    "backend/app/api/v1/smart_classify.py",
    "backend/app/api/v1/scheduled_reports.py",
    # Tasks
    "backend/app/tasks/__init__.py",
    "backend/app/tasks/report_generation.py",
    "backend/app/tasks/smart_classify.py",
    # Docker
    "docker-compose.yml",
]

FRONTEND_FILES = [
    "frontend/src/lib/constants.ts",
    "frontend/src/app/(dashboard)/bqms/quotation/new/page.tsx",
    "frontend/src/app/(dashboard)/bqms/quotation/history/page.tsx",
    "frontend/src/app/(dashboard)/bqms/quotation/[id]/page.tsx",
    "frontend/src/app/(dashboard)/bqms/quotation/templates/page.tsx",
    "frontend/src/app/(dashboard)/bqms/classify/page.tsx",
    "frontend/src/app/(dashboard)/analytics/price-trends/page.tsx",
    "frontend/src/app/(dashboard)/analytics/win-loss/page.tsx",
    "frontend/src/app/(dashboard)/reports/scheduled/page.tsx",
]


def deploy():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(VPS_HOST, username=VPS_USER, password=VPS_PASS, timeout=15)
    sftp = ssh.open_sftp()

    print("=" * 60)
    print("PHASE 1 DEPLOYMENT — Song Châu ERP")
    print("=" * 60)

    # Upload all files
    all_files = BACKEND_FILES + FRONTEND_FILES
    for rel_path in all_files:
        local_path = LOCAL_BASE / rel_path
        remote_path = f"{REMOTE_BASE}/{rel_path}"

        if not local_path.exists():
            print(f"  SKIP (not found): {rel_path}")
            continue

        # Ensure remote directory exists
        remote_dir = os.path.dirname(remote_path)
        try:
            sftp.stat(remote_dir)
        except FileNotFoundError:
            # Create dirs recursively
            parts = remote_dir.split("/")
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

        sftp.put(str(local_path), remote_path)
        print(f"  OK: {rel_path}")

    print(f"\n  Uploaded {len(all_files)} files")

    # Run DB migration
    print("\n--- Running DB migration ---")
    stdin, stdout, stderr = ssh.exec_command(
        f'docker exec sc-postgres psql -U scadmin -d songchau_erp -f /dev/stdin < {REMOTE_BASE}/backend/migrations/phase1_tables.sql'
    )
    out = stdout.read().decode()
    err = stderr.read().decode()
    print(f"  Migration output: {out[:500]}")
    if err:
        print(f"  Migration errors: {err[:500]}")

    # Alternative: pipe file content directly
    if "ERROR" in (out + err) or not out.strip():
        print("  Retrying migration via docker exec...")
        stdin, stdout, stderr = ssh.exec_command(
            f'cat {REMOTE_BASE}/backend/migrations/phase1_tables.sql | docker exec -i sc-postgres psql -U scadmin -d songchau_erp'
        )
        out = stdout.read().decode()
        err = stderr.read().decode()
        print(f"  Migration output: {out[:500]}")
        if err:
            print(f"  Migration stderr: {err[:500]}")

    # Rebuild and restart containers
    print("\n--- Rebuilding containers ---")
    stdin, stdout, stderr = ssh.exec_command(
        f'cd {REMOTE_BASE} && docker compose build api frontend 2>&1 | tail -30'
    )
    out = stdout.read().decode()
    print(f"  Build: {out[-500:]}")

    print("\n--- Restarting services ---")
    stdin, stdout, stderr = ssh.exec_command(
        f'cd {REMOTE_BASE} && docker compose up -d api frontend procrastinate-worker procrastinate-scheduler 2>&1'
    )
    out = stdout.read().decode()
    err = stderr.read().decode()
    print(f"  Restart: {out}")
    if err:
        print(f"  Stderr: {err[:300]}")

    # Wait and check health
    import time
    print("\n--- Waiting 15s for containers to start ---")
    time.sleep(15)

    stdin, stdout, stderr = ssh.exec_command('docker ps --format "{{.Names}} {{.Status}}"')
    print(f"  Containers:\n{stdout.read().decode()}")

    # Test API health
    stdin, stdout, stderr = ssh.exec_command('curl -s http://localhost:8000/api/health')
    print(f"  Health: {stdout.read().decode()[:200]}")

    sftp.close()
    ssh.close()
    print("\n" + "=" * 60)
    print("DEPLOYMENT COMPLETE")
    print("=" * 60)


if __name__ == "__main__":
    deploy()
