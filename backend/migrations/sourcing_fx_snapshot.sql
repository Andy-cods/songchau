-- ============================================================
-- sourcing_fx_snapshot.sql
--
-- Purpose (Batch 1A / item 1b.2): freeze the FX rate + the rate's
--          effective date onto each sourcing entry at save time so a
--          quote is AUDITABLE and IMMUTABLE — reopening an old quote
--          shows the ORIGINAL rate that was used at the quote's
--          time-point, never today's drifting rate.
--
--   fx_rate_snapshot — the VND-conversion rate that was applied to the
--                      entry's cost-currency when it was saved (NUMERIC,
--                      1 for a VND entry).
--   fx_rate_date     — the exchange_rates.rate_date that the snapshot
--                      rate came from (the rate's EFFECTIVE date, which
--                      may differ from the save date when using a
--                      historical rate by quote/inquiry date).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS. Safe to run multiple times.
-- Author: Thang — 2026-06-17
-- ============================================================

ALTER TABLE sourcing_entries
  ADD COLUMN IF NOT EXISTS fx_rate_snapshot NUMERIC,
  ADD COLUMN IF NOT EXISTS fx_rate_date     DATE;
