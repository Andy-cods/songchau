"""W3-12 — GET /finance/reconcile: đối soát AP/AR phát hiện lệch.

Bối cảnh: accounts_receivable/accounts_payable hiện RỖNG trên prod (auto-tạo
AR/AP đang TẮT). Endpoint này được thêm TRƯỚC khi bật auto-tạo, để kế toán có
công cụ phát hiện lệch giữa paid_amount / payment_transactions / status /
due_date. Endpoint READ-ONLY — bộ test này KHÔNG kiểm tra việc sửa dữ liệu.

Pattern mirror test_finance.py: chạy in-process qua ASGITransport (xem
conftest); mọi ghi nằm trong transaction của fixture `db` và bị ROLLBACK sau
mỗi test — không rác prod. Chỉ chạy khi có full prod schema snapshot (bảng
accounts_receivable/accounts_payable/payment_transactions chỉ tồn tại ở
snapshot, không có ở bootstrap tối thiểu).
"""
from __future__ import annotations

import datetime as dt

import pytest
import pytest_asyncio

pytestmark = pytest.mark.integration

FIN = "/api/v1/finance"


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
    import uuid
    return f"{prefix}-{uuid.uuid4().hex[:10]}"


def _find(issues, rid, itype):
    """Lọc issue theo (id, type) — 1 bản ghi có thể sinh nhiều issue."""
    return [i for i in issues if i["id"] == rid and i["type"] == itype]


# ── Seed helpers (copy từ test_finance.py — cùng FK/NOT NULL đã xác minh) ──

async def _seed_customer(db, *, company_name="DEMO KH RECON", code=None) -> int:
    code = code or _uniq("DEMO-CUS")
    return await db.fetchval(
        "INSERT INTO customers (customer_code, company_name) VALUES ($1, $2) RETURNING id",
        code, company_name,
    )


async def _seed_supplier(db, created_by, *, name=None) -> int:
    name = name or _uniq("DEMO NCC RECON")
    return await db.fetchval(
        "INSERT INTO suppliers (name, created_by) VALUES ($1, $2::uuid) RETURNING id",
        name, created_by,
    )


async def _seed_ar(
    db, customer_id, created_by, *, amount, paid=0, status="pending",
    due_date=None, invoice_date=None, currency="VND",
) -> int:
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


async def _seed_payment_transaction(
    db, *, direction, amount, created_by, ap_id=None, ar_id=None,
    payment_date=None, currency="VND",
) -> int:
    """payment_transactions NOT NULL = direction, payment_date, amount,
    created_by (uuid)."""
    payment_date = payment_date or dt.date.today()
    return await db.fetchval(
        """
        INSERT INTO payment_transactions
            (direction, ap_id, ar_id, payment_date, amount, currency, created_by)
        VALUES ($1::payment_direction, $2, $3, $4, $5, $6::currency_code, $7::uuid)
        RETURNING id
        """,
        direction, ap_id, ar_id, payment_date, amount, currency, created_by,
    )


# ════════════════════════════════════════════════════════════════════════════
# 1) Rỗng → 200, mọi count = 0 (không 500)
# ════════════════════════════════════════════════════════════════════════════

async def test_reconcile_empty_returns_zero(client, accountant):
    r = await client.get(f"{FIN}/reconcile", headers=accountant["headers"])
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["ar_issues"] == []
    assert data["ap_issues"] == []
    assert data["summary"]["ar_count"] == 0
    assert data["summary"]["ap_count"] == 0
    assert _num(data["summary"]["total_variance_vnd"]) == 0


# ════════════════════════════════════════════════════════════════════════════
# 2) Check 1 — paid_amount vs SUM(payment_transactions)
# ════════════════════════════════════════════════════════════════════════════

async def test_reconcile_ar_paid_amount_mismatch(client, accountant, db):
    """AR paid_amount=100k nhưng payment_transactions inbound chỉ 60k →
    paid_amount_mismatch, variance=40000. status='partial_paid' + due tương
    lai để Check 2/3 không nổi lên (cô lập Check 1)."""
    cust = await _seed_customer(db)
    ar = await _seed_ar(
        db, cust, accountant["id"], amount=1_000_000, paid=100_000,
        status="partial_paid", due_date=dt.date.today() + dt.timedelta(days=30),
    )
    await _seed_payment_transaction(
        db, direction="inbound", ar_id=ar, amount=60_000, created_by=accountant["id"],
    )

    r = await client.get(f"{FIN}/reconcile", headers=accountant["headers"])
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    hits = _find(data["ar_issues"], ar, "paid_amount_mismatch")
    assert len(hits) == 1, data["ar_issues"]
    assert _num(hits[0]["variance_amount"]) == 40_000


async def test_reconcile_ap_paid_amount_mismatch(client, accountant, db):
    """AP paid_amount=100k nhưng payment_transactions outbound chỉ 60k →
    paid_amount_mismatch trong ap_issues."""
    sup = await _seed_supplier(db, accountant["id"])
    ap = await _seed_ap(
        db, sup, accountant["id"], amount=1_000_000, paid=100_000,
        status="partial_paid", due_date=dt.date.today() + dt.timedelta(days=30),
        currency="VND",
    )
    await _seed_payment_transaction(
        db, direction="outbound", ap_id=ap, amount=60_000, created_by=accountant["id"],
    )

    r = await client.get(f"{FIN}/reconcile", headers=accountant["headers"])
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    hits = _find(data["ap_issues"], ap, "paid_amount_mismatch")
    assert len(hits) == 1, data["ap_issues"]
    assert _num(hits[0]["variance_amount"]) == 40_000


# ════════════════════════════════════════════════════════════════════════════
# 3) Check 2 — status vs paid_amount
# ════════════════════════════════════════════════════════════════════════════

async def test_reconcile_ar_status_paid_but_underpaid(client, accountant, db):
    """status='paid' nhưng paid_amount<amount → status_paid_amount_mismatch.
    Seed payment khớp paid_amount để Check 1 sạch (cô lập Check 2)."""
    cust = await _seed_customer(db)
    ar = await _seed_ar(
        db, cust, accountant["id"], amount=100_000, paid=50_000, status="paid",
        due_date=dt.date.today() + dt.timedelta(days=30),
    )
    await _seed_payment_transaction(
        db, direction="inbound", ar_id=ar, amount=50_000, created_by=accountant["id"],
    )

    r = await client.get(f"{FIN}/reconcile", headers=accountant["headers"])
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert _find(data["ar_issues"], ar, "paid_amount_mismatch") == []
    hits = _find(data["ar_issues"], ar, "status_paid_amount_mismatch")
    assert len(hits) == 1, data["ar_issues"]
    assert _num(hits[0]["variance_amount"]) == 50_000


async def test_reconcile_ap_status_paid_but_underpaid(client, accountant, db):
    """AP status='paid' nhưng paid<amount → status_paid_amount_mismatch (outbound)."""
    sup = await _seed_supplier(db, accountant["id"])
    ap = await _seed_ap(
        db, sup, accountant["id"], amount=100_000, paid=50_000, status="paid",
        due_date=dt.date.today() + dt.timedelta(days=30), currency="VND",
    )
    await _seed_payment_transaction(
        db, direction="outbound", ap_id=ap, amount=50_000, created_by=accountant["id"],
    )

    r = await client.get(f"{FIN}/reconcile", headers=accountant["headers"])
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    hits = _find(data["ap_issues"], ap, "status_paid_amount_mismatch")
    assert len(hits) == 1, data["ap_issues"]
    assert _num(hits[0]["variance_amount"]) == 50_000


async def test_reconcile_ar_overpaid(client, accountant, db):
    """paid_amount>amount (trả/thu dư) → status_paid_amount_mismatch,
    variance = paid-amount."""
    cust = await _seed_customer(db)
    ar = await _seed_ar(
        db, cust, accountant["id"], amount=100_000, paid=120_000, status="paid",
        due_date=dt.date.today() + dt.timedelta(days=30),
    )
    await _seed_payment_transaction(
        db, direction="inbound", ar_id=ar, amount=120_000, created_by=accountant["id"],
    )

    r = await client.get(f"{FIN}/reconcile", headers=accountant["headers"])
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert _find(data["ar_issues"], ar, "paid_amount_mismatch") == []
    hits = _find(data["ar_issues"], ar, "status_paid_amount_mismatch")
    assert len(hits) == 1, data["ar_issues"]
    assert _num(hits[0]["variance_amount"]) == 20_000


async def test_reconcile_ar_pending_but_has_payment(client, accountant, db):
    """status='pending' nhưng paid_amount>0 (nên là partial_paid) →
    status_paid_amount_mismatch."""
    cust = await _seed_customer(db)
    ar = await _seed_ar(
        db, cust, accountant["id"], amount=100_000, paid=30_000, status="pending",
        due_date=dt.date.today() + dt.timedelta(days=30),
    )
    await _seed_payment_transaction(
        db, direction="inbound", ar_id=ar, amount=30_000, created_by=accountant["id"],
    )

    r = await client.get(f"{FIN}/reconcile", headers=accountant["headers"])
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    hits = _find(data["ar_issues"], ar, "status_paid_amount_mismatch")
    assert len(hits) == 1, data["ar_issues"]
    assert _num(hits[0]["variance_amount"]) == 30_000


# ════════════════════════════════════════════════════════════════════════════
# 4) Check 3 — overdue chưa cập nhật status
# ════════════════════════════════════════════════════════════════════════════

async def test_reconcile_ar_overdue_not_flagged(client, accountant, db):
    """due_date đã qua, status='pending' (chưa 'overdue') → overdue_not_flagged.
    paid=0 khớp sum=0 nên Check 1 sạch."""
    cust = await _seed_customer(db)
    ar = await _seed_ar(
        db, cust, accountant["id"], amount=500_000, paid=0, status="pending",
        due_date=dt.date.today() - dt.timedelta(days=10),
    )

    r = await client.get(f"{FIN}/reconcile", headers=accountant["headers"])
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert _find(data["ar_issues"], ar, "paid_amount_mismatch") == []
    hits = _find(data["ar_issues"], ar, "overdue_not_flagged")
    assert len(hits) == 1, data["ar_issues"]
    assert _num(hits[0]["variance_amount"]) == 500_000


async def test_reconcile_ap_overdue_not_flagged(client, accountant, db):
    sup = await _seed_supplier(db, accountant["id"])
    ap = await _seed_ap(
        db, sup, accountant["id"], amount=300_000, paid=0, status="pending",
        due_date=dt.date.today() - dt.timedelta(days=5), currency="VND",
    )

    r = await client.get(f"{FIN}/reconcile", headers=accountant["headers"])
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    hits = _find(data["ap_issues"], ap, "overdue_not_flagged")
    assert len(hits) == 1, data["ap_issues"]
    assert _num(hits[0]["variance_amount"]) == 300_000


async def test_reconcile_ar_overdue_already_flagged_no_issue(client, accountant, db):
    """due_date đã qua nhưng status ĐÃ là 'overdue' → KHÔNG có overdue_not_flagged."""
    cust = await _seed_customer(db)
    ar = await _seed_ar(
        db, cust, accountant["id"], amount=200_000, paid=0, status="overdue",
        due_date=dt.date.today() - dt.timedelta(days=10),
    )

    r = await client.get(f"{FIN}/reconcile", headers=accountant["headers"])
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert _find(data["ar_issues"], ar, "overdue_not_flagged") == []


# ════════════════════════════════════════════════════════════════════════════
# 5) Trường hợp KHÔNG lệch — không có issue nào
# ════════════════════════════════════════════════════════════════════════════

async def test_reconcile_consistent_no_issue(client, accountant, db):
    """AR/AP paid khớp payment_transactions + status đúng + chưa tới hạn →
    không sinh issue nào cho các bản ghi này."""
    cust = await _seed_customer(db)
    sup = await _seed_supplier(db, accountant["id"])
    ar = await _seed_ar(
        db, cust, accountant["id"], amount=100_000, paid=100_000, status="paid",
        due_date=dt.date.today() + dt.timedelta(days=30),
    )
    await _seed_payment_transaction(
        db, direction="inbound", ar_id=ar, amount=100_000, created_by=accountant["id"],
    )
    ap = await _seed_ap(
        db, sup, accountant["id"], amount=200_000, paid=200_000, status="paid",
        due_date=dt.date.today() + dt.timedelta(days=30), currency="VND",
    )
    await _seed_payment_transaction(
        db, direction="outbound", ap_id=ap, amount=200_000, created_by=accountant["id"],
    )

    r = await client.get(f"{FIN}/reconcile", headers=accountant["headers"])
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    ar_ids = {i["id"] for i in data["ar_issues"]}
    ap_ids = {i["id"] for i in data["ap_issues"]}
    assert ar not in ar_ids, data["ar_issues"]
    assert ap not in ap_ids, data["ap_issues"]


# ════════════════════════════════════════════════════════════════════════════
# 6) RBAC — bám app/core/rbac.py THỰC (allow_viewer=True mặc định)
# ════════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize(
    "role_fixture,expect",
    [
        ("accountant", 200), ("manager", 200), ("admin", 200),
        ("viewer", 200),   # allow_viewer=True mặc định → GET read-only PASS
        ("staff", 403), ("vendor", 403),
    ],
)
async def test_reconcile_rbac(
    client, role_fixture, expect,
    accountant, manager, admin, viewer, staff, vendor,
):
    users = {
        "accountant": accountant, "manager": manager, "admin": admin,
        "viewer": viewer, "staff": staff, "vendor": vendor,
    }
    r = await client.get(f"{FIN}/reconcile", headers=users[role_fixture]["headers"])
    assert r.status_code == expect, f"{role_fixture}: {r.status_code} {r.text}"
