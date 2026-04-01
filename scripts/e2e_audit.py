"""
E2E Audit — Real Life Cases — No Mock, No Trick
Tests ACTUAL business workflows on production VPS with real data.
"""
import paramiko, json, sys

VPS = "103.56.158.129"
PASS = "x2dk4Tf2fHUSPKmeWPMBaB7"

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(VPS, username="root", password=PASS, timeout=15)

# Auth
i,o,e = ssh.exec_command('docker exec sc-api curl -s -X POST http://localhost:8000/api/v1/auth/login -H "Content-Type: application/json" -d \'{"email":"thang@songchau.vn","password":"SongChau@2026"}\'')
token = json.loads(o.read().decode())["access_token"]

results = []

def api(method, path, body=None):
    if method == "GET":
        cmd = f'docker exec sc-api curl -s -w "\\n%{{http_code}}" -H "Authorization: Bearer {token}" "http://localhost:8000{path}"'
    else:
        bd = json.dumps(body) if body else "{}"
        cmd = f"docker exec sc-api curl -s -w '\\n%{{http_code}}' -X {method} -H 'Authorization: Bearer {token}' -H 'Content-Type: application/json' -d '{bd}' 'http://localhost:8000{path}'"
    i2,o2,e2 = ssh.exec_command(cmd)
    raw = o2.read().decode("utf-8", "replace").strip()
    lines = raw.split("\n")
    code = lines[-1] if lines else "0"
    try: data = json.loads("\n".join(lines[:-1]))
    except: data = {}
    return int(code), data

def test(name, passed, detail=""):
    results.append((name, passed))
    s = "PASS" if passed else "FAIL"
    print(f"  [{s}] {name}")
    if detail and not passed:
        print(f"         {detail[:120]}")

print("=" * 70)
print("  E2E AUDIT — REAL LIFE CASES")
print("=" * 70)

# ── CASE 1: RFQ Lookup + Quotation Flow ──
print("\n-- CASE 1: RFQ -> Bao gia --")
c, d = api("GET", "/api/v1/quotations/lookup?rfq_code=QT24138430")
test("1a. Lookup RFQ QT24138430", c == 200 and d.get("data",{}).get("total",0) > 0)

c, d = api("GET", "/api/v1/quotations/lookup?rfq_code=XXXNOTEXIST")
test("1b. RFQ khong ton tai -> 404", c == 404)

c, d = api("GET", "/api/v1/quotations/history?page=1&limit=5")
test("1c. Quotation history", c == 200)

c, d = api("GET", "/api/v1/quotations/templates")
test("1d. Templates list", c == 200)

# ── CASE 2: AI Classify ──
print("\n-- CASE 2: AI Classify --")
c, d = api("GET", "/api/v1/smart-classify/results?page=1&limit=5")
test("2a. Classify results", c == 200)

# ── CASE 3: Price Analytics (real data) ──
print("\n-- CASE 3: Price Analytics --")
c, d = api("GET", "/api/v1/price-analytics/overview?months=12")
ov = d.get("data", {})
test("3a. Overview total_rfq > 0", c == 200 and int(ov.get("total_rfq", 0)) > 0,
     f"total={ov.get('total_rfq')}")

c, d = api("GET", "/api/v1/price-analytics/by-maker?months=12&limit=5")
test("3b. By-maker has data", c == 200 and len(d.get("data",[])) > 0)

c, d = api("GET", "/api/v1/price-analytics/by-owner?months=12")
test("3c. By-owner", c == 200)

c, d = api("GET", "/api/v1/price-analytics/price-trends?months=6")
test("3d. Price trends", c == 200 and len(d.get("data",[])) > 0)

c, d = api("GET", "/api/v1/price-analytics/loss-reasons?months=12")
test("3e. Loss reasons", c == 200)

# ── CASE 4: Revenue Chain ──
print("\n-- CASE 4: Revenue Chain --")
c, d = api("POST", "/api/v1/revenue-tasks/detect-wins")
test("4a. Detect wins", c == 200)

c, d = api("GET", "/api/v1/chains")
test("4b. Chains list", c == 200)

c, d = api("GET", "/api/v1/supplier-quotes")
test("4c. Supplier quotes", c == 200)

c, d = api("GET", "/api/v1/shipments")
test("4d. Shipments", c == 200)

c, d = api("GET", "/api/v1/invoices")
test("4e. Invoices", c == 200)

c, d = api("GET", "/api/v1/exchange-rates/latest?from=CNY&to=VND")
test("4f. Exchange rates", c == 200)

# ── CASE 5: Inventory ──
print("\n-- CASE 5: Inventory --")
c, d = api("GET", "/api/v1/smart-inventory/dashboard")
test("5a. Inventory dashboard", c == 200)

c, d = api("GET", "/api/v1/smart-inventory/alerts")
test("5b. Stock alerts", c == 200)

c, d = api("POST", "/api/v1/smart-inventory/reorder-check")
test("5c. Reorder check", c == 200)

# ── CASE 6: Task Assignment ──
print("\n-- CASE 6: Tasks --")
c, d = api("GET", "/api/v1/task-assignments?page=1")
test("6a. Task list", c == 200)

c, d = api("GET", "/api/v1/task-assignments/workload")
test("6b. Workload", c == 200)

c, d = api("POST", "/api/v1/task-assignments/auto-assign")
test("6c. Auto-assign", c == 200)

# ── CASE 7: Finance ──
print("\n-- CASE 7: Finance --")
c, d = api("GET", "/api/v1/finance-management/dashboard")
test("7a. Finance dashboard", c == 200)

c, d = api("GET", "/api/v1/finance-management/ap-summary")
test("7b. AP summary", c == 200)

c, d = api("GET", "/api/v1/finance-management/ar-summary")
test("7c. AR summary", c == 200)

c, d = api("GET", "/api/v1/finance-reports/monthly-comparison?months=6")
test("7d. Monthly comparison", c == 200)

c, d = api("GET", "/api/v1/finance-reports/profit-loss?months=6")
test("7e. P&L report", c == 200)

# ── CASE 8: CRM ──
print("\n-- CASE 8: CRM --")
c, d = api("GET", "/api/v1/crm/customers?page=1")
test("8a. Customers list", c == 200)

# ── CASE 9: System Health ──
print("\n-- CASE 9: System --")
c, d = api("GET", "/api/v1/system-health/dashboard")
test("9a. System health", c == 200)

c, d = api("POST", "/api/v1/system-health/health-check")
test("9b. Live health check", c == 200)

c, d = api("GET", "/api/v1/data-migration/sync-status")
test("9c. Sync status", c == 200)

c, d = api("POST", "/api/v1/data-migration/data-quality/run")
test("9d. Data quality run", c == 200)

c, d = api("GET", "/api/v1/retry-queue/summary")
test("9e. Retry queue", c == 200)

c, d = api("GET", "/api/v1/containers")
test("9f. Containers", c == 200)

# ── CASE 10: Notifications + Docs + Calendar ──
print("\n-- CASE 10: Misc --")
c, d = api("GET", "/api/v1/smart-notifications/unread-count")
test("10a. Unread count", c == 200)

c, d = api("GET", "/api/v1/documents?page=1")
test("10b. Documents", c == 200)

c, d = api("GET", "/api/v1/security-log/summary")
test("10c. Security log", c == 200)

c, d = api("GET", "/api/v1/calendar/events?from=2026-04-01&to=2026-04-30")
test("10d. Calendar", c == 200)

c, d = api("GET", "/api/v1/help/articles")
test("10e. Help articles", c == 200)

c, d = api("GET", "/api/v1/user-activity/summary")
test("10f. User activity", c == 200)

c, d = api("GET", "/api/v1/emails/stats")
test("10g. Email stats", c == 200)

c, d = api("GET", "/api/v1/ocr/results?page=1")
test("10h. OCR results", c == 200)

c, d = api("GET", "/api/v1/pwa/config")
test("10i. PWA config", c == 200)

# ── CASE 11: Security ──
print("\n-- CASE 11: Security --")
i2,o2,e2 = ssh.exec_command('docker exec sc-api curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer FAKE_TOKEN" "http://localhost:8000/api/v1/quotations/templates"')
test("11a. Fake token -> 401", o2.read().decode().strip() == "401")

# ── SUMMARY ──
passed = sum(1 for _,p in results if p)
failed = sum(1 for _,p in results if not p)

print(f"\n{'=' * 70}")
print(f"  RESULT: {passed}/{len(results)} passed, {failed} failed")
print(f"{'=' * 70}")

if failed > 0:
    print(f"\n  GAPS:")
    for name, p in results:
        if not p:
            print(f"    [FAIL] {name}")

ssh.close()
