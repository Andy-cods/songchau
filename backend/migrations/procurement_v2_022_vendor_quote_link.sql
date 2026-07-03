-- Đợt sau-demo (Thang 2026-06-29): NCC khi báo giá có thể dán 1 LINK tham khảo
-- (URL OneDrive/Drive/website…) ở cấp BÁO GIÁ — bổ sung cho file đính kèm cấp-phiếu
-- đã có sẵn (vendor_quotes.attachment_path). QUOTE-LEVEL ONLY (KISS — chốt với Thang).
--
-- Idempotent + additive (không đụng dữ liệu cũ). CHECK chỉ cho phép NULL hoặc
-- http(s):// — chặn javascript:/data:/file: ở tầng DB (defense-in-depth cùng với
-- validate trong submit_quote). Link lưu nguyên văn, render rel="noopener" và
-- TUYỆT ĐỐI không fetch phía server (không SSRF).

ALTER TABLE vendor_quotes ADD COLUMN IF NOT EXISTS external_url TEXT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'vendor_quotes_external_url_scheme'
    ) THEN
        ALTER TABLE vendor_quotes
            ADD CONSTRAINT vendor_quotes_external_url_scheme
            CHECK (external_url IS NULL OR external_url ~* '^https?://');
    END IF;
END $$;

-- verification
SELECT column_name, data_type
  FROM information_schema.columns
 WHERE table_name = 'vendor_quotes' AND column_name = 'external_url';
