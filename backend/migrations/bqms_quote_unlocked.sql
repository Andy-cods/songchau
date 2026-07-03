-- Phase H (Thang 2026-05-13): tách scrape khỏi Báo giá button.
-- New design:
--   - Scrape (30min/5min/3min cron) = LUÔN drill chi tiết + download files + extract
--     images + upsert bqms_rfq. Rows xuất hiện ngay trong table, nhưng V1-V4 BỊ KHÓA.
--   - Click "Báo giá" = chỉ flip quote_unlocked=true + assign user + mark staging approved.
--     KHÔNG trigger scrape on-demand nữa (nguồn gốc nhiều bug).
--
-- quote_unlocked controls visibility of L1/L2/L3/L4 buttons in frontend:
--   false (default after scrape) → buttons hiển thị "🔒 Khoá", không click được
--   true (after click Báo giá)   → buttons hiển thị "+ L1" / "↻ L2" etc, click được

ALTER TABLE bqms_rfq
    ADD COLUMN IF NOT EXISTS quote_unlocked BOOLEAN NOT NULL DEFAULT false;

-- Speed up queries for "rows ready to quote" (won/lost dashboards, etc)
CREATE INDEX IF NOT EXISTS idx_bqms_rfq_quote_unlocked
    ON bqms_rfq(quote_unlocked) WHERE quote_unlocked = true;

COMMENT ON COLUMN bqms_rfq.quote_unlocked IS
    'Phase H: V1-V4 buttons khóa cho tới khi user click "Báo giá" (set =true). '
    'Scrape KHÔNG set field này — chỉ user action mở khóa.';

-- Backfill: hàng nào đã có quoted_price_bqms_v1 thì đương nhiên unlocked
UPDATE bqms_rfq SET quote_unlocked = true
WHERE quote_unlocked = false
  AND quoted_price_bqms_v1 IS NOT NULL;
