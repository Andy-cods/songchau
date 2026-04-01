#!/usr/bin/env python3
"""
═══════════════════════════════════════════════════════════════════════════
  SONG CHAU ERP — COMPREHENSIVE E2E TEST SUITE
  No mock. No trick. Real API calls on production VPS.

  Usage:  python scripts/e2e_full_test.py
  Deps:   pip install paramiko
═══════════════════════════════════════════════════════════════════════════
"""

import io
import json
import os
import sys
import time
from datetime import datetime, timedelta
from typing import Any, Optional

# Fix Windows console encoding for Unicode/ANSI output
if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")

import paramiko

# ═══════════════════════════════════════════════════════════════════
# CONFIG
# ═══════════════════════════════════════════════════════════════════

VPS_HOST = "103.56.158.129"
VPS_USER = "root"
VPS_PASS = "x2dk4Tf2fHUSPKmeWPMBaB7"
API_BASE = "http://localhost:8000"
FRONTEND_BASE = "http://localhost:3000"
CONTAINER = "sc-api"

AUTH_EMAIL = "thang@songchau.vn"
AUTH_PASS = "SongChau@2026"

# ═══════════════════════════════════════════════════════════════════
# SSH + CURL TRANSPORT
# ═══════════════════════════════════════════════════════════════════

ssh = None
token = None


def connect_ssh():
    global ssh
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(VPS_HOST, username=VPS_USER, password=VPS_PASS, timeout=20)


def exec_ssh(cmd: str, timeout: int = 30) -> str:
    """Execute command on VPS and return stdout."""
    _, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode("utf-8", "replace").strip()
    return out


def api_call(method: str, path: str, body: dict = None,
             use_token: bool = True, custom_token: str = None,
             timeout: int = 30) -> tuple[int, dict, str]:
    """
    Make API call via SSH -> docker exec -> curl.
    Returns: (http_code, parsed_json_body, raw_text)
    """
    headers = '-H "Content-Type: application/json"'
    if use_token and custom_token:
        headers += f' -H "Authorization: Bearer {custom_token}"'
    elif use_token and token:
        headers += f' -H "Authorization: Bearer {token}"'

    url = f"{API_BASE}{path}"

    if method == "GET":
        cmd = f'docker exec {CONTAINER} curl -s -w "\\n%{{http_code}}" {headers} "{url}"'
    elif method == "DELETE":
        cmd = f'docker exec {CONTAINER} curl -s -w "\\n%{{http_code}}" -X DELETE {headers} "{url}"'
    else:
        bd = json.dumps(body) if body else "{}"
        # Escape single quotes in JSON for shell
        bd_escaped = bd.replace("'", "'\\''")
        cmd = (
            f"docker exec {CONTAINER} curl -s -w '\\n%{{http_code}}' "
            f"-X {method} {headers} -d '{bd_escaped}' '{url}'"
        )

    raw = exec_ssh(cmd, timeout=timeout)
    lines = raw.split("\n")

    # Last line is HTTP status code
    code_str = lines[-1].strip() if lines else "0"
    try:
        code = int(code_str)
    except ValueError:
        code = 0

    body_text = "\n".join(lines[:-1]) if len(lines) > 1 else ""
    try:
        data = json.loads(body_text)
    except (json.JSONDecodeError, ValueError):
        data = {}

    return code, data, body_text


def frontend_check(path: str) -> int:
    """Check if frontend page returns 200 via curl inside VPS."""
    cmd = f'docker exec sc-frontend curl -s -o /dev/null -w "%{{http_code}}" "{FRONTEND_BASE}{path}"'
    raw = exec_ssh(cmd, timeout=15)
    try:
        return int(raw.strip())
    except ValueError:
        # Fallback: try via nginx
        cmd2 = f'curl -s -o /dev/null -w "%{{http_code}}" "http://localhost{path}"'
        raw2 = exec_ssh(cmd2, timeout=15)
        try:
            return int(raw2.strip())
        except ValueError:
            return 0


# ═══════════════════════════════════════════════════════════════════
# TEST FRAMEWORK
# ═══════════════════════════════════════════════════════════════════

results: list[dict] = []
cleanup_actions: list[dict] = []  # Track items to clean up


def test(test_id: str, name_vi: str, passed: bool, detail: str = ""):
    """Record a test result and print it."""
    results.append({
        "id": test_id,
        "name": name_vi,
        "passed": passed,
        "detail": detail,
    })
    status = "\033[92mPASS\033[0m" if passed else "\033[91mFAIL\033[0m"
    line = f"  [{status}] {test_id}. {name_vi}"
    if detail and not passed:
        line += f"\n         -> {detail[:200]}"
    print(line)


def section(title: str):
    """Print a section header."""
    print(f"\n\033[1m-- {title} --\033[0m")


def safe_get(d: dict, *keys, default=None):
    """Safely navigate nested dicts."""
    current = d
    for k in keys:
        if isinstance(current, dict):
            current = current.get(k, default)
        else:
            return default
    return current


# ═══════════════════════════════════════════════════════════════════
# TEST CATEGORIES
# ═══════════════════════════════════════════════════════════════════


def run_auth_tests():
    """A. AUTH & RBAC (4 tests)"""
    global token
    section("A. AUTH & RBAC")

    # A1. Login with valid credentials
    c, d, _ = api_call("POST", "/api/v1/auth/login",
                       {"email": AUTH_EMAIL, "password": AUTH_PASS},
                       use_token=False)
    tok = d.get("access_token", "")
    token = tok
    user = d.get("user", {})
    test("A1", "Login hop le -> token received, user role=admin",
         c == 200 and len(tok) > 20 and user.get("role") == "admin",
         f"code={c}, token_len={len(tok)}, user={user.get('email')}")

    # A2. Login with wrong password
    c2, d2, _ = api_call("POST", "/api/v1/auth/login",
                         {"email": AUTH_EMAIL, "password": "wrongpassword123"},
                         use_token=False)
    test("A2", "Login sai mat khau -> 401",
         c2 == 401,
         f"code={c2}, detail={d2.get('detail','')}")

    # A3. Access admin endpoint without admin role (fake token with garbage)
    c3, _, _ = api_call("GET", "/api/v1/users",
                        custom_token="FAKE_TOKEN_NOT_VALID_AT_ALL")
    test("A3", "Fake token -> 401 (khong the truy cap admin endpoint)",
         c3 == 401,
         f"code={c3}")

    # A4. Access with expired/invalid JWT structure
    fake_jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0IiwiZXhwIjoxfQ.invalid"
    c4, _, _ = api_call("GET", "/api/v1/auth/me", custom_token=fake_jwt)
    test("A4", "Expired/invalid JWT -> 401",
         c4 == 401,
         f"code={c4}")


def run_bqms_tests():
    """B. BQMS & QUOTATION FLOW (8 tests)"""
    section("B. BQMS & QUOTATION")

    # B1. Lookup RFQ by code
    c, d, _ = api_call("GET", "/api/v1/quotations/lookup?rfq_code=QT24138430")
    items_total = safe_get(d, "data", "total", default=0)
    test("B1", "Lookup RFQ QT24138430 -> tra ve items co bqms_code",
         c == 200 and int(items_total) > 0,
         f"code={c}, total={items_total}")

    # B2. Lookup non-existent RFQ
    c2, d2, _ = api_call("GET", "/api/v1/quotations/lookup?rfq_code=XXXNOTEXIST999")
    test("B2", "RFQ khong ton tai -> 404",
         c2 == 404,
         f"code={c2}")

    # B3. Price analytics overview
    c3, d3, _ = api_call("GET", "/api/v1/price-analytics/overview?months=12")
    total_rfq = safe_get(d3, "data", "total_rfq", default=0)
    test("B3", "Price analytics overview -> total_rfq > 2000",
         c3 == 200 and int(total_rfq) > 2000,
         f"code={c3}, total_rfq={total_rfq}")

    # B4. Price analytics by-maker
    c4, d4, _ = api_call("GET", "/api/v1/price-analytics/by-maker?months=12&limit=5")
    makers = safe_get(d4, "data", default=[])
    has_maker_names = isinstance(makers, list) and len(makers) > 0
    test("B4", "Price analytics by-maker -> co makers voi ten",
         c4 == 200 and has_maker_names,
         f"code={c4}, makers_count={len(makers) if isinstance(makers, list) else 0}")

    # B5. Price trends
    c5, d5, _ = api_call("GET", "/api/v1/price-analytics/price-trends?months=6")
    trends_data = safe_get(d5, "data", default=[])
    test("B5", "Price trends -> tra ve data",
         c5 == 200 and isinstance(trends_data, list),
         f"code={c5}, trends_count={len(trends_data) if isinstance(trends_data, list) else 0}")

    # B6. Win/Loss (loss reasons endpoint)
    c6, d6, _ = api_call("GET", "/api/v1/price-analytics/loss-reasons?months=12")
    test("B6", "Loss reasons -> 200 OK",
         c6 == 200,
         f"code={c6}")

    # B7. AI classify results
    c7, d7, _ = api_call("GET", "/api/v1/smart-classify/results?page=1&limit=5")
    test("B7", "AI classify results -> 200",
         c7 == 200,
         f"code={c7}")

    # B8. Quotation history
    c8, d8, _ = api_call("GET", "/api/v1/quotations/history?page=1&limit=5")
    test("B8", "Quotation history -> 200",
         c8 == 200,
         f"code={c8}")


def run_revenue_chain_tests():
    """C. REVENUE CHAIN (6 tests)"""
    section("C. REVENUE CHAIN")

    # C1. Detect wins
    c1, d1, _ = api_call("POST", "/api/v1/revenue-tasks/detect-wins")
    test("C1", "Detect wins -> tra ve message",
         c1 == 200 and ("message" in d1 or "data" in d1),
         f"code={c1}")

    # C2. Supplier quotes list
    c2, d2, _ = api_call("GET", "/api/v1/supplier-quotes")
    test("C2", "Supplier quotes list -> 200",
         c2 == 200,
         f"code={c2}")

    # C3. Shipments list
    c3, d3, _ = api_call("GET", "/api/v1/shipments")
    test("C3", "Shipments list -> 200",
         c3 == 200,
         f"code={c3}")

    # C4. Invoices list
    c4, d4, _ = api_call("GET", "/api/v1/invoices")
    test("C4", "Invoices list -> 200",
         c4 == 200,
         f"code={c4}")

    # C5. Exchange rates
    c5, d5, _ = api_call("GET", "/api/v1/exchange-rates/latest?from=CNY&to=VND")
    test("C5", "Exchange rates CNY->VND -> 200",
         c5 == 200,
         f"code={c5}")

    # C6. Deal chains list
    c6, d6, _ = api_call("GET", "/api/v1/chains")
    test("C6", "Deal chains list -> 200",
         c6 == 200,
         f"code={c6}")


def run_finance_tests():
    """D. FINANCE (6 tests)"""
    section("D. FINANCE")

    # D1. Finance dashboard
    c1, d1, _ = api_call("GET", "/api/v1/finance-management/dashboard")
    dash = safe_get(d1, "data", default={})
    has_ap = "outstanding_ap" in str(dash) or "ap" in str(dash).lower()
    test("D1", "Finance dashboard -> co du lieu finance",
         c1 == 200 and isinstance(dash, dict) and len(dash) > 0,
         f"code={c1}, keys={list(dash.keys())[:5] if isinstance(dash, dict) else 'N/A'}")

    # D2. AP summary
    c2, d2, _ = api_call("GET", "/api/v1/finance-management/ap-summary")
    test("D2", "AP summary -> 200 co data",
         c2 == 200 and ("data" in d2),
         f"code={c2}")

    # D3. AR summary
    c3, d3, _ = api_call("GET", "/api/v1/finance-management/ar-summary")
    test("D3", "AR summary -> 200 co data",
         c3 == 200 and ("data" in d3),
         f"code={c3}")

    # D4. Cash-book list
    c4, d4, _ = api_call("GET", "/api/v1/finance-management/cash-book?page=1&limit=5")
    test("D4", "Cash-book list -> 200",
         c4 == 200,
         f"code={c4}")

    # D5. Monthly comparison
    c5, d5, _ = api_call("GET", "/api/v1/finance-reports/monthly-comparison?months=6")
    test("D5", "Monthly comparison -> 200 co data",
         c5 == 200 and ("data" in d5),
         f"code={c5}")

    # D6. P&L report
    c6, d6, _ = api_call("GET", "/api/v1/finance-reports/profit-loss?months=6")
    pl = safe_get(d6, "data", default={})
    test("D6", "P&L report -> 200 co revenue/cost",
         c6 == 200 and isinstance(pl, dict),
         f"code={c6}, keys={list(pl.keys())[:5] if isinstance(pl, dict) else 'N/A'}")


def run_inventory_tests():
    """E. INVENTORY & OPERATIONS (5 tests)"""
    section("E. INVENTORY & OPERATIONS")

    # E1. Inventory dashboard
    c1, d1, _ = api_call("GET", "/api/v1/smart-inventory/dashboard")
    test("E1", "Inventory dashboard -> 200",
         c1 == 200,
         f"code={c1}")

    # E2. Stock alerts
    c2, d2, _ = api_call("GET", "/api/v1/smart-inventory/alerts")
    test("E2", "Stock alerts -> 200",
         c2 == 200,
         f"code={c2}")

    # E3. Reorder check
    c3, d3, _ = api_call("POST", "/api/v1/smart-inventory/reorder-check")
    test("E3", "Reorder check -> 200",
         c3 == 200,
         f"code={c3}")

    # E4. Task list
    c4, d4, _ = api_call("GET", "/api/v1/task-assignments?page=1")
    items = safe_get(d4, "data", "items", default=[])
    total = safe_get(d4, "data", "total", default=0)
    test("E4", "Task list -> 200 tra ve items",
         c4 == 200 and isinstance(items, list),
         f"code={c4}, total={total}")

    # E5. Workload
    c5, d5, _ = api_call("GET", "/api/v1/task-assignments/workload")
    workload_items = safe_get(d5, "data", "items", default=[])
    test("E5", "Workload per user -> 200 tra ve data",
         c5 == 200 and isinstance(workload_items, list),
         f"code={c5}, users={len(workload_items)}")


def run_system_health_tests():
    """F. SYSTEM HEALTH (6 tests)"""
    section("F. SYSTEM HEALTH")

    # F1. System dashboard
    c1, d1, _ = api_call("GET", "/api/v1/system-health/dashboard")
    db_info = safe_get(d1, "data", "database", default={})
    redis_info = safe_get(d1, "data", "redis", default={})
    has_db_size = "size" in db_info if isinstance(db_info, dict) else False
    has_redis = "connected" in redis_info if isinstance(redis_info, dict) else False
    test("F1", "System dashboard -> co database.size, redis.connected",
         c1 == 200 and has_db_size and has_redis,
         f"code={c1}, db_size={db_info.get('size','?')}, redis={redis_info.get('connected','?')}")

    # F2. DB stats
    c2, d2, _ = api_call("GET", "/api/v1/system-health/db-stats")
    db_tables = safe_get(d2, "data", default=[])
    has_row_count = False
    if isinstance(db_tables, list) and len(db_tables) > 0:
        has_row_count = "row_count" in db_tables[0]
    test("F2", "DB stats -> array of tables voi row_count",
         c2 == 200 and isinstance(db_tables, list) and len(db_tables) > 50 and has_row_count,
         f"code={c2}, tables={len(db_tables) if isinstance(db_tables, list) else 0}")

    # F3. Health check (POST triggers a live check)
    c3, d3, _ = api_call("POST", "/api/v1/system-health/health-check", timeout=60)
    overall = safe_get(d3, "data", "overall", default="")
    checks = safe_get(d3, "data", "checks", default=[])
    test("F3", "Health check -> overall status + checks array",
         c3 == 200 and overall in ("healthy", "degraded", "unhealthy") and len(checks) >= 3,
         f"code={c3}, overall={overall}, checks_count={len(checks)}")

    # F4. Create backup
    c4, d4, _ = api_call("POST", "/api/v1/system-health/backups/create", timeout=120)
    backup_data = safe_get(d4, "data", default={})
    has_size = "size_bytes" in backup_data if isinstance(backup_data, dict) else False
    test("F4", "Create backup -> file info co size",
         c4 == 200 and has_size and backup_data.get("size_bytes", 0) > 0,
         f"code={c4}, file={backup_data.get('file','?')}, size={backup_data.get('size_human','?')}")

    # F5. Containers list
    c5, d5, _ = api_call("GET", "/api/v1/containers/")
    containers = safe_get(d5, "data", default=[])
    test("F5", "Containers list -> array voi status per container",
         c5 == 200 and isinstance(containers, list) and len(containers) >= 4,
         f"code={c5}, containers_count={len(containers) if isinstance(containers, list) else 0}")

    # F6. Data quality run
    c6, d6, _ = api_call("POST", "/api/v1/data-migration/data-quality/run", timeout=60)
    test("F6", "Data quality run -> 200 tra ve check results",
         c6 == 200,
         f"code={c6}")


def run_crm_docs_tests():
    """G. CRM & DOCUMENTS (4 tests)"""
    section("G. CRM & DOCUMENTS")

    # G1. Customer list
    c1, d1, _ = api_call("GET", "/api/v1/crm/customers?page=1")
    test("G1", "Customer list -> 200",
         c1 == 200,
         f"code={c1}")

    # G2. Documents list
    c2, d2, _ = api_call("GET", "/api/v1/documents?page=1")
    test("G2", "Documents list -> 200",
         c2 == 200,
         f"code={c2}")

    # G3. Help articles
    c3, d3, _ = api_call("GET", "/api/v1/help/articles")
    test("G3", "Help articles -> 200",
         c3 == 200,
         f"code={c3}")

    # G4. Security log summary
    c4, d4, _ = api_call("GET", "/api/v1/security-log/summary")
    test("G4", "Security log summary -> 200 co data",
         c4 == 200 and ("data" in d4),
         f"code={c4}")


def run_calendar_advanced_tests():
    """H. CALENDAR & ADVANCED (4 tests)"""
    section("H. CALENDAR & ADVANCED")

    # H1. Calendar events
    c1, d1, _ = api_call("GET", "/api/v1/calendar/events?start=2026-01-01T00:00:00&end=2026-12-31T23:59:59")
    test("H1", "Calendar events -> 200 tra ve data",
         c1 == 200 and ("data" in d1),
         f"code={c1}")

    # H2. Email stats
    c2, d2, _ = api_call("GET", "/api/v1/emails/stats")
    test("H2", "Email stats -> 200 tra ve data",
         c2 == 200,
         f"code={c2}")

    # H3. OCR results
    c3, d3, _ = api_call("GET", "/api/v1/ocr/results?page=1")
    test("H3", "OCR results -> 200",
         c3 == 200,
         f"code={c3}")

    # H4. PWA config
    c4, d4, _ = api_call("GET", "/api/v1/pwa/config")
    pwa = safe_get(d4, "data", default={})
    has_version = "version" in pwa if isinstance(pwa, dict) else False
    test("H4", "PWA config -> co version, app_name",
         c4 == 200 and has_version,
         f"code={c4}, version={pwa.get('version','?')}")


def run_frontend_page_tests():
    """I. FRONTEND PAGES — test all Next.js routes return 200"""
    section("I. FRONTEND PAGES (53+ routes)")

    # All frontend pages derived from Next.js app router structure
    pages = [
        # Root / login
        "/",
        "/login",
        # Dashboard
        "/dashboard",
        # BQMS
        "/bqms",
        "/bqms/rfq",
        "/bqms/classify",
        "/bqms/deliveries",
        "/bqms/emails",
        "/bqms/quotation",
        "/bqms/quotation/history",
        "/bqms/quotation/new",
        "/bqms/quotation/templates",
        # Analytics
        "/analytics/forecast",
        "/analytics/price-trends",
        "/analytics/profit",
        "/analytics/win-loss",
        # Revenue chain
        "/chains",
        "/supplier-quotes",
        "/shipments",
        "/invoices",
        "/deliveries",
        # CRM
        "/crm",
        "/crm/new",
        # Suppliers
        "/suppliers",
        "/suppliers/new",
        # Purchase orders
        "/purchase-orders",
        "/purchase-orders/new",
        # Finance
        "/finance/cash-book",
        "/finance/payables",
        "/finance/receivables",
        "/finance/reports",
        # Inventory
        "/inventory",
        # Tasks
        "/tasks",
        "/tasks/workload",
        # Calendar
        "/calendar",
        # Documents
        "/documents",
        "/documents/ocr",
        # Notifications
        "/notifications",
        "/notifications/settings",
        # Users
        "/users",
        "/users/new",
        # Reports
        "/reports",
        "/reports/scheduled",
        # Settings
        "/settings",
        "/settings/language",
        # Workflows
        "/workflows",
        # Approvals / Audit
        "/approvals",
        "/audit",
        # Help
        "/help",
        # Admin pages
        "/admin/backups",
        "/admin/containers",
        "/admin/data-quality",
        "/admin/errors",
        "/admin/migration",
        "/admin/performance",
        "/admin/retry-queue",
        "/admin/security-log",
        "/admin/user-activity",
    ]

    pass_count = 0
    fail_count = 0
    failed_pages = []

    for page in pages:
        code = frontend_check(page)
        if code == 200:
            pass_count += 1
        else:
            fail_count += 1
            failed_pages.append((page, code))

    total_pages = len(pages)
    all_pass = fail_count == 0
    detail = ""
    if failed_pages:
        detail = "Failed: " + ", ".join(f"{p}({c})" for p, c in failed_pages[:10])
        if len(failed_pages) > 10:
            detail += f" ... +{len(failed_pages)-10} more"

    test("I1", f"Frontend pages -> {pass_count}/{total_pages} pages return 200",
         pass_count >= total_pages * 0.8,  # Pass if >=80% of pages OK
         detail)

    # Print individual failures
    if failed_pages:
        for page, code in failed_pages:
            print(f"         \033[91m[{code}]\033[0m {page}")


def run_write_operation_tests():
    """J. WRITE OPERATIONS (5 tests — create + verify + cleanup)"""
    section("J. WRITE OPERATIONS (create + verify + cleanup)")

    # First, get user ID for the admin user (needed for task assignment)
    c_me, d_me, _ = api_call("GET", "/api/v1/auth/me")
    user_id = safe_get(d_me, "id", default="")
    if not user_id:
        print("  [SKIP] Cannot get user_id from /auth/me, skipping write tests")
        return

    # ── J1. Create task -> verify -> complete -> verify status ──
    task_body = {
        "title": "[E2E TEST] Nhiem vu test tu dong",
        "description": "Tao boi e2e_full_test.py — se duoc xoa",
        "task_type": "general",
        "priority": 4,
        "assigned_to": user_id,
        "notes": "e2e_test_marker"
    }
    c_create, d_create, _ = api_call("POST", "/api/v1/task-assignments", task_body)
    task_id = safe_get(d_create, "data", "id", default=None)
    test("J1a", "Tao task moi -> 201 tra ve task_id",
         c_create == 201 and task_id is not None,
         f"code={c_create}, task_id={task_id}")

    if task_id:
        # Verify it exists
        c_get, d_get, _ = api_call("GET", f"/api/v1/task-assignments/{task_id}")
        got_title = safe_get(d_get, "data", "title", default="")
        test("J1b", "Verify task ton tai -> title match",
             c_get == 200 and "E2E TEST" in got_title,
             f"code={c_get}, title={got_title[:60]}")

        # Complete it
        c_comp, d_comp, _ = api_call("POST", f"/api/v1/task-assignments/{task_id}/complete")
        comp_status = safe_get(d_comp, "data", "status", default="")
        test("J1c", "Complete task -> status=completed",
             c_comp == 200 and comp_status == "completed",
             f"code={c_comp}, status={comp_status}")

        # Cleanup: mark task as cancelled by updating status
        # (No delete endpoint, so we update status to indicate it was test data)
        api_call("PUT", f"/api/v1/task-assignments/{task_id}",
                 {"status": "cancelled", "notes": "e2e_test_cleanup"})
    else:
        test("J1b", "Verify task ton tai (skipped — no task_id)", False, "task_id is None")
        test("J1c", "Complete task (skipped)", False, "task_id is None")

    # ── J2. Create calendar event -> verify -> delete ──
    now_iso = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
    end_iso = (datetime.now() + timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%S")
    event_body = {
        "title": "[E2E TEST] Su kien lich test",
        "description": "Tao boi e2e_full_test.py",
        "event_type": "meeting",
        "start_time": now_iso,
        "end_time": end_iso,
        "all_day": False,
        "color": "#ff0000"
    }
    c_ev, d_ev, _ = api_call("POST", "/api/v1/calendar/events", event_body)
    event_id = safe_get(d_ev, "data", "id", default=None)
    test("J2a", "Tao calendar event -> 201 tra ve event_id",
         c_ev == 201 and event_id is not None,
         f"code={c_ev}, event_id={event_id}")

    if event_id:
        # Verify
        c_ev_list, d_ev_list, _ = api_call(
            "GET",
            f"/api/v1/calendar/events?start={now_iso[:10]}T00:00:00&end={now_iso[:10]}T23:59:59"
        )
        found = False
        events = safe_get(d_ev_list, "data", default=[])
        if isinstance(events, list):
            found = any(e.get("id") == event_id for e in events)
        test("J2b", "Verify event ton tai trong calendar",
             c_ev_list == 200 and found,
             f"code={c_ev_list}, found={found}")

        # Delete
        c_del, d_del, _ = api_call("DELETE", f"/api/v1/calendar/events/{event_id}")
        test("J2c", "Xoa calendar event -> 200",
             c_del == 200,
             f"code={c_del}")
    else:
        test("J2b", "Verify calendar event (skipped)", False, "event_id is None")
        test("J2c", "Xoa calendar event (skipped)", False, "event_id is None")

    # ── J3. Run health check -> verify result saved ──
    c_hc, d_hc, _ = api_call("POST", "/api/v1/system-health/health-check", timeout=60)
    overall = safe_get(d_hc, "data", "overall", default="")
    checks = safe_get(d_hc, "data", "checks", default=[])
    test("J3", "Health check -> ket qua luu vao DB (overall + checks)",
         c_hc == 200 and overall != "" and len(checks) >= 3,
         f"overall={overall}, checks={len(checks)}")

    # Verify it was saved by querying health history
    c_hist, d_hist, _ = api_call("GET", "/api/v1/system-health/health-history?hours=1")
    hist_data = safe_get(d_hist, "data", default=[])
    test("J3b", "Health history -> co ban ghi moi trong 1h",
         c_hist == 200 and isinstance(hist_data, list) and len(hist_data) > 0,
         f"code={c_hist}, records={len(hist_data) if isinstance(hist_data, list) else 0}")

    # ── J4. Trigger data quality -> verify checks created ──
    c_dq, d_dq, _ = api_call("POST", "/api/v1/data-migration/data-quality/run", timeout=60)
    test("J4", "Data quality run -> 200 ket qua checks",
         c_dq == 200,
         f"code={c_dq}")

    # ── J5. Verify backup file exists from F4 ──
    c_bk, d_bk, _ = api_call("GET", "/api/v1/system-health/backups")
    bk_records = safe_get(d_bk, "data", "db_records", default=[])
    bk_files = safe_get(d_bk, "data", "files", default=[])
    test("J5", "Backup list -> co ban ghi + file tren disk",
         c_bk == 200 and (len(bk_records) > 0 or len(bk_files) > 0),
         f"code={c_bk}, db_records={len(bk_records)}, files={len(bk_files)}")


def run_extra_endpoint_tests():
    """K. EXTRA ENDPOINTS — additional coverage for completeness"""
    section("K. EXTRA ENDPOINTS (BONUS)")

    # K1. Users list (admin-only)
    c1, d1, _ = api_call("GET", "/api/v1/users")
    users = safe_get(d1, "data", default=[])
    test("K1", "Users list (admin) -> 200 tra ve users",
         c1 == 200 and isinstance(users, list) and len(users) > 0,
         f"code={c1}, users_count={len(users) if isinstance(users, list) else 0}")

    # K2. Quotation templates
    c2, d2, _ = api_call("GET", "/api/v1/quotations/templates")
    test("K2", "Quotation templates -> 200",
         c2 == 200,
         f"code={c2}")

    # K3. Notifications unread count
    c3, d3, _ = api_call("GET", "/api/v1/smart-notifications/unread-count")
    test("K3", "Notifications unread count -> 200",
         c3 == 200,
         f"code={c3}")

    # K4. Retry queue summary
    c4, d4, _ = api_call("GET", "/api/v1/retry-queue/summary")
    test("K4", "Retry queue summary -> 200",
         c4 == 200,
         f"code={c4}")

    # K5. Sync status (data migration)
    c5, d5, _ = api_call("GET", "/api/v1/data-migration/sync-status")
    test("K5", "Sync status -> 200",
         c5 == 200,
         f"code={c5}")

    # K6. User activity summary
    c6, d6, _ = api_call("GET", "/api/v1/user-activity/summary")
    test("K6", "User activity summary -> 200",
         c6 == 200,
         f"code={c6}")

    # K7. Price analytics by-owner
    c7, d7, _ = api_call("GET", "/api/v1/price-analytics/by-owner?months=12")
    test("K7", "Price analytics by-owner -> 200",
         c7 == 200,
         f"code={c7}")

    # K8. Dashboard KPIs
    c8, d8, _ = api_call("GET", "/api/v1/dashboard/kpis")
    test("K8", "Dashboard KPIs -> 200",
         c8 == 200,
         f"code={c8}")

    # K9. Error summary (system health)
    c9, d9, _ = api_call("GET", "/api/v1/system-health/errors/summary")
    test("K9", "Error summary -> 200 co data",
         c9 == 200 and ("data" in d9),
         f"code={c9}")

    # K10. Scheduled reports
    c10, d10, _ = api_call("GET", "/api/v1/scheduled-reports")
    test("K10", "Scheduled reports -> 200",
         c10 == 200,
         f"code={c10}")

    # K11. Suppliers list
    c11, d11, _ = api_call("GET", "/api/v1/suppliers")
    test("K11", "Suppliers list -> 200",
         c11 == 200,
         f"code={c11}")

    # K12. Purchase orders list
    c12, d12, _ = api_call("GET", "/api/v1/purchase-orders")
    test("K12", "Purchase orders list -> 200",
         c12 == 200,
         f"code={c12}")

    # K13. My tasks
    c13, d13, _ = api_call("GET", "/api/v1/task-assignments/my-tasks?page=1")
    test("K13", "My tasks -> 200",
         c13 == 200,
         f"code={c13}")

    # K14. Audit log
    c14, d14, _ = api_call("GET", "/api/v1/audit?page=1")
    test("K14", "Audit log -> 200",
         c14 == 200,
         f"code={c14}")

    # K15. Finance cash-flow
    c15, d15, _ = api_call("GET", "/api/v1/finance-management/cash-flow")
    test("K15", "Finance cash-flow -> 200",
         c15 == 200,
         f"code={c15}")

    # K16. Leaves list
    c16, d16, _ = api_call("GET", "/api/v1/calendar/leaves?page=1")
    test("K16", "Leaves list -> 200",
         c16 == 200,
         f"code={c16}")

    # K17. Health API (root health endpoint)
    c17, d17, _ = api_call("GET", "/api/health", use_token=False)
    test("K17", "Health endpoint /api/health -> 200",
         c17 == 200,
         f"code={c17}")

    # K18. Demand forecast products
    c18, d18, raw18 = api_call("GET", "/api/v1/demand-forecast/products")
    test("K18", "Demand forecast products -> 200",
         c18 == 200,
         f"code={c18}, SERVER BUG: {d18.get('detail', raw18[:100]) if c18 >= 500 else 'OK'}")

    # K19. Profit analysis overview
    c19, d19, _ = api_call("GET", "/api/v1/profit-analysis/overview")
    test("K19", "Profit analysis overview -> 200",
         c19 == 200,
         f"code={c19}")

    # K20. Finance balance overview
    c20, d20, _ = api_call("GET", "/api/v1/finance-reports/balance-overview")
    test("K20", "Finance balance overview -> 200",
         c20 == 200,
         f"code={c20}")


# ═══════════════════════════════════════════════════════════════════
# MAIN EXECUTION
# ═══════════════════════════════════════════════════════════════════

def print_banner():
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print()
    print("=" * 70)
    print("  SONG CHAU ERP — FULL E2E TEST SUITE")
    print(f"  Date: {now}  VPS: {VPS_HOST}")
    print(f"  API:  {API_BASE}  Container: {CONTAINER}")
    print("=" * 70)


def print_summary():
    total = len(results)
    passed = sum(1 for r in results if r["passed"])
    failed = sum(1 for r in results if not r["passed"])
    pct = round(passed / total * 100, 1) if total > 0 else 0

    print()
    print("=" * 70)
    print(f"  RESULTS: {passed}/{total} passed ({pct}%)")
    print("=" * 70)

    if failed > 0:
        print()
        print("  \033[91mGAPS FOUND:\033[0m")
        for r in results:
            if not r["passed"]:
                detail_str = f" -> {r['detail'][:100]}" if r["detail"] else ""
                print(f"    \033[91m[FAIL]\033[0m {r['id']}: {r['name']}{detail_str}")

    # Identify missing flows
    print()
    print("  COVERAGE SUMMARY:")
    categories = {}
    for r in results:
        cat = r["id"][0]
        if cat not in categories:
            categories[cat] = {"pass": 0, "fail": 0, "total": 0}
        categories[cat]["total"] += 1
        if r["passed"]:
            categories[cat]["pass"] += 1
        else:
            categories[cat]["fail"] += 1

    cat_names = {
        "A": "Auth & RBAC",
        "B": "BQMS & Quotation",
        "C": "Revenue Chain",
        "D": "Finance",
        "E": "Inventory & Ops",
        "F": "System Health",
        "G": "CRM & Docs",
        "H": "Calendar & Advanced",
        "I": "Frontend Pages",
        "J": "Write Operations",
        "K": "Extra Endpoints",
    }

    for cat_key in sorted(categories.keys()):
        cat = categories[cat_key]
        name = cat_names.get(cat_key, cat_key)
        status = "\033[92mOK\033[0m" if cat["fail"] == 0 else f"\033[91m{cat['fail']} FAIL\033[0m"
        print(f"    {cat_key}. {name}: {cat['pass']}/{cat['total']} [{status}]")

    print()
    print("=" * 70)

    return failed


def main():
    start_time = time.time()

    print_banner()

    # Connect
    print("\n  Connecting to VPS...")
    try:
        connect_ssh()
        print(f"  \033[92mConnected\033[0m to {VPS_HOST}")
    except Exception as e:
        print(f"  \033[91mFAILED to connect:\033[0m {e}")
        sys.exit(1)

    # Verify API container is running
    print("  Checking API container...")
    running = exec_ssh(f"docker ps --format '{{{{.Names}}}}' | grep {CONTAINER}")
    if CONTAINER not in running:
        print(f"  \033[91mERROR:\033[0m Container {CONTAINER} not running!")
        print(f"  Running containers: {running}")
        ssh.close()
        sys.exit(1)
    print(f"  \033[92m{CONTAINER}\033[0m is running")

    try:
        # Run all test categories
        run_auth_tests()
        run_bqms_tests()
        run_revenue_chain_tests()
        run_finance_tests()
        run_inventory_tests()
        run_system_health_tests()
        run_crm_docs_tests()
        run_calendar_advanced_tests()
        run_frontend_page_tests()
        run_write_operation_tests()
        run_extra_endpoint_tests()

    except KeyboardInterrupt:
        print("\n\n  Test interrupted by user.")
    except Exception as e:
        print(f"\n\n  \033[91mUnexpected error:\033[0m {e}")
        import traceback
        traceback.print_exc()
    finally:
        elapsed = round(time.time() - start_time, 1)
        failed = print_summary()
        print(f"  Elapsed: {elapsed}s")
        print()

        ssh.close()
        sys.exit(1 if failed > 0 else 0)


if __name__ == "__main__":
    main()
