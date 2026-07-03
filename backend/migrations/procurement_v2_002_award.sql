-- ============================================================
-- procurement_v2_002_award.sql  (Đợt 2 — Award + Audit + Multi-round)
-- ADDITIVE, IDEMPOTENT, re-runnable via: docker cp ... && psql -f.
-- NO enum TYPE creation — status columns stay TEXT + CHECK (like Đợt 1).
-- Author: Thang — 2026-06-18
-- DEPLOY: docker cp + psql -f; restart sc-api + sc-worker + sc-scheduler.
--
-- PRE-EXISTING FACTS (verified):
--   * procurement_rfq_batches.current_round INT NOT NULL DEFAULT 1 ALREADY
--     EXISTS (vendor_bidding_magic_link.sql); deadline_v1/v2/v3 too.
--     ADD COLUMN IF NOT EXISTS current_round is a guaranteed no-op — KEPT
--     only for re-run safety; we do NOT touch its type/default.
--   * users.id = UUID; procurement tables = BIGINT/BIGSERIAL.
--   * vendor_quotes.round_number INT DEFAULT 1 + uq_vq_batch_vendor_round.
--     vendor_quotes.vendor_id is NULLABLE (legacy magic-link era).
--   * procurement_rfq_items already has awarded_vendor_id BIGINT,
--     awarded_price NUMERIC, awarded_currency TEXT.
--   * batch status CHECK currently = ('draft','published','closed',
--     'awarded','cancelled'), inline-named procurement_rfq_batches_status_check
--     (discovered from catalog below before dropping).
-- ============================================================

-- ─── 0. Drop the leftover NON-round-aware vendor_quotes unique index (BUG-1) ───
-- Đợt 1 replaced the (batch_id,vendor_id) CONSTRAINT with the round-aware
-- uq_vq_batch_vendor_round, but a SEPARATE index uq_vendor_quotes_batch_vendor
-- (batch_id,vendor_id WHERE vendor_id IS NOT NULL) still exists on prod and would
-- throw UniqueViolation on a 2nd-round quote → breaks multi-round. Drop it.
DROP INDEX IF EXISTS uq_vendor_quotes_batch_vendor;

-- ─── 1. procurement_awards — one ACTIVE winner per (batch,item) or per-batch ───
CREATE TABLE IF NOT EXISTS procurement_awards (
    id              BIGSERIAL PRIMARY KEY,
    batch_id        BIGINT NOT NULL REFERENCES procurement_rfq_batches(id) ON DELETE CASCADE,
    item_id         BIGINT REFERENCES procurement_rfq_items(id) ON DELETE CASCADE,  -- NULL = per-batch award
    vendor_id       BIGINT NOT NULL REFERENCES vendor_accounts(id),
    quote_id        BIGINT REFERENCES vendor_quotes(id),
    quote_item_id   BIGINT REFERENCES vendor_quote_items(id),                       -- NULL for per-batch
    awarded_price   NUMERIC,
    currency        TEXT NOT NULL DEFAULT 'VND',
    quantity        NUMERIC,
    award_reason    TEXT,
    awarded_by      UUID REFERENCES users(id),
    awarded_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    superseded_by   BIGINT REFERENCES procurement_awards(id),                       -- self-FK, re-award chain
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Partial unique indexes — ACTIVE = superseded_by IS NULL only.
-- We key on (batch_id,item_id) NOT (batch_id,item_id,vendor_id) because per_item
-- allows exactly ONE vendor per item. These indexes are NON-DEFERRABLE (checked
-- per-statement), so the award handler clears the prior active row OUT of the
-- partial index (sets superseded_by = its own id, FK-safe) BEFORE inserting the
-- new active row, then repoints the prior row's superseded_by at the new id.
-- That keeps at most one active row per (batch,item) at every statement boundary
-- and never blocks a legit re-award to a different vendor.
CREATE UNIQUE INDEX IF NOT EXISTS uq_pa_batch_item_active
    ON procurement_awards(batch_id, item_id)
    WHERE item_id IS NOT NULL AND superseded_by IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_pa_batch_perbatch_active
    ON procurement_awards(batch_id)
    WHERE item_id IS NULL AND superseded_by IS NULL;

CREATE INDEX IF NOT EXISTS idx_pa_batch  ON procurement_awards(batch_id);
CREATE INDEX IF NOT EXISTS idx_pa_vendor ON procurement_awards(vendor_id);
CREATE INDEX IF NOT EXISTS idx_pa_quote  ON procurement_awards(quote_id);

-- ─── 2. procurement_audit_log — append-only event timeline ───
CREATE TABLE IF NOT EXISTS procurement_audit_log (
    id              BIGSERIAL PRIMARY KEY,
    entity_type     TEXT NOT NULL,   -- batch|invitation|quote|award|contract|po|delivery
    entity_id       BIGINT NOT NULL,
    action          TEXT NOT NULL,   -- publish|invite|open_round|award|re_award|decline|quote_submit|status_change
    from_status     TEXT,
    to_status       TEXT,
    actor_id        UUID REFERENCES users(id),
    actor_vendor_id BIGINT REFERENCES vendor_accounts(id),
    detail          JSONB NOT NULL DEFAULT '{}'::jsonb,
    ip              INET,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pal_entity
    ON procurement_audit_log(entity_type, entity_id, created_at DESC);

-- ─── 3. procurement_rfq_batches — round + lifecycle timestamps ───
ALTER TABLE procurement_rfq_batches
    ADD COLUMN IF NOT EXISTS current_round  INT DEFAULT 1,   -- no-op (already exists)
    ADD COLUMN IF NOT EXISTS max_rounds     INT DEFAULT 1,
    ADD COLUMN IF NOT EXISTS evaluating_at  TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS awarded_at     TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS criteria       TEXT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'prfq_batch_max_rounds_chk'
    ) THEN
        ALTER TABLE procurement_rfq_batches
            ADD CONSTRAINT prfq_batch_max_rounds_chk
            CHECK (max_rounds BETWEEN 1 AND 3);
    END IF;
END
$$;

-- Backfill: keep max_rounds >= current_round; mirror awarded_at from closed_at.
UPDATE procurement_rfq_batches
   SET max_rounds = GREATEST(COALESCE(max_rounds, 1), COALESCE(current_round, 1))
 WHERE max_rounds IS NULL OR max_rounds < COALESCE(current_round, 1);
UPDATE procurement_rfq_batches
   SET awarded_at = closed_at
 WHERE status = 'awarded' AND awarded_at IS NULL;

-- ─── 4. procurement_rfq_items — round + quote-item linkage (loose BIGINT) ───
ALTER TABLE procurement_rfq_items
    ADD COLUMN IF NOT EXISTS awarded_round         INT,
    ADD COLUMN IF NOT EXISTS awarded_quote_item_id BIGINT;  -- loose, no FK (matches existing loose awarded_* cols)

-- ─── 5. Extend batch status CHECK to allow 'evaluating' (keep 'closed') ───
DO $$
DECLARE
    con_name TEXT;
BEGIN
    SELECT conname INTO con_name
      FROM pg_constraint
     WHERE conrelid = 'procurement_rfq_batches'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) LIKE '%status%';

    IF con_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE procurement_rfq_batches DROP CONSTRAINT %I', con_name);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'procurement_rfq_batches_status_check2'
    ) THEN
        ALTER TABLE procurement_rfq_batches
            ADD CONSTRAINT procurement_rfq_batches_status_check2
            CHECK (status IN ('draft','published','evaluating','awarded','closed','cancelled'));
    END IF;
END
$$;

-- ─── 6. v_latest_vendor_quote — latest round per (batch,vendor), award-aware ───
-- Includes 'awarded' so the winner still resolves after award flips the quote
-- status (re-award reads it back). vendor_id IS NOT NULL filters legacy
-- magic-link rows. CREATE OR REPLACE = idempotent.
CREATE OR REPLACE VIEW v_latest_vendor_quote AS
SELECT DISTINCT ON (vq.batch_id, vq.vendor_id)
       vq.id            AS quote_id,
       vq.batch_id,
       vq.vendor_id,
       vq.round_number,
       vq.currency,
       vq.total_amount,
       vq.lead_time_days,
       vq.status,
       vq.submitted_at
  FROM vendor_quotes vq
 WHERE vq.vendor_id IS NOT NULL
   AND vq.status IN ('submitted', 'awarded')
 ORDER BY vq.batch_id, vq.vendor_id,
          vq.round_number DESC NULLS LAST,
          vq.submitted_at DESC NULLS LAST,
          vq.id DESC;

-- POSTCHECK (run manually):
--   SELECT count(*) FROM procurement_awards;
--   SELECT count(*) FROM procurement_audit_log;
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conrelid='procurement_rfq_batches'::regclass AND contype='c';
--   SELECT * FROM v_latest_vendor_quote LIMIT 5;
