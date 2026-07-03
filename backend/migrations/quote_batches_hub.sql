-- ============================================================
-- Quote Hub (D4-6) — augment quote_batches for the Hồ sơ tab
-- Thang 2026-06-22
-- Idempotent: safe to re-run.
-- ============================================================

ALTER TABLE quote_batches
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','sent','accepted','rejected','expired')),
  ADD COLUMN IF NOT EXISTS doc_category TEXT NOT NULL DEFAULT 'bao_gia',
  ADD COLUMN IF NOT EXISTS valid_until DATE,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- idx_qb_customer (customer_id) already exists from migrations/quote_batches.sql.
