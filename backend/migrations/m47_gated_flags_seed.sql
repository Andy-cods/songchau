-- ============================================================
-- m47_gated_flags_seed.sql  (W3-00 / W3-06 — gated money-flow flags)
--
-- MỤC ĐÍCH: đảm bảo 3 CỜ TIỀN + ngưỡng TỒN TẠI trong app_config và ở trạng
-- thái TẮT rõ ràng, TẬP TRUNG MỘT CHỖ. Trước đây các cờ này bị seed rải rác:
--   * procurement_auto_ap_enabled      → procurement_ap_001_payables.sql
--   * procurement_award_approval_*      → procurement_v2_020_award_approval.sql
--   * phase3_auto_ar_enabled            → CHƯA TỪNG được seed ở migration nào
--                                          (chỉ có env PHASE3_AUTO_AR_ENABLED +
--                                           override đọc runtime). File này vá.
--
-- ⚠️ ĐÂY LÀ MONEY-FLOW. File này TUYỆT ĐỐI KHÔNG set 'true' bất kỳ cờ nào.
--    ON CONFLICT DO NOTHING → chạy lại KHÔNG ghi đè giá trị Thang đã đổi, và
--    KHÔNG bao giờ tắt một cờ Thang đã cố ý bật. Bật cờ là việc TAY của Thang.
--
-- ADDITIVE · IDEMPOTENT · TRANSACTIONAL. Không tạo/sửa schema, chỉ seed dữ liệu.
--
-- Author: COOK BACKEND — W3-06 (2026-07-04)
-- DEPLOY: docker cp + psql -f (không cần restart — chỉ là dữ liệu app_config).
-- ============================================================

BEGIN;

INSERT INTO app_config (key, value)
VALUES
    -- auto-AR: duyệt đề xuất thanh toán → tạo accounts_receivable (công nợ phải
    -- thu). Gate ở app/api/v1/payment_requests.py (approve_payment_request).
    ('phase3_auto_ar_enabled',                   'false'::jsonb),

    -- auto-AP: giao hàng chuyển 'received' → tạo accounts_payable (công nợ phải
    -- trả). Gate ở app/api/v1/procurement.py (update_delivery_status).
    ('procurement_auto_ap_enabled',              'false'::jsonb),

    -- maker-checker AWARD: cổng master. BẬT → award ≥ ngưỡng phải người-thứ-2
    -- duyệt (SoD: checker ≠ proposer). Gate ở procurement.py (award/approve-award).
    ('procurement_award_approval_enabled',       'false'::jsonb),

    -- ngưỡng VND: award có tổng ≥ mức này mới cần duyệt (CHỈ có hiệu lực khi cờ
    -- trên BẬT). Lưu JSON number → value::text = '50000000'.
    ('procurement_award_approval_threshold_vnd', '50000000'::jsonb),

    -- break-glass: cho phép tự-duyệt khẩn cấp (có ghi audit + cảnh báo). GIỮ TẮT.
    ('procurement_award_breakglass_enabled',     'false'::jsonb)
ON CONFLICT (key) DO NOTHING;

COMMIT;

-- ─── VERIFICATION (chạy tay sau migrate — mọi value PHẢI = false / 50000000) ───
-- SELECT key, value FROM app_config
--  WHERE key IN (
--    'phase3_auto_ar_enabled',
--    'procurement_auto_ap_enabled',
--    'procurement_award_approval_enabled',
--    'procurement_award_approval_threshold_vnd',
--    'procurement_award_breakglass_enabled'
--  )
--  ORDER BY key;
