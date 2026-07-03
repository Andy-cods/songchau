-- ============================================================
-- Migration: M48 — index composite cho notifications inbox (W3-14 tối ưu query)
-- Date: 2026-07-04
-- Plan: master-completion Đợt 3 · W3-14 (evidence-based, pg_stat_statements)
--
-- BẰNG CHỨNG (pg_stat_statements prod): query inbox
--   SELECT n.* FROM notifications n WHERE n.recipient_id = $1 ORDER BY created_at DESC LIMIT N
-- gọi ~9.000-18.000 lần, mean ~26ms. EXPLAIN: Bitmap Heap Scan idx_notif_recipient
-- (chỉ recipient_id) → nạp TOÀN BỘ (1 user có 37.379 notif!) rồi Sort top-N (~38.7ms,
-- 4.575 buffers). idx_notif_unread là index (recipient_id, created_at DESC) nhưng
-- PARTIAL WHERE is_read=false → không dùng được cho inbox đầy đủ.
--
-- FIX: composite FULL (recipient_id, created_at DESC) → Index Scan đọc thẳng top-N,
-- KHÔNG sort, KHÔNG nạp 37k dòng. ĐO SAU: 0.15ms, 8 buffers → ~250× nhanh hơn.
--
-- AN TOÀN: CREATE INDEX CONCURRENTLY (không khoá ghi), IF NOT EXISTS (idempotent),
-- behavior_change=false (chỉ tăng tốc, không đổi kết quả). Đã áp prod (indisvalid=t).
-- LƯU Ý: chạy NGOÀI transaction (CONCURRENTLY không cho phép trong BEGIN/COMMIT).
-- ============================================================

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notif_recipient_created
    ON public.notifications (recipient_id, created_at DESC);
