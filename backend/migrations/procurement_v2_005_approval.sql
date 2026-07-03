-- ============================================================
-- procurement_v2_005_approval.sql  (P1 — Commercial bidding: approval flow)
-- ADDITIVE, IDEMPOTENT, re-runnable via: docker cp ... && psql -f.
-- NO enum TYPE creation — batch status stays TEXT + CHECK (like Đợt 1/2).
-- Author: Thang — 2026-06-22
-- DEPLOY: docker cp + psql -f; restart sc-api + sc-worker + sc-scheduler.
--
-- PRE-EXISTING FACTS (verified by reading migrations):
--   * procurement_rfq_batches.status CHECK is currently
--     procurement_rfq_batches_status_check2 (from procurement_v2_002_award.sql)
--     allowing ('draft','published','evaluating','awarded','closed','cancelled').
--     We DISCOVER it from the catalog before dropping (never hardcode old name).
--   * app_config(key TEXT PK, value JSONB) — runtime flag store.
--   * users.id = UUID; procurement tables = BIGINT/BIGSERIAL.
-- ============================================================

BEGIN;

-- ─── 1. procurement_rfq_batches — approval workflow columns ───
ALTER TABLE procurement_rfq_batches
    ADD COLUMN IF NOT EXISTS submitted_by              UUID REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS submitted_at              TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS approved_by               UUID REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS approved_at               TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS approval_auto             BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS approval_rejected_by      UUID REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS approval_rejected_at      TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS approval_rejection_reason TEXT,
    ADD COLUMN IF NOT EXISTS phu_trach                 TEXT,
    ADD COLUMN IF NOT EXISTS visibility                TEXT DEFAULT 'invited';

-- visibility CHECK (invited|open) — guarded so re-run is a no-op.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'prfq_batch_visibility_chk'
    ) THEN
        ALTER TABLE procurement_rfq_batches
            ADD CONSTRAINT prfq_batch_visibility_chk
            CHECK (visibility IN ('invited','open'));
    END IF;
END
$$;

-- ─── 2. Widen batch status CHECK → *_check3 ───
-- Discover the current status CHECK (procurement_rfq_batches_status_check2 today,
-- but DO NOT assume), drop it, re-add as *_check3 with the approval lifecycle set.
-- New states: cho_duyet (chờ duyệt) + approved + rejected_internal alongside the
-- existing draft/published/evaluating/awarded/closed/cancelled.
DO $$
DECLARE
    con_name TEXT;
BEGIN
    -- Loop over EVERY status-bearing CHECK (not just one) so a future second
    -- status CHECK can't be silently left behind, then re-add the widened set.
    FOR con_name IN
        SELECT conname
          FROM pg_constraint
         WHERE conrelid = 'procurement_rfq_batches'::regclass
           AND contype = 'c'
           AND pg_get_constraintdef(oid) LIKE '%status%'
    LOOP
        EXECUTE format('ALTER TABLE procurement_rfq_batches DROP CONSTRAINT %I', con_name);
    END LOOP;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'procurement_rfq_batches_status_check3'
    ) THEN
        ALTER TABLE procurement_rfq_batches
            ADD CONSTRAINT procurement_rfq_batches_status_check3
            CHECK (status IN (
                'draft','cho_duyet','approved','rejected_internal',
                'published','evaluating','awarded','closed','cancelled'
            ));
    END IF;
END
$$;

-- ─── 3. app_config — seed approval flags (OFF / 24h) ───
-- value is JSONB. ON CONFLICT DO NOTHING so a re-run never flips a flag Thang
-- already changed. Approval gate ships OFF (auto-approve) by default.
INSERT INTO app_config (key, value)
VALUES
    ('procurement_approval_required',        'false'::jsonb),
    ('procurement_deadline_reminder_hours',  '24'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ─── 4. Backfill approval_auto (AFTER the CHECK3 is in place) ───
-- Any batch already past internal gate (published/evaluating/awarded/closed)
-- is treated as auto-approved so legacy rows don't look "pending".
UPDATE procurement_rfq_batches
   SET approval_auto = true
 WHERE status IN ('published','evaluating','awarded','closed')
   AND approval_auto IS DISTINCT FROM true;

-- ─── 5. Indexes (all IF NOT EXISTS) ───
CREATE INDEX IF NOT EXISTS idx_prfq_batch_approval_pending
    ON procurement_rfq_batches(status)
    WHERE status IN ('cho_duyet','approved');
CREATE INDEX IF NOT EXISTS idx_prfq_batch_visibility
    ON procurement_rfq_batches(visibility);

COMMIT;

-- ─── VERIFICATION ───
SELECT 'status_constraint' AS check, conname, pg_get_constraintdef(oid) AS def
  FROM pg_constraint
 WHERE conrelid = 'procurement_rfq_batches'::regclass
   AND contype = 'c'
   AND pg_get_constraintdef(oid) LIKE '%status%';
SELECT 'approval_auto_true' AS check, count(*) AS n
  FROM procurement_rfq_batches WHERE approval_auto = true;
SELECT 'seeded_flags' AS check, key, value
  FROM app_config
 WHERE key IN ('procurement_approval_required','procurement_deadline_reminder_hours')
 ORDER BY key;
