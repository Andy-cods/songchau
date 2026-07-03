"""W1-07 — Cụm NĂNG SUẤT / HR (M40 KPI + M41 Nghỉ phép & Chuyên cần).

Phủ đúng các quy tắc nghiệp vụ dễ vỡ nhất của nhóm HR:

  * Nghỉ phép — DUYỆT trừ số dư (leave_balance, khoá FOR UPDATE) và CHẶN 409 khi
    vượt hạn mức. Duyệt 1-tier: manager KHÁC phòng → 403, tự duyệt đơn mình → 403,
    admin/manager-cùng-phòng → OK, HUỶ đơn đã duyệt → HOÀN số dư.
  * Chuyên cần — UNIQUE(user_id, incident_date, incident_type): khai trùng khoá → 409.
  * KPI — VIEW `employee_current_month_kpi` phải KHỚP 100% với `AGGREGATOR_SQL`
    (app.tasks.kpi_aggregator) trên cùng một dataset (m40 tự nhận "enforced by an
    integration test (test_aggregator_view_parity)" — đây chính là test đó).
  * KPI recompute idempotent — chạy AGGREGATOR_SQL 2 lần → số không đổi.

──────────────────────────────────────────────────────────────────────────────
GATE SCHEMA (đọc kỹ)
──────────────────────────────────────────────────────────────────────────────
`tests/_schema_snapshot.sql` hiện được dump TRƯỚC khi chạy 2 migration:
    backend/migrations/m40_employee_kpi.sql   (employee_monthly_kpi + view)
    backend/migrations/m41_attendance_leave.sql (leave_balance/policy/incidents,
        cột leave_requests.department..., enum notification_type='leave_*')
Nên trên snapshot hiện tại các bảng/cột/enum này CHƯA tồn tại. Fixture `hr_schema`
dò từng object và pytest.skip() với lý do rõ ràng nếu thiếu — KHÔNG để test ERROR,
KHÔNG assert giả. Muốn chạy THẬT: nạp 2 migration đó rồi regenerate snapshot
(pg_dump --schema-only), hoặc chạy trên DB đã migrate với SCHEMA_PRELOADED=1.

──────────────────────────────────────────────────────────────────────────────
MUTATION-CHECK (bằng chứng test thực sự bắt lỗi)
──────────────────────────────────────────────────────────────────────────────
  A) leave.py ~576-581: đổi `if new_used > float(bal[total_col]):` thành `>=` (hoặc
     bỏ nhánh) ⇒ test_leave_approve_deducts_and_blocks_over_quota PHẢI ĐỎ (đơn thứ 2
     không còn 409). Khôi phục ⇒ xanh.
  B) leave.py _verify_approver: bỏ nhánh so sánh phòng ban ⇒
     test_manager_other_dept_cannot_approve PHẢI ĐỎ.
  C) kpi_aggregator.AGGREGATOR_SQL: đổi `late_count` filter sang 'no_show' ⇒
     test_aggregator_view_parity PHẢI ĐỎ (view vẫn đếm 'late', aggregator lệch).
  D) test_aggregator_sql_translation_selfcheck (mark smoke, KHÔNG cần DB) chứng minh
     bộ dịch %(name)s→$n / %%→% hoạt động — hỏng helper là đỏ ngay, không phụ thuộc schema.
"""

from __future__ import annotations

from datetime import date

import pytest
import pytest_asyncio

# Hai phòng ban giả để kiểm RBAC 1-tier (duyệt theo phòng).
DEPT_A = "KD"   # Kinh doanh
DEPT_B = "SX"   # Sản xuất

# Các cột SỐ của KPI phải trùng khít giữa VIEW và AGGREGATOR (bỏ computed_at/is_final/id).
NUMERIC_KPI_COLS: tuple[str, ...] = (
    "period_year", "period_month", "period_key",
    "revenue_vnd", "orders_count", "avg_order_value",
    "new_customers", "new_products", "new_supplier_codes",
    "quotes_sent", "quotes_won", "deals_closed",
    "daily_reports_submitted", "leave_days_taken",
    "active_days", "total_actions", "workdays_present",
    "late_count", "total_late_minutes",
)


# ─── Dịch AGGREGATOR_SQL (psycopg2 style) sang tham số asyncpg ($1/$2/$3) ────
def _aggregator_sql_for_asyncpg() -> str:
    """AGGREGATOR_SQL viết cho psycopg2: dùng named params `%(y)s/%(m)s/%(is_final)s`
    và `%%` (escape của `%` trong `ILIKE 'Báo cáo %%'`). asyncpg cần placeholder vị
    trí `$n` và `%` đơn. Một tham số có thể được tham chiếu nhiều lần trong asyncpg,
    nên map cố định: y→$1, m→$2, is_final→$3."""
    from app.tasks.kpi_aggregator import AGGREGATOR_SQL

    sql = AGGREGATOR_SQL
    sql = sql.replace("%(y)s", "$1").replace("%(m)s", "$2").replace("%(is_final)s", "$3")
    sql = sql.replace("%%", "%")  # 'Báo cáo %%' → 'Báo cáo %'
    return sql


async def _run_aggregator(db, year: int, month: int, is_final: bool = False):
    """Chạy AGGREGATOR_SQL trong CHÍNH transaction rollback của test (dùng lại conn
    seed → aggregator thấy đúng dataset đã seed). Trả về các dòng RETURNING."""
    sql = _aggregator_sql_for_asyncpg()
    return await db.fetch(sql, year, month, is_final)


# ─── Helpers seed ───────────────────────────────────────────────────────────
async def _set_dept(db, user_id: str, dept: str) -> None:
    await db.execute("UPDATE users SET department = $1 WHERE id = $2::uuid", dept, user_id)


async def _seed_leave(
    db, user_id: str, dept: str | None, *,
    leave_type: str = "annual",
    start: date, end: date, days: int,
    status: str = "pending",
    half_start: bool = False, half_end: bool = False,
) -> int:
    """INSERT thẳng leave_requests (bỏ qua tầng tính business-day của POST /leave —
    approve dùng days_count ĐÃ LƯU nên ta kiểm soát chính xác con số)."""
    return await db.fetchval(
        """
        INSERT INTO leave_requests
            (user_id, department, leave_type, start_date, end_date, days_count,
             status, half_day_start, half_day_end, reason)
        VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, 'seed W1-07')
        RETURNING id
        """,
        user_id, dept, leave_type, start, end, days, status, half_start, half_end,
    )


async def _seed_balance(db, user_id: str, year: int, *, annual_total: int, annual_used: int = 0) -> None:
    await db.execute(
        """
        INSERT INTO leave_balance (user_id, period_year, annual_total, annual_used)
        VALUES ($1::uuid, $2, $3, $4)
        ON CONFLICT (user_id, period_year) DO UPDATE
            SET annual_total = EXCLUDED.annual_total,
                annual_used  = EXCLUDED.annual_used
        """,
        user_id, year, annual_total, annual_used,
    )


async def _seed_incident(db, user_id: str, dept: str | None, incident_date: date,
                         minutes: int, itype: str = "late") -> int:
    return await db.fetchval(
        """
        INSERT INTO attendance_incidents
            (user_id, department, incident_date, incident_type, minutes_off, created_by)
        VALUES ($1::uuid, $2, $3, $4, $5, $1::uuid)
        RETURNING id
        """,
        user_id, dept, incident_date, itype, minutes,
    )


async def _annual_used(db, user_id: str, year: int) -> float:
    v = await db.fetchval(
        "SELECT annual_used FROM leave_balance WHERE user_id = $1::uuid AND period_year = $2",
        user_id, year,
    )
    return float(v) if v is not None else None  # type: ignore[return-value]


async def _ict_today(db) -> tuple[date, int, int]:
    """(ngày, năm, tháng) hiện tại theo Asia/Ho_Chi_Minh — khớp bounds của live view."""
    r = await db.fetchrow(
        "SELECT (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date               AS d, "
        "       EXTRACT(YEAR  FROM now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::int AS y, "
        "       EXTRACT(MONTH FROM now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::int AS m"
    )
    return r["d"], int(r["y"]), int(r["m"])


# ─── Gate: chỉ chạy khi schema M40/M41 đã có; nếu thiếu → skip có lý do ──────
async def _hr_schema_missing(db) -> list[str]:
    missing: list[str] = []
    for label, obj in (
        ("table leave_balance",                "public.leave_balance"),
        ("table attendance_incidents",         "public.attendance_incidents"),
        ("table employee_monthly_kpi",         "public.employee_monthly_kpi"),
        ("view employee_current_month_kpi",    "public.employee_current_month_kpi"),
    ):
        if await db.fetchval("SELECT to_regclass($1)", obj) is None:
            missing.append(label)
    if await db.fetchval("SELECT to_regprocedure('public.get_leave_policy(uuid)')") is None:
        missing.append("function get_leave_policy(uuid)")
    if not await db.fetchval(
        "SELECT 1 FROM information_schema.columns "
        "WHERE table_schema='public' AND table_name='leave_requests' "
        "  AND column_name='department'"
    ):
        missing.append("column leave_requests.department")
    if not await db.fetchval(
        "SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid "
        "WHERE t.typname='notification_type' AND e.enumlabel='leave_approved'"
    ):
        missing.append("enum notification_type='leave_approved'")
    return missing


@pytest_asyncio.fixture
async def hr_schema(db):
    """Yêu cầu schema M40/M41. Thiếu bất kỳ object nào → skip (không ERROR)."""
    missing = await _hr_schema_missing(db)
    if missing:
        pytest.skip(
            "Schema M40/M41 chưa có trong test DB — snapshot "
            "tests/_schema_snapshot.sql được dump TRƯỚC khi chạy m40_employee_kpi.sql "
            "+ m41_attendance_leave.sql. Thiếu: " + ", ".join(missing) + ". "
            "Bật bằng: nạp 2 migration đó rồi regenerate snapshot (pg_dump "
            "--schema-only), HOẶC chạy SCHEMA_PRELOADED=1 trên DB đã migrate."
        )
    return True


# ═══════════════════════════════════════════════════════════════════════════
# SMOKE — không cần DB: chứng minh bộ dịch AGGREGATOR_SQL đúng
# ═══════════════════════════════════════════════════════════════════════════
@pytest.mark.smoke
def test_aggregator_sql_translation_selfcheck():
    sql = _aggregator_sql_for_asyncpg()
    # Không còn placeholder psycopg2.
    assert "%(y)s" not in sql and "%(m)s" not in sql and "%(is_final)s" not in sql
    assert "%(" not in sql
    # Không còn '%%' escape; ILIKE literal về đúng một '%'.
    assert "%%" not in sql
    assert "ILIKE 'Báo cáo %'" in sql
    # Có đủ 3 tham số vị trí asyncpg.
    for p in ("$1", "$2", "$3"):
        assert p in sql, f"thiếu placeholder {p}"


# ═══════════════════════════════════════════════════════════════════════════
# LEAVE — duyệt trừ số dư + chặn 409 khi vượt hạn mức
# ═══════════════════════════════════════════════════════════════════════════
@pytest.mark.integration
async def test_leave_approve_deducts_and_blocks_over_quota(db, client, admin, staff, hr_schema):
    """Balance đủ ĐÚNG 1 ngày → duyệt đơn 1 (1 ngày) OK, số dư used=1.0;
    duyệt đơn 2 (1 ngày) VƯỢT hạn mức → 409, số dư giữ nguyên 1.0 (savepoint rollback)."""
    year = date.today().year
    await _set_dept(db, staff["id"], DEPT_A)
    await _seed_balance(db, staff["id"], year, annual_total=1, annual_used=0)

    lid1 = await _seed_leave(db, staff["id"], DEPT_A,
                             start=date(year, 6, 10), end=date(year, 6, 10), days=1)
    lid2 = await _seed_leave(db, staff["id"], DEPT_A,
                             start=date(year, 6, 11), end=date(year, 6, 11), days=1)

    r1 = await client.post(f"/api/v1/leave/{lid1}/approve", headers=admin["headers"], json={})
    assert r1.status_code == 200, r1.text
    assert r1.json()["data"]["status"] == "approved"
    assert await _annual_used(db, staff["id"], year) == 1.0

    r2 = await client.post(f"/api/v1/leave/{lid2}/approve", headers=admin["headers"], json={})
    assert r2.status_code == 409, r2.text
    assert "Vượt quá hạn mức" in r2.json()["detail"]
    # 409 KHÔNG được cộng dồn số dư.
    assert await _annual_used(db, staff["id"], year) == 1.0
    # Đơn 2 vẫn 'pending'.
    st2 = await db.fetchval("SELECT status FROM leave_requests WHERE id = $1", lid2)
    assert st2 == "pending"


# ═══════════════════════════════════════════════════════════════════════════
# LEAVE — RBAC duyệt 1-tier
# ═══════════════════════════════════════════════════════════════════════════
@pytest.mark.integration
async def test_manager_other_dept_cannot_approve(db, client, manager, staff, hr_schema):
    """Manager phòng B duyệt đơn của nhân viên phòng A → 403."""
    year = date.today().year
    await _set_dept(db, staff["id"], DEPT_A)
    await _set_dept(db, manager["id"], DEPT_B)
    lid = await _seed_leave(db, staff["id"], DEPT_A,
                            start=date(year, 6, 10), end=date(year, 6, 10), days=1)

    r = await client.post(f"/api/v1/leave/{lid}/approve", headers=manager["headers"], json={})
    assert r.status_code == 403, r.text
    assert "phòng" in r.json()["detail"].lower()
    assert await db.fetchval("SELECT status FROM leave_requests WHERE id=$1", lid) == "pending"


@pytest.mark.integration
async def test_manager_cannot_self_approve(db, client, manager, hr_schema):
    """Manager KHÔNG được tự duyệt đơn của chính mình (cần admin) → 403."""
    year = date.today().year
    await _set_dept(db, manager["id"], DEPT_A)
    lid = await _seed_leave(db, manager["id"], DEPT_A,
                            start=date(year, 6, 10), end=date(year, 6, 10), days=1)

    r = await client.post(f"/api/v1/leave/{lid}/approve", headers=manager["headers"], json={})
    assert r.status_code == 403, r.text
    assert "tự duyệt" in r.json()["detail"]


@pytest.mark.integration
async def test_admin_can_approve_any(db, client, admin, staff, hr_schema):
    """Admin duyệt được đơn của phòng bất kỳ → 200 (hạn mức mặc định 12 ngày đủ)."""
    year = date.today().year
    await _set_dept(db, staff["id"], DEPT_A)
    lid = await _seed_leave(db, staff["id"], DEPT_A,
                            start=date(year, 6, 10), end=date(year, 6, 10), days=1)

    r = await client.post(f"/api/v1/leave/{lid}/approve", headers=admin["headers"], json={})
    assert r.status_code == 200, r.text
    assert r.json()["data"]["status"] == "approved"
    assert await db.fetchval("SELECT status FROM leave_requests WHERE id=$1", lid) == "approved"


@pytest.mark.integration
async def test_manager_same_dept_can_approve(db, client, manager, staff, hr_schema):
    """Manager CÙNG phòng duyệt đơn nhân viên → 200 (nhánh RBAC hợp lệ)."""
    year = date.today().year
    await _set_dept(db, staff["id"], DEPT_A)
    await _set_dept(db, manager["id"], DEPT_A)
    lid = await _seed_leave(db, staff["id"], DEPT_A,
                            start=date(year, 6, 10), end=date(year, 6, 10), days=1)

    r = await client.post(f"/api/v1/leave/{lid}/approve", headers=manager["headers"], json={})
    assert r.status_code == 200, r.text
    assert r.json()["data"]["status"] == "approved"


@pytest.mark.integration
async def test_cancel_approved_restores_balance(db, client, admin, staff, hr_schema):
    """Đơn 2 ngày: admin duyệt → used=2.0; admin HUỶ đơn đã duyệt → HOÀN số dư về 0.0
    và đơn chuyển 'cancelled'."""
    year = date.today().year
    await _set_dept(db, staff["id"], DEPT_A)
    await _seed_balance(db, staff["id"], year, annual_total=12, annual_used=0)
    lid = await _seed_leave(db, staff["id"], DEPT_A,
                            start=date(year, 6, 10), end=date(year, 6, 11), days=2)

    ra = await client.post(f"/api/v1/leave/{lid}/approve", headers=admin["headers"], json={})
    assert ra.status_code == 200, ra.text
    assert await _annual_used(db, staff["id"], year) == 2.0

    rc = await client.delete(f"/api/v1/leave/{lid}", headers=admin["headers"])
    assert rc.status_code == 200, rc.text
    assert rc.json()["data"]["status"] == "cancelled"
    # Số dư được hoàn.
    assert await _annual_used(db, staff["id"], year) == 0.0
    assert await db.fetchval("SELECT status FROM leave_requests WHERE id=$1", lid) == "cancelled"


# ═══════════════════════════════════════════════════════════════════════════
# ATTENDANCE — UNIQUE(user_id, incident_date, incident_type) → 409
# ═══════════════════════════════════════════════════════════════════════════
@pytest.mark.integration
async def test_attendance_incident_unique_conflict(client, staff, hr_schema):
    """Khai 'late' cùng ngày lần 2 (trùng khoá) → 409; lần 1 tính đúng minutes_off=30."""
    today = date.today().isoformat()
    payload = {
        "incident_date": today,
        "incident_type": "late",
        "expected_time": "08:00:00",
        "actual_time": "08:30:00",
        "reason": "kẹt xe",
    }
    r1 = await client.post("/api/v1/attendance/incidents", headers=staff["headers"], json=payload)
    assert r1.status_code == 201, r1.text
    assert r1.json()["data"]["minutes_off"] == 30

    r2 = await client.post("/api/v1/attendance/incidents", headers=staff["headers"], json=payload)
    assert r2.status_code == 409, r2.text
    assert "Đã có ghi nhận" in r2.json()["detail"]


# ═══════════════════════════════════════════════════════════════════════════
# KPI — VIEW ↔ AGGREGATOR parity (cùng dataset → mọi cột số khớp)
# ═══════════════════════════════════════════════════════════════════════════
@pytest.mark.integration
async def test_aggregator_view_parity(db, staff, hr_schema):
    """Seed 1 nhân viên active + 1 sự cố 'late' 15' + 1 đơn nghỉ đã duyệt trong THÁNG
    HIỆN TẠI (ICT). Chạy AGGREGATOR_SQL cho đúng (năm, tháng) ICT → bounds trùng khít
    live view. So MỌI cột số của employee_current_month_kpi vs employee_monthly_kpi.

    Lưu ý phân kỳ đã biết: view lọc thêm is_active=true, aggregator chỉ deleted_at IS
    NULL — nên ta so THEO TỪNG user (nhân viên đã seed active), không so số dòng."""
    uid = staff["id"]
    await _set_dept(db, uid, DEPT_A)
    d, y, m = await _ict_today(db)

    await _seed_incident(db, uid, DEPT_A, d, 15, "late")
    await _seed_leave(db, uid, DEPT_A, start=d, end=d, days=1, status="approved")

    await _run_aggregator(db, y, m, is_final=False)

    view = await db.fetchrow(
        "SELECT * FROM employee_current_month_kpi WHERE user_id = $1::uuid", uid
    )
    tbl = await db.fetchrow(
        "SELECT * FROM employee_monthly_kpi "
        "WHERE user_id = $1::uuid AND period_year = $2 AND period_month = $3",
        uid, y, m,
    )
    assert view is not None, "view không có dòng cho nhân viên đã seed"
    assert tbl is not None, "aggregator không materialise dòng cho nhân viên đã seed"

    # Non-vacuous: sự cố 'late' đã seed phải hiện ở CẢ HAI phía (không phải 0==0 rỗng).
    assert int(view["late_count"]) == 1 and int(tbl["late_count"]) == 1
    assert int(view["total_late_minutes"]) == 15 and int(tbl["total_late_minutes"]) == 15

    diffs = [
        f"{c}: view={float(view[c])} aggregator={float(tbl[c])}"
        for c in NUMERIC_KPI_COLS
        if float(view[c]) != float(tbl[c])
    ]
    assert not diffs, "VIEW lệch AGGREGATOR ở cột số:\n" + "\n".join(diffs)


# ═══════════════════════════════════════════════════════════════════════════
# KPI — recompute idempotent (chạy 2 lần → số không đổi)
# ═══════════════════════════════════════════════════════════════════════════
@pytest.mark.integration
async def test_kpi_recompute_idempotent(db, staff, hr_schema):
    """Chạy AGGREGATOR_SQL 2 lần cho cùng (năm, tháng) → ON CONFLICT DO UPDATE giữ
    nguyên mọi cột số (chỉ computed_at đổi, đã loại khỏi so sánh)."""
    uid = staff["id"]
    await _set_dept(db, uid, DEPT_A)
    d, y, m = await _ict_today(db)
    await _seed_incident(db, uid, DEPT_A, d, 20, "late")

    await _run_aggregator(db, y, m, is_final=False)
    row1 = await db.fetchrow(
        "SELECT * FROM employee_monthly_kpi "
        "WHERE user_id=$1::uuid AND period_year=$2 AND period_month=$3", uid, y, m,
    )
    await _run_aggregator(db, y, m, is_final=False)
    row2 = await db.fetchrow(
        "SELECT * FROM employee_monthly_kpi "
        "WHERE user_id=$1::uuid AND period_year=$2 AND period_month=$3", uid, y, m,
    )
    assert row1 is not None and row2 is not None
    assert int(row1["late_count"]) == 1 == int(row2["late_count"])
    assert int(row1["total_late_minutes"]) == 20 == int(row2["total_late_minutes"])

    diffs = [
        f"{c}: run1={float(row1[c])} run2={float(row2[c])}"
        for c in NUMERIC_KPI_COLS
        if float(row1[c]) != float(row2[c])
    ]
    assert not diffs, "KPI recompute KHÔNG idempotent:\n" + "\n".join(diffs)
