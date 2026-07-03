# PLAN — W3-12: GET /finance/reconcile (đối soát AP/AR)

## 0. Verification summary

- Router đích: `backend/app/api/v1/finance.py`. Mount `/finance` tại `backend/app/api/v1/__init__.py:86`. Full path endpoint mới = **`/api/v1/finance/reconcile`**.
- Endpoint cuối file hiện tại là `financial_summary` (`@router.get("/summary")`), kết thúc dòng 725. Chèn code mới **ngay sau dòng 725** (cuối file), dưới một section header mới `# Reconciliation`.
- RBAC (`app/core/rbac.py:46`): `require_role(*allowed_roles, allow_viewer=True)`. Viewer GET bypass → 200; role ngoài `allowed_roles` và không phải viewer → 403. Dùng `require_role("accountant", "manager", "admin")` giống mọi endpoint `/finance/*`.
- Schema xác nhận (`tests/_schema_snapshot.sql`):
  - `accounts_receivable` (1353): `id, customer_id, amount numeric(15,2) NOT NULL, currency currency_code DEFAULT 'VND', paid_amount numeric(15,2) DEFAULT 0 NOT NULL, status payment_status DEFAULT 'pending' NOT NULL, due_date date NOT NULL, ...`
  - `accounts_payable` (1299): giống trên + `currency DEFAULT 'USD'`, `exchange_rate, amount_vnd`.
  - `payment_transactions` (6600): `direction payment_direction NOT NULL, ap_id, ar_id, payment_date date NOT NULL, amount numeric(15,2) NOT NULL, currency currency_code DEFAULT 'VND', created_by uuid NOT NULL`.
  - Enums: `payment_status = {pending, partial_paid, paid, overdue, disputed}`; `payment_direction = {inbound, outbound}`.
- Test infra (`tests/test_finance.py`, `tests/conftest.py`): `pytestmark = pytest.mark.integration`; autouse `_require_full_schema(request, schema_info)`; fixtures `client, db, accountant, manager, admin, viewer, staff, vendor`. Seed helpers `_seed_customer`, `_seed_supplier(db, created_by)`, `_seed_ar(...)`, `_seed_ap(...)` tồn tại trong test_finance.py (KHÔNG ở conftest → copy sang file test mới).

## 1. Quyết định thiết kế (KISS/YAGNI)

- Endpoint **READ-ONLY tuyệt đối**: chỉ `conn.fetch(...)` (SELECT). Không transaction, không UPDATE/INSERT.
- `variance_amount` giữ **nguyên currency gốc của bản ghi** (không quy đổi FX).
- `summary.total_variance_vnd` **chỉ cộng các issue có `currency == 'VND'`**. Giới hạn ghi rõ trong docstring.
- Check 1 sum toàn bộ payment_transactions cùng direction cho bản ghi đó, bất kể currency (khớp cách POST /payments cộng dồn `paid_amount`).
- Một bản ghi AR/AP có thể sinh nhiều issue. `ar_count = len(ar_issues)`, `ap_count = len(ap_issues)`.
- Threshold so sánh numeric: `> 0.005` trong SQL. Ép `float()` ở Python khi build JSON.

## 2. Response shape (chốt cứng)

```json
{
  "data": {
    "ar_issues": [
      {"type": "paid_amount_mismatch", "id": 12, "description": "…", "variance_amount": 40000.0}
    ],
    "ap_issues": [],
    "summary": {"ar_count": 1, "ap_count": 0, "total_variance_vnd": 40000.0}
  }
}
```

`type` ∈ `{"paid_amount_mismatch", "status_paid_amount_mismatch", "overdue_not_flagged"}`.

## 3. Test plan — `backend/tests/test_finance_reconcile.py`

Copy header/helpers pattern từ `test_finance.py` (`_require_full_schema`, `_seed_customer`, `_seed_supplier`, `_seed_ar`, `_seed_ap`, `_num`, `_uniq`). Thêm `_seed_payment_transaction`. Test cases:

1. Rỗng → 200, `ar_count=0, ap_count=0, total_variance_vnd=0`.
2. AR paid_amount=100k, payment_transactions inbound sum=60k → `paid_amount_mismatch`, variance=40000.
3. AR status='paid', paid<amount → `status_paid_amount_mismatch`.
4. AP status='paid', paid<amount (outbound) → `status_paid_amount_mismatch` trong ap_issues.
5. AR overpaid (paid>amount) → `status_paid_amount_mismatch`, variance = paid-amount.
6. AR status='pending' nhưng paid>0 → `status_paid_amount_mismatch`.
7. AR due_date quá khứ, status='pending' → `overdue_not_flagged`.
8. Case nhất quán (paid khớp payment_transactions + status đúng) → không có issue.
9. RBAC: accountant/manager/admin/viewer → 200; staff/vendor → 403.

## 4. Rủi ro

- (a) Decimal→float trước khi JSON/cộng tổng.
- (b) Threshold `> 0.005` để tránh lệch làm tròn giả.
- (c) COALESCE SUM NULL→0 khi không có payment_transactions.
- (d) Read-only tuyệt đối — không sửa dữ liệu.
- (e) `python -m py_compile` sau khi code xong.
- Một bản ghi có thể sinh nhiều issue — test phải assert theo `id + type`, không assert `len(list) == 1`.

## Critical Files

- `backend/app/api/v1/finance.py` (thêm endpoint sau `/summary`, dòng 725)
- `backend/tests/test_finance.py` (nguồn copy helper + pattern)
- `backend/tests/conftest.py` (fixtures)
- `backend/tests/_schema_snapshot.sql` (schema/enum nguồn sự thật)
- `backend/app/core/rbac.py` (require_role/allow_viewer)
