-- ============================================================
-- Migration: BQMS quote batch jobs (background queue)
-- Date: 2026-05-09
-- Plan: Option B — frontend select N rows → backend enqueues
--       Procrastinate tasks → worker calls /quote per row → UI polls.
--
-- Two tables:
--   bqms_quote_batches      → 1 row per "Báo X RFQ" click (the batch)
--   bqms_quote_batch_items  → 1 row per RFQ inside the batch
--
-- The worker updates *items* as it progresses. Aggregate counters on
-- the parent are recomputed each time an item terminates (via trigger
-- so frontend can poll only the parent if it wants).
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS bqms_quote_batches (
    id              SERIAL PRIMARY KEY,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by      UUID REFERENCES users(id),
    total_count     INTEGER NOT NULL DEFAULT 0,
    pending_count   INTEGER NOT NULL DEFAULT 0,
    running_count   INTEGER NOT NULL DEFAULT 0,
    done_count      INTEGER NOT NULL DEFAULT 0,
    error_count     INTEGER NOT NULL DEFAULT 0,
    status          TEXT NOT NULL DEFAULT 'running'
                    CHECK (status IN ('running','done','partial','error')),
    completed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_quote_batches_created_at
    ON bqms_quote_batches (created_at DESC);

CREATE TABLE IF NOT EXISTS bqms_quote_batch_items (
    id              SERIAL PRIMARY KEY,
    batch_id        INTEGER NOT NULL REFERENCES bqms_quote_batches(id) ON DELETE CASCADE,
    staging_id      INTEGER NOT NULL,
    rfq_number      TEXT,
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','running','done','error')),
    items_count     INTEGER,
    files_count     INTEGER,
    images_count    INTEGER,
    upserts_count   INTEGER,
    classification  TEXT,
    error_message   TEXT,
    procrastinate_job_id BIGINT,
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quote_batch_items_batch
    ON bqms_quote_batch_items (batch_id);
CREATE INDEX IF NOT EXISTS idx_quote_batch_items_status
    ON bqms_quote_batch_items (status);

COMMENT ON TABLE bqms_quote_batches IS
    'Một lượt nhấn "Báo nhiều RFQ" — gom N row staging vào batch';
COMMENT ON TABLE bqms_quote_batch_items IS
    'Từng RFQ trong batch — worker (sc-worker) cập nhật khi /quote chạy xong';

-- ------------------------------------------------------------
-- Trigger: tự re-aggregate counters trên parent batch khi item đổi status
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_recount_quote_batch() RETURNS trigger AS $$
DECLARE
    b_id INTEGER;
    p_cnt INTEGER;
    r_cnt INTEGER;
    d_cnt INTEGER;
    e_cnt INTEGER;
    t_cnt INTEGER;
    new_status TEXT;
BEGIN
    b_id := COALESCE(NEW.batch_id, OLD.batch_id);

    SELECT
        COUNT(*) FILTER (WHERE status='pending'),
        COUNT(*) FILTER (WHERE status='running'),
        COUNT(*) FILTER (WHERE status='done'),
        COUNT(*) FILTER (WHERE status='error'),
        COUNT(*)
    INTO p_cnt, r_cnt, d_cnt, e_cnt, t_cnt
    FROM bqms_quote_batch_items
    WHERE batch_id = b_id;

    IF p_cnt = 0 AND r_cnt = 0 THEN
        IF e_cnt = 0 THEN
            new_status := 'done';
        ELSIF d_cnt = 0 THEN
            new_status := 'error';
        ELSE
            new_status := 'partial';
        END IF;
    ELSE
        new_status := 'running';
    END IF;

    UPDATE bqms_quote_batches SET
        pending_count = p_cnt,
        running_count = r_cnt,
        done_count = d_cnt,
        error_count = e_cnt,
        total_count = t_cnt,
        status = new_status,
        completed_at = CASE WHEN new_status IN ('done','error','partial')
                            AND completed_at IS NULL THEN NOW()
                            ELSE completed_at END
    WHERE id = b_id;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_recount_quote_batch ON bqms_quote_batch_items;
CREATE TRIGGER trg_recount_quote_batch
    AFTER INSERT OR UPDATE OF status OR DELETE
    ON bqms_quote_batch_items
    FOR EACH ROW
    EXECUTE FUNCTION fn_recount_quote_batch();

COMMIT;
