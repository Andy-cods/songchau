-- ============================================================
-- procurement_v2_020_award_approval.sql  (Đợt 3 — Maker-checker AWARD)
--
-- CỔNG TÀI CHÍNH chống gian lận: khi BẬT, một award có TỔNG GIÁ TRỊ >= ngưỡng
-- KHÔNG chốt ngay mà "treo" (award_status='proposed') chờ NGƯỜI THỨ HAI duyệt
-- (SoD: checker ≠ proposer). Đây là BLOCKER BẮT BUỘC trước khi bật auto-AR/AP:
-- hiện 1 người + 1 dòng lý do là chốt thầu → công nợ tự sinh không ai duyệt.
--
-- ADDITIVE, IDEMPOTENT, TRANSACTIONAL. KHÔNG ALTER TYPE — award_status là CỘT
-- MỚI riêng TEXT+CHECK (KHÔNG đụng cột status, KHÔNG đụng notification_type enum).
-- DEFAULT enabled=false → batch cũ + solo owner KHÔNG đổi hành vi (finalize ngay).
--
-- Author: COOK BACKEND — Đợt 3 (2026-06-29)
-- DEPLOY: docker cp + psql -f; xoá __pycache__; restart sc-api + sc-worker + sc-scheduler
--   (lệ VPS: image chung, restart cả 3 kẻo scheduler chạy code cũ).
-- ============================================================

BEGIN;

-- ─── 1. procurement_rfq_batches — award-approval columns ───
ALTER TABLE procurement_rfq_batches
    ADD COLUMN IF NOT EXISTS award_status       TEXT NOT NULL DEFAULT 'none',
    ADD COLUMN IF NOT EXISTS award_proposed_by  UUID REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS award_proposed_at  TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS award_approved_by  UUID REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS award_approved_at  TIMESTAMPTZ;

COMMENT ON COLUMN procurement_rfq_batches.award_status IS
    'Đợt 3 maker-checker: none=chưa treo (finalize-ngay) | proposed=đề xuất chờ duyệt | approved=đã duyệt & finalize. DEFAULT none.';

-- award_status CHECK (none|proposed|approved) — guarded idempotent (mẫu _005).
-- 'approved' = đã duyệt & đã finalize (batch.status='awarded'); finalize-ngay giữ 'none'.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'prfq_batch_award_status_chk'
    ) THEN
        ALTER TABLE procurement_rfq_batches
            ADD CONSTRAINT prfq_batch_award_status_chk
            CHECK (award_status IN ('none','proposed','approved'));
    END IF;
END
$$;

-- ─── 2. app_config — seed 3 cờ award-approval (OFF / 50tr / OFF) ───
-- ON CONFLICT DO NOTHING: re-run KHÔNG ghi đè giá trị Thang đã đổi. Ship OFF.
-- threshold lưu dạng JSON number (50000000) → value::text = '50000000'.
INSERT INTO app_config (key, value)
VALUES
    ('procurement_award_approval_enabled',       'false'::jsonb),
    ('procurement_award_approval_threshold_vnd', '50000000'::jsonb),
    ('procurement_award_breakglass_enabled',     'false'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ─── 3. Index — list các batch đang treo chờ duyệt (partial, nhỏ gọn) ───
CREATE INDEX IF NOT EXISTS idx_prfq_batch_award_proposed
    ON procurement_rfq_batches(award_status)
    WHERE award_status = 'proposed';

COMMIT;

-- ─── VERIFICATION (chạy tay sau migrate) ───
-- SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--   WHERE conname = 'prfq_batch_award_status_chk';
-- SELECT key, value FROM app_config
--   WHERE key LIKE 'procurement_award_%' ORDER BY key;
