"""W3-07 — audit_log APPEND-ONLY (immutable) + phủ audit mutation finance/CRM.

Bối cảnh: bảng `audit_log` đã tồn tại (đọc qua GET /api/v1/audit) và đã được
ghi bởi 2 cơ chế — (1) trigger DB `auto_audit_log()` gắn trên accounts_payable/
accounts_receivable/customers/cash_book/... và (2) các lời gọi app-level
`write_audit_log()`/`_write_audit_log()` cho bảng KHÔNG có trigger (vd.
payment_transactions, payment_requests, sales_invoices_q) — nhưng KHÔNG hề có
ràng buộc nào chặn UPDATE/DELETE trên chính audit_log. m44 thêm trigger
BEFORE UPDATE OR DELETE RAISE EXCEPTION để bịt lỗ đó.

GATE SCHEMA: audit_log/accounts_payable/payment_requests/payment_transactions/
customers chỉ có ở full prod schema snapshot (tests/_schema_snapshot.sql), nên
mirror pattern `_require_full_schema` của test_finance.py/test_crm.py.

GATE MIGRATION: trigger m44 CHƯA được bake vào _schema_snapshot.sql (snapshot
được dump TRƯỚC khi viết migration này — cùng pattern m40/m41 mô tả ở
test_hr.py). Vì DDL của m44 hoàn toàn idempotent và không đụng dữ liệu, fixture
`_apply_m44` áp trực tiếp file .sql lên connection `db` của TỪNG test (nằm
trong transaction rollback-only của test đó) — không cần regenerate snapshot,
không rác giữa các test.

pytest.raises trick: `db` (conftest) mở 1 transaction ngoài, rollback ở cuối
test. Nếu 1 câu lệnh RAISE EXCEPTION chạy ngay trên `db` (không có transaction
lồng), toàn bộ transaction ngoài bị "aborted" — mọi câu lệnh SAU đó (kể cả
SELECT verify hay ROLLBACK của fixture) sẽ lỗi "current transaction is
aborted". Bọc câu lệnh gây lỗi trong `async with db.transaction():` (asyncpg
tự phát hiện đã ở trong 1 transaction ⇒ dùng SAVEPOINT) để asyncpg
ROLLBACK TO SAVEPOINT khi __aexit__ thấy exception — connection quay lại dùng
được ngay, không ảnh hưởng phần còn lại của test/fixture teardown.

Exception class: m44 mirrors migrations/procurement_audit_immutable.sql (đã
LIVE cho procurement_audit_log — Đợt A · Blocker B5) và dùng
`USING ERRCODE = 'integrity_constraint_violation'` (SQLSTATE 23000) thay vì
mã P0001 mặc định của RAISE EXCEPTION trần — asyncpg map SQLSTATE 23000 sang
`asyncpg.exceptions.IntegrityConstraintViolationError` (verify trực tiếp:
`asyncpg.exceptions.IntegrityConstraintViolationError.sqlstate == '23000'`).
"""
from __future__ import annotations

import datetime as dt
import json
import pathlib

import asyncpg
import pytest
import pytest_asyncio

pytestmark = pytest.mark.integration

PR = "/api/v1/payment-requests"

# m44 DDL: ưu tiên đọc file migration (khi chạy từ repo); fallback bản inline
# (khi chạy trong image harness KHÔNG mount thư mục migrations/). DDL idempotent
# nên áp lại kể cả khi snapshot đã bake trigger cũng vô hại.
_M44_INLINE = """
CREATE OR REPLACE FUNCTION public.audit_log_immutable() RETURNS trigger
    LANGUAGE plpgsql AS $fn$
BEGIN
    RAISE EXCEPTION 'audit_log is append-only (immutable) — UPDATE/DELETE bị cấm'
        USING ERRCODE = 'integrity_constraint_violation';
END;
$fn$;
DROP TRIGGER IF EXISTS trg_audit_log_immutable ON public.audit_log;
CREATE TRIGGER trg_audit_log_immutable BEFORE UPDATE OR DELETE ON public.audit_log
    FOR EACH ROW EXECUTE FUNCTION public.audit_log_immutable();
"""
try:
    M44_SQL = (
        pathlib.Path(__file__).resolve().parent.parent
        / "migrations"
        / "m44_audit_log_immutable.sql"
    ).read_text(encoding="utf-8")
except (FileNotFoundError, OSError):
    M44_SQL = _M44_INLINE


# ── Guard: cần full prod schema (mirror test_finance.py / test_crm.py) ──────
@pytest_asyncio.fixture(autouse=True)
async def _require_full_schema(request, schema_info):
    if request.node.get_closest_marker("integration") and not schema_info["full_schema"]:
        pytest.skip(
            "cần full prod schema snapshot tại tests/_schema_snapshot.sql "
            "(pg_dump --schema-only). Schema đang nạp: " + schema_info["source"]
        )


# ── Áp trigger m44 lên transaction của TỪNG test (chưa có trong snapshot) ───
@pytest_asyncio.fixture(autouse=True)
async def _apply_m44(db, _require_full_schema):
    await db.execute(M44_SQL)


# ════════════════════════════════════════════════════════════════════════════
# (a) INSERT audit_log — vẫn cho phép
# ════════════════════════════════════════════════════════════════════════════

async def test_insert_audit_log_ok(db):
    rec_id = await db.fetchval(
        """
        INSERT INTO audit_log (user_email, action, table_name, record_id, new_data)
        VALUES ($1, 'INSERT', 'unit_test_table', '42', '{"foo": "bar"}'::jsonb)
        RETURNING id
        """,
        "tester@songchau.vn",
    )
    assert rec_id is not None

    row = await db.fetchrow(
        "SELECT action, table_name, record_id FROM audit_log WHERE id = $1", rec_id
    )
    assert row["action"] == "INSERT"
    assert row["table_name"] == "unit_test_table"
    assert row["record_id"] == "42"


# ════════════════════════════════════════════════════════════════════════════
# (b) UPDATE audit_log — bị chặn
# ════════════════════════════════════════════════════════════════════════════

async def test_update_audit_log_raises(db):
    rec_id = await db.fetchval(
        "INSERT INTO audit_log (action, table_name, record_id) "
        "VALUES ('INSERT', 'unit_test_table', '1') RETURNING id"
    )

    with pytest.raises(
        asyncpg.exceptions.IntegrityConstraintViolationError, match="append-only"
    ):
        async with db.transaction():  # SAVEPOINT — isolates the abort
            await db.execute(
                "UPDATE audit_log SET action = 'UPDATE' WHERE id = $1", rec_id
            )

    # Connection usable again (SAVEPOINT rolled back, not the whole tx) + row
    # genuinely untouched.
    action = await db.fetchval("SELECT action FROM audit_log WHERE id = $1", rec_id)
    assert action == "INSERT"


# ════════════════════════════════════════════════════════════════════════════
# (c) DELETE audit_log — bị chặn
# ════════════════════════════════════════════════════════════════════════════

async def test_delete_audit_log_raises(db):
    rec_id = await db.fetchval(
        "INSERT INTO audit_log (action, table_name, record_id) "
        "VALUES ('INSERT', 'unit_test_table', '1') RETURNING id"
    )

    with pytest.raises(
        asyncpg.exceptions.IntegrityConstraintViolationError, match="append-only"
    ):
        async with db.transaction():
            await db.execute("DELETE FROM audit_log WHERE id = $1", rec_id)

    count = await db.fetchval(
        "SELECT COUNT(*) FROM audit_log WHERE id = $1", rec_id
    )
    assert count == 1


# ════════════════════════════════════════════════════════════════════════════
# (d) Mutation finance qua client → có audit row mới
#
# payment_requests KHÔNG có trigger DB (không nằm trong danh sách trg_audit_*
# của accounts_payable/accounts_receivable/customers/cash_book/...), nên W3-07
# đã thêm lời gọi app-level `write_audit_log()` tường minh trong approve/
# reject/mark-paid (app/api/v1/payment_requests.py). Test này POST .../approve
# qua client thật (ASGITransport, in-process) và xác nhận có đúng 1 dòng
# audit_log mới cho table_name='payment_requests' — chứng minh dây đã nối,
# KHÔNG chỉ code tồn tại mà không được gọi.
# ════════════════════════════════════════════════════════════════════════════

async def _seed_pending_payment_request(db, requester_id, *, amount=1_000_000) -> int:
    return await db.fetchval(
        """
        INSERT INTO payment_requests
            (requester_id, request_date, description, amount, status)
        VALUES ($1::uuid, CURRENT_DATE, 'W3-07 test PR', $2, 'pending')
        RETURNING id
        """,
        requester_id,
        amount,
    )


async def test_approve_payment_request_writes_audit_row(client, db, accountant):
    pr_id = await _seed_pending_payment_request(db, accountant["id"])

    before = await db.fetchval(
        "SELECT COUNT(*) FROM audit_log WHERE table_name = 'payment_requests' "
        "AND record_id = $1",
        str(pr_id),
    )
    assert before == 0

    r = await client.post(
        f"{PR}/{pr_id}/approve", json={}, headers=accountant["headers"]
    )
    assert r.status_code == 200, r.text
    assert r.json()["data"]["status"] == "approved"

    row = await db.fetchrow(
        "SELECT action, user_id, new_data FROM audit_log "
        "WHERE table_name = 'payment_requests' AND record_id = $1 "
        "ORDER BY id DESC LIMIT 1",
        str(pr_id),
    )
    assert row is not None, "expected a new audit_log row for the approve mutation"
    assert row["action"] == "UPDATE"
    assert str(row["user_id"]) == accountant["id"]  # app-level call passes token_data
    new_data = row["new_data"]
    if isinstance(new_data, str):  # asyncpg has no jsonb codec registered — raw text
        new_data = json.loads(new_data)
    assert new_data["status"] == "approved"


async def test_create_payment_writes_audit_row(client, db, accountant):
    """POST /finance/payments (payment_transactions — cũng không có trigger DB)
    → phải sinh 1 dòng audit_log action=INSERT."""
    cust = await db.fetchval(
        "INSERT INTO customers (customer_code, company_name) VALUES ($1, $2) RETURNING id",
        "W3-07-CUS", "W3-07 test KH",
    )
    ar_id = await db.fetchval(
        """
        INSERT INTO accounts_receivable
            (customer_id, invoice_date, due_date, amount, currency, paid_amount,
             status, created_by)
        VALUES ($1, CURRENT_DATE, CURRENT_DATE + 30, 100000, 'VND'::currency_code,
                0, 'pending'::payment_status, $2::uuid)
        RETURNING id
        """,
        cust, accountant["id"],
    )

    r = await client.post(
        "/api/v1/finance/payments",
        json={
            "direction": "inbound",
            "ar_id": ar_id,
            "payment_date": str(dt.date.today()),
            "amount": 50000,
            "currency": "VND",
        },
        headers=accountant["headers"],
    )
    assert r.status_code == 201, r.text
    pt_id = r.json()["data"]["id"]

    row = await db.fetchrow(
        "SELECT action, user_id, table_name FROM audit_log "
        "WHERE table_name = 'payment_transactions' AND record_id = $1",
        str(pt_id),
    )
    assert row is not None, "expected a new audit_log row for payment_transactions INSERT"
    assert row["action"] == "INSERT"
    assert str(row["user_id"]) == accountant["id"]
