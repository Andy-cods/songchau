-- ============================================================
-- exchange_rates_basic.sql
--
-- Purpose: Ensure the `exchange_rates` table exists with the
--          minimum schema needed by the currency selector
--          (frontend fetches live VND-conversion rates from
--          `GET /api/v1/exchange-rates`).
--
-- Context: The Phase 2 Revenue Chain migration
--          (`phase2_revenue_chain.sql`) already creates a
--          time-series `exchange_rates` table keyed by
--          (rate_date, from_currency, to_currency). This
--          migration is idempotent and ONLY:
--            1. Creates the table if it somehow does not exist
--               (uses the existing rich schema so we stay
--               compatible with `/latest`, `/history`, /bulk).
--            2. Seeds today's row for every supported currency
--               the selector exposes — VND, JPY, USD, KRW,
--               RMB (alias for CNY), CNY, EUR — at the
--               default rates requested by the spec.
--
-- Safe to run multiple times: ON CONFLICT DO NOTHING.
-- Author: Thang — 2026-06-13
-- ============================================================

CREATE TABLE IF NOT EXISTS exchange_rates (
    id              BIGSERIAL PRIMARY KEY,
    rate_date       DATE NOT NULL,
    from_currency   TEXT NOT NULL,
    to_currency     TEXT NOT NULL DEFAULT 'VND',
    rate            NUMERIC(14,6) NOT NULL CHECK (rate > 0),
    source          TEXT NOT NULL DEFAULT 'manual',
    created_by      UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (rate_date, from_currency, to_currency)
);

CREATE INDEX IF NOT EXISTS idx_er_date ON exchange_rates(rate_date DESC);
CREATE INDEX IF NOT EXISTS idx_er_pair ON exchange_rates(from_currency, to_currency, rate_date DESC);

-- Seed defaults for the currency selector. VND→VND = 1.
-- RMB is the human-readable alias for CNY; we seed it as
-- a separate row so the selector can display "RMB" verbatim.
INSERT INTO exchange_rates (rate_date, from_currency, to_currency, rate, source) VALUES
    (CURRENT_DATE, 'VND', 'VND', 1,        'manual'),
    (CURRENT_DATE, 'JPY', 'VND', 180,      'manual'),
    (CURRENT_DATE, 'USD', 'VND', 24500,    'manual'),
    (CURRENT_DATE, 'KRW', 'VND', 18,       'manual'),
    (CURRENT_DATE, 'RMB', 'VND', 3400,     'manual'),
    (CURRENT_DATE, 'CNY', 'VND', 3400,     'manual'),
    (CURRENT_DATE, 'EUR', 'VND', 26500,    'manual')
ON CONFLICT (rate_date, from_currency, to_currency) DO NOTHING;
