-- Phase 2 (2026-05-12 per Thang) — Mở rộng bqms_rfq với 3 cột:
--   * requester  — Tên người Samsung yêu cầu báo giá (lấy từ xlsx Basic Information)
--   * department — Phòng ban Samsung order hàng (cho phép thống kê win rate theo dept)
--   * assigned_to — UUID user (nhân viên ERP) chịu trách nhiệm báo giá mã này
--
-- Cột "Người PT" trên BQMS table sẽ ưu tiên đọc users.full_name JOIN qua assigned_to,
-- fallback person_in_charge_name nếu chưa assigned. Khi user submit quote thì
-- assigned_to = current_user.id (auto-tracklog).
--
-- Idempotent: dùng IF NOT EXISTS để chạy nhiều lần an toàn.

ALTER TABLE bqms_rfq ADD COLUMN IF NOT EXISTS requester  TEXT;
ALTER TABLE bqms_rfq ADD COLUMN IF NOT EXISTS department TEXT;
ALTER TABLE bqms_rfq ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_bqms_rfq_assigned_to ON bqms_rfq(assigned_to);
CREATE INDEX IF NOT EXISTS idx_bqms_rfq_department  ON bqms_rfq(department);

COMMENT ON COLUMN bqms_rfq.requester  IS 'Người Samsung yêu cầu (từ xlsx Basic Information)';
COMMENT ON COLUMN bqms_rfq.department IS 'Phòng ban Samsung order (cho thống kê)';
COMMENT ON COLUMN bqms_rfq.assigned_to IS 'Nhân viên ERP báo giá (auto-set khi POST quote, dùng cho cột Người PT)';

-- Phase 2.4: thêm enum value 'closed' để track các RFQ Samsung đã đóng (hết hạn D-Day).
-- Periodic scrape sẽ UPDATE bqms_rfq.result='closed' khi raw_json.progressStatusName ILIKE '%closed%'.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum
        WHERE enumlabel = 'closed'
          AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'rfq_result')
    ) THEN
        ALTER TYPE rfq_result ADD VALUE 'closed';
    END IF;
END$$;

