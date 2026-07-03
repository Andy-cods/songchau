"""W3-13 — Trừ NGÀY LỄ (public_holidays, M45) khỏi workdays_present.

Bối cảnh: employee_monthly_kpi.workdays_present được tính giống nhau ở 2 nơi
(khớp nhau được enforce bởi test_aggregator_view_parity trong test_hr.py):
  * VIEW  employee_current_month_kpi  — backend/migrations/m45_public_holidays.sql
  * AGGREGATOR_SQL                    — backend/app/tasks/kpi_aggregator.py

Cả 2 nơi dùng chung công thức:

    workdays_present = GREATEST(0, weekdays_in_month - holidays_in_month - leave_days_taken)

trong đó holidays_in_month = COUNT ngày lễ (public_holidays, is_active=true) rơi
vào tháng đang xét VÀ là ngày làm việc T2-T6 (EXTRACT(ISODOW) 1..5). Trước M45,
holidays_in_month không tồn tại → ngày lễ vẫn bị tính là "có mặt" → KPI sai.

Vì sao test KHÔNG dùng hr_schema (pattern của test_hr.py)
──────────────────────────────────────────────────────────
public_holidays là bảng MỚI (M45) — CHƯA có trong tests/_schema_snapshot.sql
(pg_dump chụp trước migration này). Nếu gate qua hr_schema như test_hr.py, mọi
test ở đây sẽ SKIP mãi mãi cho tới khi ai đó nạp migration thật + regenerate
snapshot — việc đó cần một Postgres sống + quyền chạy migration, ngoài phạm vi
Read/Edit-only (không SSH/deploy) của đợt W3-13 này.

Thay vào đó: tự CREATE TABLE IF NOT EXISTS public_holidays trong transaction
rollback của fixture `db` (Postgres cho DDL trong transaction, rollback xoá
sạch) rồi test TRỰC TIẾP công thức arithmetic ở trên — không JOIN qua
sales_orders/customers/users/... nên chạy được trên CẢ bootstrap schema (CI
mặc định, không cần _schema_snapshot.sql) lẫn full snapshot. Công thức được
chép lại y hệt 2 nơi sản xuất (bounds/weekdays_in_month/holidays_in_month) để
phép tính đúng là phép tính thật, không phải một mô phỏng khác.

Test cuối (smoke, không cần DB) đọc thẳng chuỗi AGGREGATOR_SQL để bảo vệ khỏi
một sửa đổi sau này vô tình làm mất phần trừ ngày lễ.
"""

from __future__ import annotations

from datetime import date

import pytest
import pytest_asyncio

# Công thức TRÙNG với holidays_in_month + workdays_present trong:
#   - backend/migrations/m45_public_holidays.sql  (VIEW employee_current_month_kpi)
#   - backend/app/tasks/kpi_aggregator.py          (AGGREGATOR_SQL)
# weekdays_in_month và holidays_in_month đều là aggregate KHÔNG GROUP BY nên
# luôn trả đúng 1 dòng (0 nếu rỗng) — khỏi cần LEFT JOIN/COALESCE như bản gốc
# (bản gốc GROUP BY b.y,b.m vì xử lý mọi user cùng lúc).
_WORKDAYS_PRESENT_SQL = """
WITH bounds AS (
    SELECT make_date($1::int, $2::int, 1)                              AS d_start,
           (make_date($1::int, $2::int, 1) + INTERVAL '1 month')::date AS d_end_excl
),
weekdays_in_month AS (
    SELECT COUNT(*)::INT AS wd
    FROM bounds b,
         generate_series(b.d_start, b.d_end_excl - INTERVAL '1 day', INTERVAL '1 day') AS d
    WHERE EXTRACT(ISODOW FROM d) < 6
),
holidays_in_month AS (
    SELECT COUNT(*)::INT AS hd
    FROM bounds b
    JOIN public_holidays ph
      ON ph.holiday_date >= b.d_start
     AND ph.holiday_date <  b.d_end_excl
     AND ph.is_active = true
    WHERE EXTRACT(ISODOW FROM ph.holiday_date) < 6
)
SELECT wd.wd                                AS weekdays,
       hd.hd                                AS holidays,
       GREATEST(0, wd.wd - hd.hd - $3::int) AS workdays_present
FROM weekdays_in_month wd, holidays_in_month hd
"""


async def _create_public_holidays_table(db) -> None:
    """DDL y hệt backend/migrations/m45_public_holidays.sql — tự tạo trong
    transaction rollback vì bảng chưa có ở tests/_schema_snapshot.sql."""
    await db.execute(
        """
        CREATE TABLE IF NOT EXISTS public_holidays (
            id            BIGSERIAL PRIMARY KEY,
            holiday_date  DATE NOT NULL UNIQUE,
            name          TEXT,
            is_active     BOOLEAN NOT NULL DEFAULT true,
            created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )


async def _workdays_present(db, year: int, month: int, leave_days: int = 0) -> dict:
    row = await db.fetchrow(_WORKDAYS_PRESENT_SQL, year, month, leave_days)
    return dict(row)


async def _assert_isodow(db, d: date, expected_isodow: int, label: str) -> None:
    """Chốt chặn: nếu ngày chọn để test không đúng thứ như kỳ vọng (vd lịch dương
    2026 bị nhớ nhầm), test phải FAIL rõ ràng ở đây thay vì pass giả vì lý do khác."""
    dow = await db.fetchval("SELECT EXTRACT(ISODOW FROM $1::date)::int", d)
    assert dow == expected_isodow, (
        f"{label}: {d.isoformat()} có ISODOW={dow}, kỳ vọng {expected_isodow} "
        "(1=Thứ Hai .. 7=Chủ Nhật) — kiểm tra lại lịch dương 2026."
    )


@pytest_asyncio.fixture
async def holidays_table(db):
    await _create_public_holidays_table(db)
    return True


# ═══════════════════════════════════════════════════════════════════════════
# Ngày lễ GIỮA TUẦN (T2-T6) → trừ đúng 1
# ═══════════════════════════════════════════════════════════════════════════
@pytest.mark.integration
async def test_midweek_holiday_reduces_workdays_present_by_one(db, holidays_table):
    """Tháng 07/2026, chưa seed lễ nào → baseline. Seed 1 ngày lễ GIỮA TUẦN
    (15/07/2026 = Thứ Tư) → workdays_present giảm ĐÚNG 1 so với baseline, và
    holidays_in_month đếm đúng 1."""
    year, month = 2026, 7
    await _assert_isodow(db, date(2026, 7, 15), 3, "15/07/2026")

    before = await _workdays_present(db, year, month)
    assert before["holidays"] == 0

    await db.execute(
        "INSERT INTO public_holidays (holiday_date, name) VALUES ($1, 'Test lễ giữa tuần')",
        date(2026, 7, 15),
    )
    after = await _workdays_present(db, year, month)
    assert after["holidays"] == 1
    assert after["workdays_present"] == before["workdays_present"] - 1


# ═══════════════════════════════════════════════════════════════════════════
# Ngày lễ rơi CUỐI TUẦN → không trừ thêm (đã không tính là ngày công từ đầu)
# ═══════════════════════════════════════════════════════════════════════════
@pytest.mark.integration
async def test_weekend_holiday_does_not_reduce_workdays_present(db, holidays_table):
    """06/09/2026 = Chủ Nhật. Seed làm ngày lễ → holidays_in_month vẫn = 0 (công
    thức lọc EXTRACT(ISODOW) < 6) → workdays_present KHÔNG đổi."""
    year, month = 2026, 9
    await _assert_isodow(db, date(2026, 9, 6), 7, "06/09/2026")

    before = await _workdays_present(db, year, month)

    await db.execute(
        "INSERT INTO public_holidays (holiday_date, name) VALUES ($1, 'Test lễ cuối tuần')",
        date(2026, 9, 6),
    )
    after = await _workdays_present(db, year, month)
    assert after["holidays"] == 0, "ngày lễ cuối tuần không được đếm vào holidays_in_month"
    assert after["workdays_present"] == before["workdays_present"]


# ═══════════════════════════════════════════════════════════════════════════
# is_active=false → bỏ qua (admin "tắt" 1 ngày lễ mà không cần xoá)
# ═══════════════════════════════════════════════════════════════════════════
@pytest.mark.integration
async def test_inactive_holiday_is_ignored(db, holidays_table):
    """16/12/2026 = Thứ Tư (giữa tuần, đúng điều kiện T2-T6) nhưng is_active=false
    → vẫn KHÔNG trừ. Chứng minh cờ is_active thật sự được công thức tôn trọng,
    không phải midweek-ness."""
    year, month = 2026, 12
    await _assert_isodow(db, date(2026, 12, 16), 3, "16/12/2026")

    before = await _workdays_present(db, year, month)

    await db.execute(
        "INSERT INTO public_holidays (holiday_date, name, is_active) "
        "VALUES ($1, 'Test tắt lễ', false)",
        date(2026, 12, 16),
    )
    after = await _workdays_present(db, year, month)
    assert after["holidays"] == 0
    assert after["workdays_present"] == before["workdays_present"]


# ═══════════════════════════════════════════════════════════════════════════
# Lễ + nghỉ phép cộng dồn (không ăn lẫn nhau)
# ═══════════════════════════════════════════════════════════════════════════
@pytest.mark.integration
async def test_leave_days_still_subtracted_alongside_holidays(db, holidays_table):
    """Trừ ĐỒNG THỜI cả ngày lễ (1) lẫn ngày nghỉ phép (2, tham số leave_days) —
    workdays_present phải giảm đúng tổng 3, không cộng dồn sai hay ăn lẫn nhau."""
    year, month = 2026, 7
    await _assert_isodow(db, date(2026, 7, 8), 3, "08/07/2026")

    baseline = await _workdays_present(db, year, month, leave_days=0)

    await db.execute(
        "INSERT INTO public_holidays (holiday_date, name) VALUES ($1, 'Test lễ')",
        date(2026, 7, 8),
    )
    with_both = await _workdays_present(db, year, month, leave_days=2)
    assert with_both["workdays_present"] == baseline["workdays_present"] - 1 - 2


# ═══════════════════════════════════════════════════════════════════════════
# SMOKE — không cần DB: bảo vệ AGGREGATOR_SQL khỏi vô tình mất phần trừ lễ
# ═══════════════════════════════════════════════════════════════════════════
@pytest.mark.smoke
def test_aggregator_sql_includes_holiday_subtraction():
    """kpi_aggregator.AGGREGATOR_SQL phải có CTE holidays_in_month (JOIN
    public_holidays) VÀ công thức workdays_present phải trừ hd.hd. Kiểm text
    thô (giống test_aggregator_sql_translation_selfcheck) nên chạy trong CI mặc
    định (smoke or unit), không cần Postgres."""
    from app.tasks.kpi_aggregator import AGGREGATOR_SQL

    assert "holidays_in_month" in AGGREGATOR_SQL
    assert "JOIN public_holidays" in AGGREGATOR_SQL
    assert "ph.is_active = true" in AGGREGATOR_SQL
    assert "LEFT JOIN holidays_in_month hd" in AGGREGATOR_SQL
    assert "wd.wd - COALESCE(hd.hd, 0) - COALESCE(ld.days, 0)" in AGGREGATOR_SQL
