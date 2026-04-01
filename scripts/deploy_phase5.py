"""Deploy Phase 5 UX & Productivity to VPS."""
import os, sys, time, json, paramiko
from pathlib import Path

VPS_HOST = "103.56.158.129"
VPS_USER = "root"
VPS_PASS = "x2dk4Tf2fHUSPKmeWPMBaB7"
REMOTE = "/opt/erp"
LOCAL = Path(__file__).resolve().parent.parent

FILES = [
    "backend/migrations/phase5_ux.sql",
    "backend/app/api/v1/__init__.py",
    "backend/app/api/v1/document_management.py",
    "backend/app/api/v1/security_log_api.py",
    "backend/app/api/v1/excel_export.py",
    "backend/app/api/v1/batch_operations.py",
    "backend/app/api/v1/user_guide.py",
    "backend/app/api/v1/user_activity.py",
    "frontend/src/lib/constants.ts",
    "frontend/src/app/(dashboard)/documents/page.tsx",
    "frontend/src/app/(dashboard)/admin/security-log/page.tsx",
    "frontend/src/app/(dashboard)/admin/user-activity/page.tsx",
    "frontend/src/app/(dashboard)/help/page.tsx",
    "frontend/src/app/(dashboard)/help/first-login/page.tsx",
]

def ensure_dir(sftp, path):
    parts = path.split("/")
    cur = ""
    for p in parts:
        if not p: cur = "/"; continue
        cur = f"{cur}/{p}" if cur != "/" else f"/{p}"
        try: sftp.stat(cur)
        except: sftp.mkdir(cur)

def deploy():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(VPS_HOST, username=VPS_USER, password=VPS_PASS, timeout=15)
    sftp = ssh.open_sftp()
    print("=" * 60)
    print("PHASE 5 DEPLOYMENT — UX & Productivity")
    print("=" * 60)
    up = 0
    for f in FILES:
        lp = LOCAL / f
        if not lp.exists(): continue
        rp = f"{REMOTE}/{f}"
        ensure_dir(sftp, os.path.dirname(rp))
        sftp.put(str(lp), rp); up += 1
        print(f"  OK: {f}")
    print(f"\n  Uploaded: {up}")

    print("\n--- DB Migration ---")
    i,o,e = ssh.exec_command(f'cat {REMOTE}/backend/migrations/phase5_ux.sql | docker exec -i sc-postgres psql -U scadmin -d songchau_erp 2>&1')
    out = o.read().decode("utf-8","replace")
    print(f"  {out.count('CREATE')+out.count('ALTER')} statements OK")

    print("\n--- Rebuild + Restart ---")
    i,o,e = ssh.exec_command(f'cd {REMOTE} && docker compose build api frontend 2>&1 | tail -5')
    print(o.read().decode("utf-8","replace"))
    i,o,e = ssh.exec_command(f'cd {REMOTE} && docker compose up -d --force-recreate api frontend 2>&1 && docker compose restart nginx 2>&1')
    print(o.read().decode("utf-8","replace")[-300:])
    time.sleep(20)

    print("--- Testing ---")
    i,o,e = ssh.exec_command('docker exec sc-api curl -s -X POST http://localhost:8000/api/v1/auth/login -H "Content-Type: application/json" -d \'{"email":"thang@songchau.vn","password":"SongChau@2026"}\'')
    try: token = json.loads(o.read().decode())["access_token"]
    except: print("AUTH FAILED"); return

    tests = [
        "GET /api/v1/documents?page=1",
        "GET /api/v1/security-log?page=1",
        "GET /api/v1/security-log/summary",
        "GET /api/v1/help/articles",
        "GET /api/v1/user-activity/summary",
        # Regression
        "GET /api/v1/system-health/dashboard",
        "GET /api/v1/task-assignments/workload",
        "GET /api/v1/supplier-quotes",
        "GET /api/v1/price-analytics/overview?months=6",
    ]
    ok = 0
    for t in tests:
        m, p = t.split(" ",1)
        i,o,e = ssh.exec_command(f'docker exec sc-api curl -s -o /dev/null -w "%{{http_code}}" -H "Authorization: Bearer {token}" "http://localhost:8000{p}"')
        c = o.read().decode().strip()
        if c == "200": ok += 1
        print(f"  [{'PASS' if c=='200' else 'FAIL'}] {c} {t}")
    print(f"\n  Result: {ok}/{len(tests)} passed")
    print("=" * 60)
    sftp.close(); ssh.close()

if __name__ == "__main__": deploy()
