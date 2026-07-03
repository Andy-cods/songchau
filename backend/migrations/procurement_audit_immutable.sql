-- Đợt A · Blocker B5 (Thang 2026-06-28): procurement_audit_log BẤT BIẾN.
--
-- Bối cảnh: Thang sắp mở rộng sang đấu thầu CHÍNH THỨC → hồ sơ thầu (award,
-- phê duyệt, lý do) cần tamper-evidence ở tầng DB (table-stakes compliance).
-- Đã verify: bảng CHỈ được INSERT (procurement.py:104 _append_audit); KHÔNG
-- code path nào UPDATE/DELETE (grep=0) và task audit_retention KHÔNG đụng tới
-- bảng này. Vậy trigger chặn cứng UPDATE/DELETE là AN TOÀN tuyệt đối — không
-- phá luồng nào — và khiến lịch sử đấu thầu không thể sửa kể cả lỡ tay / SQL
-- injection / truy cập DB trực tiếp.
--
-- Idempotent.

CREATE OR REPLACE FUNCTION procurement_audit_log_immutable()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION
        'procurement_audit_log bất biến: thao tác % bị chặn (audit log chỉ được ghi thêm)',
        TG_OP
        USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_procurement_audit_log_immutable ON procurement_audit_log;
CREATE TRIGGER trg_procurement_audit_log_immutable
    BEFORE UPDATE OR DELETE ON procurement_audit_log
    FOR EACH ROW EXECUTE FUNCTION procurement_audit_log_immutable();
