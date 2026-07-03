-- ============================================================
-- Migration: M45 — Ngày lễ VN (public_holidays) trừ khỏi workdays_present
-- Date: 2026-07-04
-- Roadmap: plans/master-completion/ROADMAP.md C8 / W3-13
--
-- WHY: employee_monthly_kpi.workdays_present hiện tính = (số ngày T2-T6 trong
-- tháng) - leave_days_taken, KHÔNG trừ ngày lễ VN → nhân viên nghỉ lễ vẫn bị
-- tính "có mặt" → KPI ngày công sai (comment cũ ở m40_employee_kpi.sql đã ghi
-- chú "Chưa trừ ngày lễ (xem M42)" nhưng M42 chưa từng làm việc này — M45 làm).
--
-- Làm gì:
--   1. Bảng public_holidays (danh mục ngày lễ, admin quản lý/seed tay).
--   2. Seed ngày lễ dương lịch 2026 (xem chi tiết dưới), ON CONFLICT DO NOTHING.
--   3. CREATE OR REPLACE VIEW employee_current_month_kpi (nguồn: m41's phiên
--      bản mới nhất) — thêm CTE holidays_in_month, trừ vào workdays_present.
--   4. COMMENT lại cột workdays_present cho khớp thực tế.
--
-- KHÔNG đụng AGGREGATOR_SQL (app/tasks/kpi_aggregator.py) — sửa riêng trong
-- cùng đợt W3-13 (Python, không phải migration) để giữ VIEW ↔ AGGREGATOR khớp
-- 100% (enforced bởi test_aggregator_view_parity trong tests/test_hr.py).
--
-- Ngày lễ 2026 (dương lịch, đã tra kỹ):
--   01/01/2026 (Thứ Năm)              — Tết Dương lịch
--   17-23/02/2026 (Thứ Ba → Thứ Hai)  — Tết Nguyên Đán, 7 ngày
--       (mùng 1 Tết Bính Ngọ = 17/02/2026, xác nhận: Tết 2025 = 29/01 → +18
--        ngày âm lịch thường lệch 11 hoặc ~19 ngày dương mỗi năm; 2026 không
--        có tháng nhuận trước Tết nên lệch ~19 ngày → khớp 17/02.)
--   26/04/2026 (Chủ Nhật)             — Giỗ Tổ Hùng Vương (10/3 âm lịch)
--   30/04/2026 (Thứ Năm)              — Ngày Giải phóng miền Nam
--   01/05/2026 (Thứ Sáu)              — Ngày Quốc tế Lao động
--   01/09/2026 (Thứ Ba) + 02/09/2026 (Thứ Tư) — Quốc khánh (2 ngày, theo
--       thông lệ MOLISA công bố Quốc khánh luôn kèm 1 ngày liền kề; 2026 chưa
--       có nghị quyết chính thức tại thời điểm viết migration này — TẠM xếp
--       01/09 liền trước. Nếu nghị quyết chính thức chọn 03/09 thay vì 01/09,
--       xem ghi chú UPDATE mẫu ở cuối file.)
--
-- Giỗ Tổ (26/04, Chủ Nhật) và các ngày lễ khác rơi vào T7/CN không được cộng
-- thêm "nghỉ bù" ở đây — bảng chỉ lưu NGÀY LỄ THỰC TẾ; công thức trừ workdays
-- (bên dưới) đã tự loại các ngày lễ rơi vào cuối tuần (EXTRACT(ISODOW) < 6),
-- nên chúng vốn không bị trừ 2 lần. Nếu công ty CÓ áp dụng nghỉ bù (vd. thứ Hai
-- 27/04/2026 cho Giỗ Tổ trùng Chủ Nhật) thì INSERT thêm ngày đó — CẦN THANG
-- XÁC NHẬN trước khi thêm (xem báo cáo cuối task).
--
-- Idempotent: INSERT ... ON CONFLICT DO NOTHING; CREATE TABLE IF NOT EXISTS;
-- DROP VIEW IF EXISTS + CREATE VIEW an toàn re-run (không có dữ liệu trong view).
-- Run with:  psql "$DATABASE_URL" -f m45_public_holidays.sql
-- ============================================================

BEGIN;

-- ─── 1. public_holidays ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public_holidays (
    id            BIGSERIAL PRIMARY KEY,
    holiday_date  DATE NOT NULL UNIQUE,
    name          TEXT,
    is_active     BOOLEAN NOT NULL DEFAULT true,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public_holidays IS
    'M45 — Danh mục ngày lễ VN dùng để trừ khỏi employee_monthly_kpi.workdays_present. '
    'is_active=false để "tắt" 1 ngày mà không xoá lịch sử. Admin seed/sửa tay qua SQL '
    '(chưa có UI quản trị riêng).';
COMMENT ON COLUMN public_holidays.holiday_date IS
    'Ngày dương lịch. Chỉ ngày rơi vào Thứ 2-6 (ISODOW 1-5) mới được trừ khỏi workdays_present '
    '— ngày lễ rơi T7/CN không trừ thêm (vốn đã không tính là ngày công).';

CREATE INDEX IF NOT EXISTS idx_public_holidays_active
    ON public_holidays (holiday_date) WHERE is_active = true;

-- ─── 2. Seed ngày lễ VN 2026 ─────────────────────────────────────────
INSERT INTO public_holidays (holiday_date, name) VALUES
    ('2026-01-01', 'Tết Dương lịch'),
    ('2026-02-17', 'Tết Nguyên Đán — mùng 1 Tết Bính Ngọ'),
    ('2026-02-18', 'Tết Nguyên Đán — mùng 2 Tết'),
    ('2026-02-19', 'Tết Nguyên Đán — mùng 3 Tết'),
    ('2026-02-20', 'Tết Nguyên Đán — mùng 4 Tết'),
    ('2026-02-21', 'Tết Nguyên Đán — mùng 5 Tết'),
    ('2026-02-22', 'Tết Nguyên Đán — nghỉ thêm'),
    ('2026-02-23', 'Tết Nguyên Đán — nghỉ thêm'),
    ('2026-04-26', 'Giỗ Tổ Hùng Vương (10/3 âm lịch)'),
    ('2026-04-30', 'Ngày Giải phóng miền Nam'),
    ('2026-05-01', 'Ngày Quốc tế Lao động'),
    ('2026-09-01', 'Nghỉ liền kề Quốc khánh (tạm xếp — chờ nghị quyết chính thức)'),
    ('2026-09-02', 'Quốc khánh')
ON CONFLICT (holiday_date) DO NOTHING;

-- Nếu nghị quyết chính thức chọn 03/09 thay cho 01/09, chạy tay (không đưa vào
-- migration này để tránh 2 script tranh nhau update cùng bản ghi):
--   DELETE FROM public_holidays WHERE holiday_date = '2026-09-01';
--   INSERT INTO public_holidays (holiday_date, name)
--     VALUES ('2026-09-03', 'Nghỉ liền kề Quốc khánh') ON CONFLICT DO NOTHING;

-- ─── 3. employee_current_month_kpi — trừ thêm ngày lễ ───────────────
-- Giữ NGUYÊN toàn bộ CTE của m41_attendance_leave.sql, chỉ thêm
-- holidays_in_month + trừ vào workdays_present.
DROP VIEW IF EXISTS employee_current_month_kpi;
CREATE VIEW employee_current_month_kpi AS
WITH bounds AS (
    SELECT
        date_trunc('month', NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date          AS d_start,
        (date_trunc('month', NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh') + INTERVAL '1 month')::date AS d_end_excl,
        EXTRACT(YEAR  FROM (NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh'))::SMALLINT     AS y,
        EXTRACT(MONTH FROM (NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh'))::SMALLINT     AS m
),
weekdays_in_month AS (
    SELECT b.y, b.m, COUNT(*)::INT AS wd
    FROM bounds b,
         generate_series(b.d_start, b.d_end_excl - INTERVAL '1 day', INTERVAL '1 day') AS d
    WHERE EXTRACT(ISODOW FROM d) < 6
    GROUP BY b.y, b.m
),
holidays_in_month AS (
    -- M45: ngày lễ active, rơi vào T2-T6 (ISODOW 1-5), trong tháng đang xét.
    SELECT b.y, b.m, COUNT(*)::INT AS hd
    FROM bounds b
    JOIN public_holidays ph
      ON ph.holiday_date >= b.d_start
     AND ph.holiday_date <  b.d_end_excl
     AND ph.is_active = true
    WHERE EXTRACT(ISODOW FROM ph.holiday_date) < 6
    GROUP BY b.y, b.m
),
revenue AS (
    SELECT so.created_by AS user_id,
           SUM(so.total_amount * CASE WHEN so.currency = 'VND' THEN 1
                                      ELSE COALESCE(fx.rate, 0) END) AS revenue_vnd,
           COUNT(*)                                                  AS orders_count
    FROM sales_orders so
    CROSS JOIN bounds b
    LEFT JOIN LATERAL (
        SELECT er.rate FROM exchange_rates er
        WHERE er.from_currency = so.currency
          AND er.to_currency   = 'VND'
          AND er.rate_date    <= so.created_at::date
        ORDER BY er.rate_date DESC, (er.rate_type = 'transfer') DESC
        LIMIT 1
    ) fx ON so.currency <> 'VND'
    WHERE so.created_at >= b.d_start
      AND so.created_at <  b.d_end_excl
      AND so.status NOT IN ('draft', 'cancelled')
    GROUP BY so.created_by
),
new_cust AS (
    SELECT al.user_id, COUNT(*)::INT AS n
    FROM audit_log al, bounds b
    WHERE al.table_name = 'customers' AND al.action = 'INSERT'
      AND al.created_at >= b.d_start AND al.created_at < b.d_end_excl
      AND al.user_id IS NOT NULL
    GROUP BY al.user_id
),
new_prod AS (
    SELECT al.user_id, COUNT(*)::INT AS n
    FROM audit_log al, bounds b
    WHERE al.table_name = 'products' AND al.action = 'INSERT'
      AND al.created_at >= b.d_start AND al.created_at < b.d_end_excl
      AND al.user_id IS NOT NULL
    GROUP BY al.user_id
),
new_supp_codes AS (
    SELECT al.user_id, COUNT(*)::INT AS n
    FROM audit_log al, bounds b
    WHERE al.table_name = 'supplier_product_map' AND al.action = 'INSERT'
      AND al.created_at >= b.d_start AND al.created_at < b.d_end_excl
      AND al.user_id IS NOT NULL
    GROUP BY al.user_id
),
quotes_sent_cte AS (
    SELECT q.quoted_by AS user_id, COUNT(*)::INT AS n
    FROM bqms_quote_log q, bounds b
    WHERE q.quoted_at >= b.d_start AND q.quoted_at < b.d_end_excl
      AND q.quoted_by IS NOT NULL
    GROUP BY q.quoted_by
),
quotes_won_cte AS (
    SELECT po.won_by AS user_id, COUNT(*)::INT AS n
    FROM bqms_samsung_po po, bounds b
    WHERE po.created_at >= b.d_start AND po.created_at < b.d_end_excl
      AND po.won_by IS NOT NULL
    GROUP BY po.won_by
),
deals_closed_cte AS (
    SELECT rc.created_by AS user_id, COUNT(*)::INT AS n
    FROM revenue_chain rc, bounds b
    WHERE rc.is_complete = true
      AND rc.completed_at >= b.d_start AND rc.completed_at < b.d_end_excl
      AND rc.created_by IS NOT NULL
    GROUP BY rc.created_by
),
daily_reports AS (
    SELECT r.result_updated_by AS user_id,
           COUNT(DISTINCT DATE(r.updated_at AT TIME ZONE 'Asia/Ho_Chi_Minh'))::INT AS n
    FROM bqms_rfq r, bounds b
    WHERE r.report IS NOT NULL
      AND r.report ILIKE 'Báo cáo %'
      AND r.updated_at >= b.d_start AND r.updated_at < b.d_end_excl
      AND r.result_updated_by IS NOT NULL
    GROUP BY r.result_updated_by
),
leave_days AS (
    SELECT lr.user_id,
           SUM(
               (SELECT COUNT(*)
                FROM generate_series(GREATEST(lr.start_date, b.d_start),
                                     LEAST(lr.end_date, b.d_end_excl - INTERVAL '1 day'),
                                     INTERVAL '1 day') AS d
                WHERE EXTRACT(ISODOW FROM d) < 6)
               - CASE WHEN lr.half_day_start AND lr.start_date >= b.d_start THEN 0.5 ELSE 0 END
               - CASE WHEN lr.half_day_end   AND lr.end_date   <  b.d_end_excl THEN 0.5 ELSE 0 END
           )::NUMERIC(4,1) AS days
    FROM leave_requests lr, bounds b
    WHERE lr.status = 'approved'
      AND lr.start_date < b.d_end_excl
      AND lr.end_date  >= b.d_start
    GROUP BY lr.user_id
),
activity AS (
    SELECT ual.user_id,
           COUNT(DISTINCT DATE(ual.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh'))::INT AS active_days,
           COUNT(*)::INT AS total_actions
    FROM user_activity_log ual, bounds b
    WHERE ual.created_at >= b.d_start AND ual.created_at < b.d_end_excl
    GROUP BY ual.user_id
),
late_cte AS (
    SELECT ai.user_id,
           COUNT(*) FILTER (WHERE ai.incident_type = 'late')::INT AS late_count,
           COALESCE(SUM(ai.minutes_off) FILTER (WHERE ai.incident_type = 'late'), 0)::INT
                                                                  AS total_late_minutes
    FROM attendance_incidents ai, bounds b
    WHERE ai.incident_date >= b.d_start AND ai.incident_date < b.d_end_excl
    GROUP BY ai.user_id
)
SELECT
    u.id                                     AS user_id,
    u.department                             AS department,
    b.y                                      AS period_year,
    b.m                                      AS period_month,
    (b.y * 100 + b.m)::INT                   AS period_key,
    COALESCE(r.revenue_vnd, 0)::NUMERIC(18,2) AS revenue_vnd,
    COALESCE(r.orders_count, 0)::INT          AS orders_count,
    CASE WHEN COALESCE(r.orders_count, 0) > 0
         THEN (r.revenue_vnd / r.orders_count)::NUMERIC(18,2)
         ELSE 0::NUMERIC(18,2) END           AS avg_order_value,
    COALESCE(nc.n,  0)                       AS new_customers,
    COALESCE(np.n,  0)                       AS new_products,
    COALESCE(nsc.n, 0)                       AS new_supplier_codes,
    COALESCE(qs.n,  0)                       AS quotes_sent,
    COALESCE(qw.n,  0)                       AS quotes_won,
    COALESCE(dc.n,  0)                       AS deals_closed,
    COALESCE(dr.n,  0)                       AS daily_reports_submitted,
    COALESCE(ld.days, 0)::NUMERIC(4,1)       AS leave_days_taken,
    COALESCE(act.active_days, 0)             AS active_days,
    COALESCE(act.total_actions, 0)           AS total_actions,
    GREATEST(0, wd.wd - COALESCE(hd.hd, 0) - COALESCE(ld.days, 0)::INT) AS workdays_present,
    COALESCE(lc.late_count, 0)               AS late_count,
    COALESCE(lc.total_late_minutes, 0)       AS total_late_minutes,
    NOW()                                    AS computed_at,
    false                                    AS is_final
FROM users u
CROSS JOIN bounds b
CROSS JOIN weekdays_in_month wd
LEFT JOIN holidays_in_month hd  ON hd.y = b.y AND hd.m = b.m
LEFT JOIN revenue          r   ON r.user_id   = u.id
LEFT JOIN new_cust         nc  ON nc.user_id  = u.id
LEFT JOIN new_prod         np  ON np.user_id  = u.id
LEFT JOIN new_supp_codes   nsc ON nsc.user_id = u.id
LEFT JOIN quotes_sent_cte  qs  ON qs.user_id  = u.id
LEFT JOIN quotes_won_cte   qw  ON qw.user_id  = u.id
LEFT JOIN deals_closed_cte dc  ON dc.user_id  = u.id
LEFT JOIN daily_reports    dr  ON dr.user_id  = u.id
LEFT JOIN leave_days       ld  ON ld.user_id  = u.id
LEFT JOIN activity         act ON act.user_id = u.id
LEFT JOIN late_cte         lc  ON lc.user_id  = u.id
WHERE u.deleted_at IS NULL
  AND u.is_active  = true;

-- ─── 4. Comment lại cho khớp thực tế (m40 ghi "Chưa trừ ngày lễ (xem M42)") ──
COMMENT ON COLUMN employee_monthly_kpi.workdays_present IS
    'Mon-Fri trong tháng - ngày lễ (public_holidays, M45) - leave_days_taken.';

COMMIT;
