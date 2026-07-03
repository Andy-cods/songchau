"""CỤM TÀI CHÍNH — AP / AR / Summary / Balance (finance.py, finance_management.py,
finance_reports.py).

Bối cảnh: bộ e2e-master gắn cờ "dashboard AP/AR=0". Điều tra đã xác nhận đó KHÔNG
phải bug: bảng ``accounts_receivable`` & ``accounts_payable`` RỖNG trên prod (auto-
tạo AR/AP đang TẮT theo quyết định Thang + chưa nhập tay), nên mọi số 0 là ĐÚNG.
Bộ test này CHỨNG MINH điều đó theo 2 chiều đối xứng:

  * RỖNG  → endpoint trả 200 với total_outstanding == 0  (đúng — "AP/AR=0").
  * CÓ DATA → endpoint trả đúng số học đã seed              (endpoint đúng, "0" chỉ
    vì thiếu dữ liệu, không phải lỗi code-vs-schema).

Đồng thời khoá chống hồi quy 500 (mẫu "code viết trước schema" đã gặp ở
workflow/inventory/leave): mọi cột trong SQL phải tồn tại, mọi literal ``status``
phải ∈ payment_status, mọi so sánh ``direction`` phải ∈ payment_direction.

Chạy in-process qua ASGITransport (xem conftest). Mọi ghi nằm trong transaction
của fixture ``db`` và bị ROLLBACK — không rác prod.

────────────────────────────────────────────────────────────────────────────
GHI CHÚ RBAC — bám app/core/rbac.py THỰC TẾ (không bám giả định)
────────────────────────────────────────────────────────────────────────────
``require_role(*roles)`` mặc định ``allow_viewer=True`` ⇒ VIEWER được ĐỌC (GET)
MỌI endpoint (read-only toàn hệ), kể cả tài chính. Vì thế:
  * viewer GET /finance/summary, /finance-reports/balance-overview → 200 (KHÔNG 403).
  * staff / vendor (không nằm trong allowed_roles, không phải viewer) → 403.
  * /finance/* cho phép accountant|manager|admin; accountant → 200.
  * /finance-reports/* CHỈ cho manager|admin; accountant → 403 (khác /finance/*).
"""
from __future__ import annotations

import datetime as dt
import uuid

import pytest
import pytest_asyncio

pytestmark = pytest.mark.integration

FIN = "/api/v1/finance"
FIN_MGMT = "/api/v1/finance-management"
FIN_REPORTS = "/api/v1/finance-reports"


# ── Guard: chỉ chạy khi có full prod schema snapshot (bảng accounts_receivable/
#    accounts_payable/... chỉ tồn tại ở snapshot, không có ở bootstrap tối thiểu).
#    Fixture ASYNC + function-scope nhận schema_info như DEPENDENCY (KHÔNG dùng
#    request.getfixturevalue trên fixture async — gây RuntimeError loop). Mirror
#    cách test_crm.py làm. ───────────────────────────────────────────────────────
@pytest_asyncio.fixture(autouse=True)
async def _require_full_schema(request, schema_info):
    if request.node.get_closest_marker("integration") and not schema_info["full_schema"]:
        pytest.skip(
            "cần full prod schema snapshot tại tests/_schema_snapshot.sql "
            "(pg_dump --schema-only). Schema đang nạp: " + schema_info["source"]
        )


def _num(x):
    """Chuẩn hoá số JSON (Decimal-as-str/int/float) về float để so sánh."""
    return None if x is None else float(x)


def _uniq(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:10]}"


# ── Seed helpers (dùng `db` — cùng connection app request, rollback sau test) ──
# FK thật (xác minh trong _schema_snapshot.sql):
#   accounts_receivable.customer_id → customers(id); .created_by → users(id)
#   accounts_payable.supplier_id    → suppliers(id); .created_by → users(id)
# ⇒ phải seed customer/supplier + created_by là uuid user có thật (dùng id của
#   fixture role đang gọi).
async def _seed_customer(db, *, company_name="DEMO KH TC", code=None) -> int:
    """customers: company_name NOT NULL; is_active/version có DEFAULT."""
    code = code or _uniq("DEMO-CUS")
    return await db.fetchval(
        "INSERT INTO customers (customer_code, company_name) VALUES ($1, $2) RETURNING id",
        code, company_name,
    )


async def _seed_supplier(db, created_by, *, name=None) -> int:
    """suppliers: name NOT NULL, created_by NOT NULL (uuid); country DEFAULT 'CN'."""
    name = name or _uniq("DEMO NCC")
    return await db.fetchval(
        "INSERT INTO suppliers (name, created_by) VALUES ($1, $2::uuid) RETURNING id",
        name, created_by,
    )


async def _seed_ar(
    db, customer_id, created_by, *, amount, paid=0, status="pending",
    due_date=None, invoice_date=None, currency="VND",
) -> int:
    """accounts_receivable NOT NULL = customer_id, invoice_date, due_date, amount,
    paid_amount, status, created_by (created_at/updated_at có DEFAULT)."""
    invoice_date = invoice_date or dt.date.today()
    due_date = due_date if due_date is not None else (dt.date.today() + dt.timedelta(days=30))
    return await db.fetchval(
        """
        INSERT INTO accounts_receivable
            (customer_id, invoice_date, due_date, amount, currency,
             paid_amount, status, created_by)
        VALUES ($1, $2, $3, $4, $5::currency_code, $6, $7::payment_status, $8::uuid)
        RETURNING id
        """,
        customer_id, invoice_date, due_date, amount, currency, paid, status, created_by,
    )


async def _seed_ap(
    db, supplier_id, created_by, *, amount, paid=0, status="pending",
    due_date=None, invoice_date=None, currency="VND",
) -> int:
    """accounts_payable NOT NULL = supplier_id, invoice_date, due_date, amount,
    paid_amount, status, created_by."""
    invoice_date = invoice_date or dt.date.today()
    due_date = due_date if due_date is not None else (dt.date.today() + dt.timedelta(days=30))
    return await db.fetchval(
        """
        INSERT INTO accounts_payable
            (supplier_id, invoice_date, due_date, amount, currency,
             paid_amount, status, created_by)
        VALUES ($1, $2, $3, $4, $5::currency_code, $6, $7::payment_status, $8::uuid)
        RETURNING id
        """,
        supplier_id, invoice_date, due_date, amount, currency, paid, status, created_by,
    )


# Bộ dữ liệu chuẩn (deterministic) dùng lại nhiều test — số học chốt cứng ở đây:
#   AR: outstanding = 800k(pending, chưa tới hạn) + 500k(overdue) = 1_300_000
#       overdue_count=1, overdue_amount=500_000; aging.current=800k, b_0_30=500k
#   AP: outstanding = 2_000k(pending) + 2_000k(overdue) = 4_000_000
#       overdue_count=1, overdue_amount=2_000_000
AR_TOTAL_OUTSTANDING = 1_300_000
AR_OVERDUE_AMOUNT = 500_000
AP_TOTAL_OUTSTANDING = 4_000_000
AP_OVERDUE_AMOUNT = 2_000_000


async def _seed_two_ar(db, customer_id, created_by):
    today = dt.date.today()
    ar1 = await _seed_ar(db, customer_id, created_by, amount=1_000_000, paid=200_000,
                         status="pending", due_date=today + dt.timedelta(days=30))
    ar2 = await _seed_ar(db, customer_id, created_by, amount=500_000, paid=0,
                         status="overdue", due_date=today - dt.timedelta(days=10))
    return ar1, ar2


async def _seed_two_ap(db, supplier_id, created_by):
    today = dt.date.today()
    ap1 = await _seed_ap(db, supplier_id, created_by, amount=2_000_000, paid=0,
                        status="pending", due_date=today + dt.timedelta(days=30))
    ap2 = await _seed_ap(db, supplier_id, created_by, amount=3_000_000, paid=1_000_000,
                        status="overdue", due_date=today - dt.timedelta(days=10))
    return ap1, ap2


# ════════════════════════════════════════════════════════════════════════════
# 1) /finance/summary — RỖNG → AP/AR = 0 là ĐÚNG (chứng minh "dashboard AP/AR=0")
# ════════════════════════════════════════════════════════════════════════════

async def test_summary_empty_ap_ar_zero(client, accountant):
    """Tables rỗng → 200 + total_outstanding == 0 cho cả AP và AR.

    Đây chính là chứng cứ "AP/AR=0" trên dashboard: KHÔNG phải bug, chỉ vì bảng
    accounts_payable/accounts_receivable chưa có dòng nào (auto-tạo TẮT)."""
    r = await client.get(f"{FIN}/summary", headers=accountant["headers"])
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert _num(data["accounts_payable"]["total_outstanding"]) == 0
    assert _num(data["accounts_receivable"]["total_outstanding"]) == 0
    assert int(data["accounts_payable"]["total_count"]) == 0
    assert int(data["accounts_receivable"]["total_count"]) == 0
    # Shape các nhánh còn lại vẫn hợp lệ (không 500).
    assert "cash_balance" in data
    assert "monthly_payments" in data


# ════════════════════════════════════════════════════════════════════════════
# 2) /finance/summary — CÓ DATA → số học ĐÚNG (endpoint đúng, "0" chỉ do thiếu data)
# ════════════════════════════════════════════════════════════════════════════

async def test_summary_reflects_seeded_ap_ar(client, accountant, db):
    """Seed 2 AR + 2 AP → total_outstanding / overdue_count / overdue_amount khớp
    tính tay. Chứng minh endpoint /summary tính đúng khi có dữ liệu."""
    cust = await _seed_customer(db)
    sup = await _seed_supplier(db, accountant["id"])
    await _seed_two_ar(db, cust, accountant["id"])
    await _seed_two_ap(db, sup, accountant["id"])

    r = await client.get(f"{FIN}/summary", headers=accountant["headers"])
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    ar = data["accounts_receivable"]
    ap = data["accounts_payable"]

    assert _num(ar["total_outstanding"]) == AR_TOTAL_OUTSTANDING
    assert int(ar["overdue_count"]) == 1
    assert _num(ar["overdue_amount"]) == AR_OVERDUE_AMOUNT
    assert _num(ar["total_amount"]) == 1_500_000
    assert _num(ar["total_paid"]) == 200_000

    assert _num(ap["total_outstanding"]) == AP_TOTAL_OUTSTANDING
    assert int(ap["overdue_count"]) == 1
    assert _num(ap["overdue_amount"]) == AP_OVERDUE_AMOUNT
    assert _num(ap["total_amount"]) == 5_000_000
    assert _num(ap["total_paid"]) == 1_000_000


# ════════════════════════════════════════════════════════════════════════════
# 3) /finance/payables/summary + /finance/receivables/summary — 200, không 500
# ════════════════════════════════════════════════════════════════════════════

async def test_payables_summary_empty_200(client, accountant):
    """Rỗng → 200, by_currency == [] (không 500, không sum sai currency)."""
    r = await client.get(f"{FIN}/payables/summary", headers=accountant["headers"])
    assert r.status_code == 200, r.text
    assert r.json()["data"]["by_currency"] == []


async def test_payables_summary_seeded_per_currency(client, accountant, db):
    """Seed 2 AP cùng VND → 1 bucket currency, tổng khớp + aging đúng."""
    sup = await _seed_supplier(db, accountant["id"])
    await _seed_two_ap(db, sup, accountant["id"])
    r = await client.get(f"{FIN}/payables/summary", headers=accountant["headers"])
    assert r.status_code == 200, r.text
    buckets = r.json()["data"]["by_currency"]
    assert len(buckets) == 1, buckets
    b = buckets[0]
    assert b["currency"] == "VND"
    assert _num(b["total_outstanding"]) == AP_TOTAL_OUTSTANDING
    assert _num(b["overdue_amount"]) == AP_OVERDUE_AMOUNT
    assert int(b["open_count"]) == 2
    assert int(b["overdue_count"]) == 1
    # aging: 2_000k chưa tới hạn = current; 2_000k quá hạn 10 ngày = b_0_30.
    assert _num(b["aging"]["current"]) == 2_000_000
    assert _num(b["aging"]["b_0_30"]) == 2_000_000


async def test_receivables_summary_empty_200(client, accountant):
    """Rỗng → 200 + total_outstanding == 0 (không 500)."""
    r = await client.get(f"{FIN}/receivables/summary", headers=accountant["headers"])
    assert r.status_code == 200, r.text
    d = r.json()["data"]
    assert _num(d["total_outstanding"]) == 0
    assert int(d["open_count"]) == 0


async def test_receivables_summary_seeded(client, accountant, db):
    """Seed 2 AR → tổng + quá hạn + aging khớp tính tay."""
    cust = await _seed_customer(db)
    await _seed_two_ar(db, cust, accountant["id"])
    r = await client.get(f"{FIN}/receivables/summary", headers=accountant["headers"])
    assert r.status_code == 200, r.text
    d = r.json()["data"]
    assert _num(d["total_outstanding"]) == AR_TOTAL_OUTSTANDING
    assert _num(d["overdue_amount"]) == AR_OVERDUE_AMOUNT
    assert int(d["open_count"]) == 2
    assert int(d["overdue_count"]) == 1
    assert _num(d["aging"]["current"]) == 800_000
    assert _num(d["aging"]["b_0_30"]) == 500_000


async def test_finance_management_ap_ar_summary_no_500(client, accountant, db):
    """/finance-management/ap-summary + /ar-summary → 200 (không 500) + overview
    tổng khớp. (Các endpoint này JOIN suppliers/customers + aging CASE.)"""
    cust = await _seed_customer(db)
    sup = await _seed_supplier(db, accountant["id"])
    await _seed_two_ar(db, cust, accountant["id"])
    await _seed_two_ap(db, sup, accountant["id"])

    r_ap = await client.get(f"{FIN_MGMT}/ap-summary", headers=accountant["headers"])
    assert r_ap.status_code == 200, r_ap.text
    ov_ap = r_ap.json()["data"]["overview"]
    assert _num(ov_ap["total_outstanding_vnd"]) == AP_TOTAL_OUTSTANDING
    assert int(ov_ap["overdue_count"]) == 1
    assert isinstance(r_ap.json()["data"]["by_supplier"], list)
    assert isinstance(r_ap.json()["data"]["aging"], list)

    r_ar = await client.get(f"{FIN_MGMT}/ar-summary", headers=accountant["headers"])
    assert r_ar.status_code == 200, r_ar.text
    ov_ar = r_ar.json()["data"]["overview"]
    assert _num(ov_ar["total_outstanding"]) == AR_TOTAL_OUTSTANDING
    assert int(ov_ar["overdue_count"]) == 1


# ════════════════════════════════════════════════════════════════════════════
# 4) /finance-reports/balance-overview — bảng cân đối phản ánh AR/AP
# ════════════════════════════════════════════════════════════════════════════

async def test_balance_overview_empty_200(client, manager):
    """Rỗng → 200 (không 500); AR/AP = 0. (JOIN inventory/cash_book vẫn an toàn.)"""
    r = await client.get(f"{FIN_REPORTS}/balance-overview", headers=manager["headers"])
    assert r.status_code == 200, r.text
    d = r.json()["data"]
    assert _num(d["assets"]["accounts_receivable"]) == 0
    assert _num(d["liabilities"]["accounts_payable_vnd"]) == 0


async def test_balance_overview_reflects_ap_ar(client, manager, db):
    """Seed AR/AP → tài sản (phải thu) & nợ (phải trả) phản ánh đúng; equity =
    tài sản − nợ. Không có cash/inventory nên assets = AR."""
    cust = await _seed_customer(db)
    sup = await _seed_supplier(db, manager["id"])
    await _seed_two_ar(db, cust, manager["id"])
    await _seed_two_ap(db, sup, manager["id"])

    r = await client.get(f"{FIN_REPORTS}/balance-overview", headers=manager["headers"])
    assert r.status_code == 200, r.text
    d = r.json()["data"]
    assert _num(d["assets"]["accounts_receivable"]) == AR_TOTAL_OUTSTANDING
    assert _num(d["liabilities"]["accounts_payable_vnd"]) == AP_TOTAL_OUTSTANDING
    # cash=0, inventory=0 ⇒ total_assets = AR; equity = AR − AP.
    assert _num(d["assets"]["total_assets"]) == AR_TOTAL_OUTSTANDING
    assert _num(d["equity"]) == AR_TOTAL_OUTSTANDING - AP_TOTAL_OUTSTANDING


# ════════════════════════════════════════════════════════════════════════════
# 5) RBAC — bám rbac.py THỰC (allow_viewer=True mặc định)
# ════════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize(
    "role_fixture,expect",
    [
        ("accountant", 200), ("manager", 200), ("admin", 200),
        ("viewer", 200),   # allow_viewer=True mặc định → GET read-only PASS
        ("staff", 403), ("vendor", 403),
    ],
)
async def test_summary_rbac(
    client, role_fixture, expect,
    accountant, manager, admin, viewer, staff, vendor,
):
    """/finance/summary: accountant|manager|admin → 200; viewer đọc được (200);
    staff/vendor → 403. Inject fixture role trực tiếp (không getfixturevalue)."""
    users = {
        "accountant": accountant, "manager": manager, "admin": admin,
        "viewer": viewer, "staff": staff, "vendor": vendor,
    }
    r = await client.get(f"{FIN}/summary", headers=users[role_fixture]["headers"])
    assert r.status_code == expect, f"{role_fixture}: {r.status_code} {r.text}"


@pytest.mark.parametrize(
    "role_fixture,expect",
    [
        ("manager", 200), ("admin", 200),
        ("accountant", 403),   # /finance-reports CHỈ manager|admin (khác /finance)
        ("viewer", 200),       # viewer đọc được (allow_viewer=True)
        ("staff", 403), ("vendor", 403),
    ],
)
async def test_balance_overview_rbac(
    client, role_fixture, expect,
    accountant, manager, admin, viewer, staff, vendor,
):
    """/finance-reports/balance-overview: chỉ manager|admin (+viewer đọc). accountant
    KHÔNG có quyền ở nhóm report → 403 (khác /finance/* vốn cho accountant)."""
    users = {
        "accountant": accountant, "manager": manager, "admin": admin,
        "viewer": viewer, "staff": staff, "vendor": vendor,
    }
    r = await client.get(
        f"{FIN_REPORTS}/balance-overview", headers=users[role_fixture]["headers"]
    )
    assert r.status_code == expect, f"{role_fixture}: {r.status_code} {r.text}"


# ════════════════════════════════════════════════════════════════════════════
# 6) /finance-reports/cash-flow-statement + /profit-loss + /monthly-comparison
#    — CỤM cash_book. Khoá 2 hồi quy đã gặp trên prod (cash_book có 20 dòng LIVE):
#      (a) cash_flow_statement đọc r["category"] (cột KHÔNG tồn tại — SELECT chỉ
#          có category_id) → KeyError → 500. Nay JOIN cash_book_categories lấy
#          category_code/category_name thật.
#      (b) convention direction THẬT = 'thu' (tiền vào) / 'chi' (tiền ra) — KHÔNG
#          phải 'income'/'expense'/'inbound'/'outbound'. profit_loss/monthly cũ
#          lọc 'expense'/'income' → BỎ SÓT toàn bộ (số 0 sai). Nay lọc 'chi'/'thu'.
#      (c) profit_loss: total_opex là Decimal (numeric) → float - Decimal TypeError
#          → 500 khi CÓ dòng chi (trước fix filter rỗng nên che). Nay ép float().
#
# Schema THẬT (đã tra _schema_snapshot.sql):
#   cash_book NOT NULL = entry_date, description, amount, direction (id tự
#     nextval; company_id/category_id/balance_after/created_by NULLABLE).
#     CHECK direction ∈ {thu,chi,income,expense,transfer}.
#   cash_book_categories NOT NULL = category_code, category_name, direction
#     (id tự nextval; is_active/created_at DEFAULT). CHECK direction ∈ {thu,chi,both}.
# ════════════════════════════════════════════════════════════════════════════

async def _seed_cash_category(db, code, name, direction) -> int:
    """cash_book_categories: category_code/category_name/direction NOT NULL.
    direction ∈ {'thu','chi','both'} (CHECK)."""
    return await db.fetchval(
        """
        INSERT INTO cash_book_categories (category_code, category_name, direction)
        VALUES ($1, $2, $3)
        RETURNING id
        """,
        code, name, direction,
    )


async def _seed_cash_book(
    db, *, category_id, direction, amount, entry_date=None,
    balance_after=None, created_by=None, description="DEMO so quy",
) -> int:
    """cash_book: entry_date/description/amount/direction NOT NULL; phần còn lại
    NULLABLE. direction convention THẬT = 'thu' (tiền vào) / 'chi' (tiền ra)."""
    entry_date = entry_date or dt.date.today()
    return await db.fetchval(
        """
        INSERT INTO cash_book
            (entry_date, description, category_id, amount, direction,
             balance_after, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7::uuid)
        RETURNING id
        """,
        entry_date, description, category_id, amount, direction,
        balance_after, created_by,
    )


# Kỳ cố định để test tất định (deterministic) — tách khỏi "tháng hiện tại".
CF_YEAR, CF_MONTH = 2026, 3
CF_DATE = dt.date(CF_YEAR, CF_MONTH, 15)


async def test_cash_flow_statement_no_500_and_net(client, manager, db):
    """Seed 1 category 'thu' (THU-BAN) + 1 'chi' (CHI-MH) + các dòng cash_book →
    GET cash-flow-statement → 200 (KHOÁ chống 500 do r["category"] KeyError);
    net_operating = tổng thu − tổng chi; breakdown có category_code (JOIN)."""
    thu_cat = await _seed_cash_category(db, _uniq("THU-BAN"), "Ban hang", "thu")
    chi_cat = await _seed_cash_category(db, _uniq("CHI-MH"), "Mua hang", "chi")
    # Thu 10M + 5M = 15M ; Chi 3M + 2M = 5M → net operating = 10M.
    await _seed_cash_book(db, category_id=thu_cat, direction="thu", amount=10_000_000,
                          entry_date=CF_DATE, balance_after=10_000_000, created_by=manager["id"])
    await _seed_cash_book(db, category_id=thu_cat, direction="thu", amount=5_000_000,
                          entry_date=CF_DATE, balance_after=15_000_000, created_by=manager["id"])
    await _seed_cash_book(db, category_id=chi_cat, direction="chi", amount=3_000_000,
                          entry_date=CF_DATE, balance_after=12_000_000, created_by=manager["id"])
    await _seed_cash_book(db, category_id=chi_cat, direction="chi", amount=2_000_000,
                          entry_date=CF_DATE, balance_after=10_000_000, created_by=manager["id"])

    r = await client.get(
        f"{FIN_REPORTS}/cash-flow-statement",
        params={"year": CF_YEAR, "month": CF_MONTH},
        headers=manager["headers"],
    )
    assert r.status_code == 200, r.text   # khoá chống 500 (r["category"] KeyError)
    data = r.json()["data"]

    # net operating = 15M − 5M = 10M ; investing/financing rỗng → net_change = 10M.
    assert _num(data["operating"]["net_vnd"]) == 10_000_000
    assert _num(data["net_change_vnd"]) == 10_000_000

    # Breakdown phải có category_code THẬT (bằng chứng đã JOIN cash_book_categories).
    codes = {it.get("category_code") for it in data["operating"]["items"]}
    assert any(c and c.startswith("THU-BAN") for c in codes), data["operating"]["items"]
    assert any(c and c.startswith("CHI-MH") for c in codes), data["operating"]["items"]

    # Taxonomy chỉ có operating → investing/financing rỗng, net 0.
    assert data["investing"]["items"] == []
    assert data["financing"]["items"] == []
    assert _num(data["investing"]["net_vnd"]) == 0
    assert _num(data["financing"]["net_vnd"]) == 0


async def test_cash_flow_statement_empty_200(client, manager):
    """Kỳ không có dòng cash_book → 200, mọi net = 0 (không 500)."""
    r = await client.get(
        f"{FIN_REPORTS}/cash-flow-statement",
        params={"year": 2026, "month": 2},
        headers=manager["headers"],
    )
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert _num(data["operating"]["net_vnd"]) == 0
    assert _num(data["net_change_vnd"]) == 0
    assert data["operating"]["items"] == []


async def test_profit_loss_reflects_cash_expense_no_500(client, manager, db):
    """Seed category 'chi' + dòng cash_book chi → GET profit-loss → 200 (khoá
    chống 500 float−Decimal); total_opex_vnd = tổng chi (code cũ lọc 'expense'
    → bỏ sót = 0); breakdown chi phí có category_code."""
    chi_cat = await _seed_cash_category(db, _uniq("CHI-MH"), "Mua hang", "chi")
    await _seed_cash_book(db, category_id=chi_cat, direction="chi", amount=3_000_000,
                          entry_date=CF_DATE, created_by=manager["id"])
    await _seed_cash_book(db, category_id=chi_cat, direction="chi", amount=1_000_000,
                          entry_date=CF_DATE, created_by=manager["id"])

    r = await client.get(
        f"{FIN_REPORTS}/profit-loss",
        params={"year": CF_YEAR, "month": CF_MONTH},
        headers=manager["headers"],
    )
    assert r.status_code == 200, r.text   # khoá chống 500 (float − Decimal)
    data = r.json()["data"]
    # opex = tổng chi = 4M ; không có deal → gross_profit 0 → net = −opex.
    assert _num(data["total_opex_vnd"]) == 4_000_000
    assert _num(data["net_profit_vnd"]) == -4_000_000
    # breakdown chi phí kèm category_code (JOIN cash_book_categories).
    assert data["operating_expenses"], data
    assert data["operating_expenses"][0]["category_code"].startswith("CHI-MH")


async def test_monthly_comparison_no_500(client, manager, db):
    """Seed thu + chi cash_book (tháng hiện tại) → GET monthly-comparison → 200
    (không 500). Direction filter dùng 'thu'/'chi' hợp lệ; danh sách monthly là
    list. (Số cash_income/expense chỉ nổi lên khi có deal_margins cùng tháng —
    ngoài phạm vi seed tối thiểu; ở đây khoá no-500 + shape.)"""
    thu_cat = await _seed_cash_category(db, _uniq("THU-BAN"), "Ban hang", "thu")
    chi_cat = await _seed_cash_category(db, _uniq("CHI-MH"), "Mua hang", "chi")
    await _seed_cash_book(db, category_id=thu_cat, direction="thu", amount=7_000_000,
                          entry_date=dt.date.today(), created_by=manager["id"])
    await _seed_cash_book(db, category_id=chi_cat, direction="chi", amount=2_000_000,
                          entry_date=dt.date.today(), created_by=manager["id"])

    r = await client.get(
        f"{FIN_REPORTS}/monthly-comparison",
        params={"months": 3},
        headers=manager["headers"],
    )
    assert r.status_code == 200, r.text
    assert isinstance(r.json()["data"]["monthly"], list)
