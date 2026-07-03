-- Batch #1 (Thang 2026-06-27): FROZEN quote snapshot for Sourcing pricing.
--
-- Root cause of V1 ("giá loạn") + V2 ("không biết lấy giá nào"): the form builds
-- a rich price (cost × FX + Fedex + VN-ship + import-tax + VAT + buy-fee + swift
-- + profit, with user toggles is_domestic / pct-overrides) but NONE of those
-- input toggles were persisted. On reopen the breakdown reset; on export the
-- modal recomputed a SIMPLER price → the number the user saw never matched.
--
-- Fix: when the user clicks "Áp dụng giá báo", freeze the WHOLE pricing context
-- into one JSONB column. Reopening restores it verbatim (same breakdown); the
-- quote modal defaults to the frozen unit price so what you see == what exports.
--
-- Single column by design (critique 2026-06-27): do NOT also add parallel
-- fedex_fee_vnd / vn_shipping_fee_vnd / is_domestic_vn / pct_overrides columns —
-- that would duplicate the same data in two places (DRY violation). Everything
-- lives inside quote_snapshot; add real columns only if/when a query needs them.
--
-- Idempotent. Additive. No backfill of existing rows (they keep exporting via
-- their stored sale_vnd / live recompute, unchanged).

ALTER TABLE sourcing_entries
    ADD COLUMN IF NOT EXISTS quote_snapshot JSONB;

COMMENT ON COLUMN sourcing_entries.quote_snapshot IS
    'Frozen pricing context captured at "Áp dụng giá báo" (Batch #1, 2026-06-27). '
    'Shape: {unit_price_vnd, qty, source:auto|manual, supplier_price_id, fx_rate, '
    'fx_date, is_domestic, fedex_fee_vnd, vn_shipping_fee_vnd, pct_overrides:'
    '{importTax,vat,purchase,profit}, breakdown:{I,K,L,M,N,O,P,Q,R,S,T}, '
    'params, computed_at}. Reopening an entry restores the form inputs from this; '
    'the quote modal defaults its per-line price to unit_price_vnd.';
