-- Persist FedEx (quốc tế) + VN nội-địa shipping fees directly ON the sourcing
-- entry (Thang 2026-07-02).
--
-- WHY the reversal of the earlier "single column / history-only" decision:
--   A1 stored vn_shipping_fee_vnd only in sourcing_vn_shipping_history (append-
--   only) and never on sourcing_entries. That was fine while the fee lived
--   solely inside quote_snapshot, but the pricing form now needs to REOPEN with
--   the exact fedex/vn-ship values a user typed WITHOUT depending on the JSONB
--   snapshot being present (older entries, or snapshot rebuilt). Reading a real
--   column is cheaper + more reliable than digging through quote_snapshot, and
--   FedEx (international) had no home at all. So we add two dedicated columns and
--   read them FIRST on reopen (snapshot stays the fallback).
--
-- Additive + idempotent; NO backfill (existing rows keep NULL and fall back to
-- their quote_snapshot values on reopen).
ALTER TABLE sourcing_entries
    ADD COLUMN IF NOT EXISTS fedex_fee_vnd NUMERIC(18,0);
ALTER TABLE sourcing_entries
    ADD COLUMN IF NOT EXISTS vn_shipping_fee_vnd NUMERIC(18,0);

COMMENT ON COLUMN sourcing_entries.fedex_fee_vnd IS
    'Phí vận chuyển quốc tế (FedEx) VND — dùng để tính giá + khôi phục form khi mở lại. Đảo quyết định cũ "chỉ history" vì cần reopen không phụ thuộc quote_snapshot.';
COMMENT ON COLUMN sourcing_entries.vn_shipping_fee_vnd IS
    'Phí vận chuyển nội địa VN (VND) — cột nguồn để reopen; sourcing_vn_shipping_history vẫn được append để giữ lịch sử thay đổi.';
