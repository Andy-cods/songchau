-- m40_pre_leave_requests_ext.sql — CHẠY TRƯỚC m40_employee_kpi.sql.
--
-- LÝ DO (bug phụ thuộc vòng phát hiện 2026-07-03 khi deploy thật):
--   m40 tạo VIEW employee_current_month_kpi tham chiếu leave_requests.half_day_start
--   / half_day_end, NHƯNG 2 cột đó lại do m41 thêm. Đồng thời m41 ALTER
--   employee_monthly_kpi (do m40 tạo). => m40 <-> m41 phụ thuộc vòng, không chạy
--   sạch theo thứ tự nào. Fix: TÁCH phần ALTER leave_requests ra file này, chạy
--   TRƯỚC m40. Thứ tự đúng: m40_pre -> m40 -> m41 (m41 ALTER leave_requests là
--   IF NOT EXISTS nên chạy lại vô hại).
--
-- Nội dung trích từ m41 (mục 3 "leave_requests — extend"). Additive + idempotent.
ALTER TABLE leave_requests
    ADD COLUMN IF NOT EXISTS department         TEXT,
    ADD COLUMN IF NOT EXISTS rejected_by        UUID REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS rejected_at        TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS cancelled_by       UUID REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS cancelled_at       TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS decision_note      TEXT,
    ADD COLUMN IF NOT EXISTS half_day_start     BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS half_day_end       BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE leave_requests DROP CONSTRAINT IF EXISTS chk_lr_days_count;
ALTER TABLE leave_requests
    ADD CONSTRAINT chk_lr_days_count
    CHECK (days_count > 0 AND days_count = ROUND(days_count * 2) / 2);

ALTER TABLE leave_requests DROP CONSTRAINT IF EXISTS chk_lr_dates;
ALTER TABLE leave_requests
    ADD CONSTRAINT chk_lr_dates
    CHECK (start_date <= end_date);
