-- ============================================================
-- Migration: M44 — audit_log APPEND-ONLY (immutable)
-- Date: 2026-07-04 (Thang, W3-07)
--
-- WHY: audit_log đã được ghi (INSERT) ở nhiều nơi — trigger DB
-- auto_audit_log() cho accounts_payable/accounts_receivable/customers/
-- cash_book/purchase_orders/sales_orders/suppliers/... + các lời gọi
-- app-level _write_audit_log/write_audit_log cho sales_invoices_q/
-- purchase_invoices_q/payment_transactions/payment_requests — nhưng CHƯA hề
-- có ràng buộc nào chặn UPDATE/DELETE trên chính bảng audit_log. Bất kỳ
-- role/kết nối nào có quyền ghi bảng này (kể cả psql trực tiếp) đều có thể
-- sửa/xoá dấu vết audit, phá vỡ mục tiêu compliance "nhật ký bất biến".
--
-- WHAT: 1 hàm trigger `audit_log_immutable()` RAISE EXCEPTION cho mọi UPDATE
-- hoặc DELETE, gắn làm trigger BEFORE UPDATE OR DELETE ON audit_log. INSERT
-- KHÔNG bị đụng tới — mọi cơ chế ghi audit hiện có tiếp tục chạy bình
-- thường; chỉ chặn sửa/xoá VỀ SAU (không đụng dữ liệu đã có).
--
-- Mirrors migrations/procurement_audit_immutable.sql (Đợt A · Blocker B5,
-- Thang 2026-06-28) — CÙNG pattern đã có sẵn trong repo cho bảng audit khác
-- (procurement_audit_log): hàm đặt tên `<table>_immutable()`, trigger đặt
-- tên `trg_<table>_immutable`, và RAISE EXCEPTION có `USING ERRCODE =
-- 'integrity_constraint_violation'` (SQLSTATE lớp 23 — đúng ngữ nghĩa "vi
-- phạm ràng buộc toàn vẹn" hơn mã P0001 mặc định của RAISE EXCEPTION trần,
-- và khớp asyncpg.exceptions.IntegrityConstraintViolationError phía app/test).
--
-- AN TOÀN: không đổi schema bảng audit_log, không xoá/sửa dữ liệu hiện có.
-- Idempotent (CREATE OR REPLACE FUNCTION + DROP TRIGGER IF EXISTS/CREATE
-- TRIGGER) — chạy lại nhiều lần vô hại.
--
-- LƯU Ý: cố ý KHÔNG bọc BEGIN/COMMIT — mỗi câu lệnh DDL dưới đây tự an toàn
-- khi chạy độc lập (qua psql) LẪN khi chạy lồng bên trong một transaction đã
-- mở sẵn (vd. transaction rollback-only của test harness — xem
-- tests/test_audit_immutable.py), tránh COMMIT sớm làm hỏng transaction của
-- caller.
-- ============================================================

CREATE OR REPLACE FUNCTION public.audit_log_immutable()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION
        'audit_log is append-only (immutable) — UPDATE/DELETE bị cấm'
        USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_log_immutable ON public.audit_log;
CREATE TRIGGER trg_audit_log_immutable
    BEFORE UPDATE OR DELETE ON public.audit_log
    FOR EACH ROW EXECUTE FUNCTION public.audit_log_immutable();
