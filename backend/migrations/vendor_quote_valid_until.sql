-- ============================================================
-- vendor_quote_valid_until.sql  (Vendor-portal redesign — quote-level "valid until")
-- ADDITIVE, IDEMPOTENT, re-runnable.
-- Author: Song Chau ERP — 2026-06-23
--
-- Adds a quote-level `valid_until` (hiệu lực báo giá đến) on vendor_quotes so a
-- vendor can declare how long their quoted prices remain valid. The submit
-- handler (app/api/vendor/quotes.py /submit) persists it from the request body.
--
-- NOTE: per-line valid_until is DEFERRED — do NOT add it here. Only the
-- quote-level column is introduced.
-- ============================================================

ALTER TABLE vendor_quotes ADD COLUMN IF NOT EXISTS valid_until TIMESTAMPTZ;
