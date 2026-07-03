-- =============================================================================
-- BQMS V-round tracking + D-N deadline state machine  (Batch 2C / plan 2B)
-- Thang 2026-06-17 — Plan: mission-ho-n-thi-n-n-t-unified-pizza.md "Batch 2B".
--
-- PURPOSE
--   Persist Samsung submission deadline + ERP quote round + a materialized
--   QT lifecycle state on bqms_rfq, plus two append-only ledgers
--   (bqms_scrape_presence, bqms_qt_events) that make re-invite detection
--   deterministic and give us a "Lịch sử báo giá V1→V2→V3" timeline.
--
-- SAFETY CONTRACT (read before running)
--   * IDEMPOTENT — safe to run N times. ENUM creation guarded by a DO/EXCEPTION
--     block; every column add uses ADD COLUMN IF NOT EXISTS; every table/index
--     uses IF NOT EXISTS.
--   * ADDITIVE ONLY — no DROP, no DELETE, no destructive ALTER, no rename.
--   * Does NOT add the unique constraint on bqms_rfq(rfq_number,bqms_code) and
--     does NOT collapse the shadow-twin duplicates. Those are DESTRUCTIVE and
--     live (commented out) in bqms_rfq_dedup_collapse.sql for OWNER review.
--   * `version` column ALREADY exists on bqms_rfq and is bumped by the bidding
--     scraper to track the Samsung-side round. We TREAT version AS samsung_round
--     and DO NOT add a duplicate column. `current_round` below is the *ERP*
--     round we have quoted (distinct concept), persisted by the state engine.
--
-- DEPENDENCIES
--   bqms_rfq must already exist (init_v3.sql). The `rfq_result` enum currently
--   has values: pending, won, lost, cancelled, closed.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. ENUM bqms_qt_state — materialized QT lifecycle state.
--    Guarded so re-running does not raise "type already exists".
-- ---------------------------------------------------------------------------
DO $$
BEGIN
    CREATE TYPE bqms_qt_state AS ENUM (
        'NEW',             -- Mã mới, chưa báo V1 trong ERP
        'V1_QUOTED',       -- Đã báo giá (Vn) trong ERP nhưng chưa đẩy lên SEC
        'AWAITING_RESULT', -- Đã đẩy lên SEC, đang đếm ngược D-N chờ kết quả
        'WON_INVITED',     -- Trúng → Samsung mời vòng tiếp theo (re-invite)
        'LOST_EXPIRED',    -- Quá hạn (grace=0: ngày SAU deadline), không tái mời → trượt/đóng
        'CLOSED',          -- Đóng thủ công / Samsung remove khỏi active list
        'CANCELLED'        -- Hủy
    );
EXCEPTION
    WHEN duplicate_object THEN NULL;  -- already created on a prior run
END$$;

-- ---------------------------------------------------------------------------
-- 2. bqms_rfq new columns — all ADDITIVE.
--    deadline_dt/raw       : parsed + raw Samsung submission deadline.
--    current_round         : ERP round we have quoted/pushed (1..4). Distinct
--                            from `version` (= Samsung-side round / samsung_round).
--    qt_state              : materialized lifecycle state (source of truth =
--                            bqms_qt_events log; this column is the cache).
--    state_changed_at      : when qt_state last transitioned.
--    last_seen_scrape_at   : last time this RFQ row was seen active in a scrape.
--    reinvited_at          : when we detected a Samsung re-invite (round bump).
-- ---------------------------------------------------------------------------
ALTER TABLE bqms_rfq
    ADD COLUMN IF NOT EXISTS deadline_dt          TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS deadline_raw         TEXT,
    ADD COLUMN IF NOT EXISTS current_round        SMALLINT,
    ADD COLUMN IF NOT EXISTS qt_state             bqms_qt_state DEFAULT 'NEW',
    ADD COLUMN IF NOT EXISTS state_changed_at     TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_seen_scrape_at  TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS reinvited_at         TIMESTAMPTZ;

COMMENT ON COLUMN bqms_rfq.deadline_dt IS
    'Parsed Samsung submission deadline (UTC-aware). Set on UPSERT via parse_deadline().';
COMMENT ON COLUMN bqms_rfq.deadline_raw IS
    'Raw Samsung deadline string (e.g. "(GMT+07:00) 5/19/2026 23:30") for audit.';
COMMENT ON COLUMN bqms_rfq.current_round IS
    'ERP-side round we have quoted/pushed (1..4). NOT the Samsung round — that is bqms_rfq.version.';
COMMENT ON COLUMN bqms_rfq.qt_state IS
    'Materialized QT lifecycle state. Source of truth = bqms_qt_events; this column is a cache.';
COMMENT ON COLUMN bqms_rfq.state_changed_at IS 'Timestamp of last qt_state transition.';
COMMENT ON COLUMN bqms_rfq.last_seen_scrape_at IS
    'Last time this RFQ was seen active in a bidding scrape (drives stale detection).';
COMMENT ON COLUMN bqms_rfq.reinvited_at IS
    'When a Samsung re-invite (round bump after AWAITING_RESULT) was detected.';

-- ---------------------------------------------------------------------------
-- 3. bqms_scrape_presence — append-only, one row per (scrape_run, rfq, code).
--    Lets the state engine detect "was VẮNG mặt rồi xuất hiện lại" (deterministic
--    re-invite) across time without relying on fragile string matching.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bqms_scrape_presence (
    id             BIGSERIAL PRIMARY KEY,
    scrape_run_id  TEXT,                              -- uuid/run tag of the scrape
    rfq_number     TEXT NOT NULL,
    bqms_code      TEXT,                              -- NULL when row-level only
    is_active      BOOLEAN NOT NULL DEFAULT TRUE,     -- seen active in bidding list
    samsung_round  INT,                               -- = bqms_rfq.version at scrape time
    deadline_dt    TIMESTAMPTZ,                       -- parsed deadline at scrape time
    raw_status     TEXT,                              -- progressStatusName / submitGb
    seen_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Hot path: "latest presence for this RFQ" + "did it reappear after absence".
CREATE INDEX IF NOT EXISTS idx_bqms_scrape_presence_rfq_seen
    ON bqms_scrape_presence (rfq_number, seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_bqms_scrape_presence_run
    ON bqms_scrape_presence (scrape_run_id);

COMMENT ON TABLE bqms_scrape_presence IS
    'Append-only presence ledger — 1 row per (scrape_run, rfq, code). Drives deterministic re-invite detection.';

-- ---------------------------------------------------------------------------
-- 4. bqms_qt_events — append-only event log (source of truth for the timeline).
--    State on bqms_rfq is materialized; this log is authoritative.
--    event_type vocabulary:
--      qt.scraped, qt.quoted, qt.push_confirmed, qt.reinvited,
--      qt.deadline_passed, qt.closed, qt.stale, qt.state_changed
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bqms_qt_events (
    id           BIGSERIAL PRIMARY KEY,
    rfq_number   TEXT NOT NULL,
    bqms_code    TEXT,
    event_type   TEXT NOT NULL,
    from_state   bqms_qt_state,
    to_state     bqms_qt_state,
    round_no     INT,
    deadline_dt  TIMESTAMPTZ,
    actor        TEXT,                                -- 'scraper' | 'state_engine' | user id | system
    evidence     JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bqms_qt_events_rfq_created
    ON bqms_qt_events (rfq_number, created_at);

COMMENT ON TABLE bqms_qt_events IS
    'Append-only QT lifecycle event log. Timeline "V1→V2→V3" + state transitions queried from here.';

-- ---------------------------------------------------------------------------
-- 5. bqms_rfq supporting indexes for the state engine + countdown queries.
-- ---------------------------------------------------------------------------
-- Expire pass scans AWAITING_RESULT rows by deadline.
CREATE INDEX IF NOT EXISTS idx_bqms_rfq_deadline_awaiting
    ON bqms_rfq (deadline_dt)
    WHERE qt_state = 'AWAITING_RESULT';
-- Filter / group by lifecycle state.
CREATE INDEX IF NOT EXISTS idx_bqms_rfq_qt_state
    ON bqms_rfq (qt_state);
-- Stale detection ("not seen in N scrapes").
CREATE INDEX IF NOT EXISTS idx_bqms_rfq_last_seen_scrape
    ON bqms_rfq (last_seen_scrape_at);

COMMIT;

-- =============================================================================
-- BACKFILL (run AFTER the additive section above; idempotent — only fills NULLs).
--
-- Derives deadline_dt / current_round / qt_state from existing columns:
--   version, quoted_price_bqms_v1..v4, result, bqms_pushed_at, bqms_pushed_round,
--   quote_unlocked. Deadline string lives in staging.raw_json -> deadlineDt; we
--   pull the latest staging row per rfq_number and parse it the SAME way the
--   Python parse_deadline() does (GMT+7 → UTC).
--
-- Wrapped in its own transaction so it can be re-run independently. SAFE-ADDITIVE:
-- only writes columns that are currently NULL (won't clobber engine-set values).
-- =============================================================================

BEGIN;

-- 5a. deadline_dt / deadline_raw from latest staging deadlineDt (best-effort).
--     Mirrors parse_deadline(): pattern M/D/YYYY[ HH:MM], interpret as GMT+7,
--     convert to UTC. Done in SQL with a regexp + make_timestamptz.
WITH latest_staging AS (
    SELECT DISTINCT ON (s.rfq_number)
           s.rfq_number,
           NULLIF(TRIM(s.raw_json ->> 'deadlineDt'), '') AS deadline_raw
      FROM bqms_vendor_portal_staging s
     WHERE s.module = 'bidding'
     ORDER BY s.rfq_number, s.id DESC
),
parsed AS (
    SELECT ls.rfq_number,
           ls.deadline_raw,
           (regexp_match(ls.deadline_raw, '(\d{1,2})/(\d{1,2})/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?')) AS m
      FROM latest_staging ls
     WHERE ls.deadline_raw IS NOT NULL
)
UPDATE bqms_rfq r
   SET deadline_raw = p.deadline_raw,
       deadline_dt  = CASE
                          WHEN p.m IS NOT NULL THEN
                              -- Build a naive timestamp from the parsed parts,
                              -- interpret it as Samsung wall-clock (GMT+7, no
                              -- DST) → returns a UTC-correct timestamptz. This
                              -- matches the Python parse_deadline() semantics.
                              (make_timestamp(
                                  (p.m[3])::int,               -- year
                                  (p.m[1])::int,               -- month
                                  (p.m[2])::int,               -- day
                                  COALESCE((p.m[4])::int, 0),  -- hour
                                  COALESCE((p.m[5])::int, 0),  -- minute
                                  0
                              ) AT TIME ZONE 'Asia/Ho_Chi_Minh')
                          ELSE NULL
                      END
  FROM parsed p
 WHERE p.rfq_number = r.rfq_number
   AND r.deadline_dt IS NULL;   -- only fill if not already set

-- 5b. current_round (ERP round) backfill.
--     Prefer the explicitly-pushed round; else the highest filled V column.
UPDATE bqms_rfq r
   SET current_round = COALESCE(
           r.bqms_pushed_round,
           CASE
               WHEN r.quoted_price_bqms_v4 IS NOT NULL THEN 4
               WHEN r.quoted_price_bqms_v3 IS NOT NULL THEN 3
               WHEN r.quoted_price_bqms_v2 IS NOT NULL THEN 2
               WHEN r.quoted_price_bqms_v1 IS NOT NULL THEN 1
               ELSE NULL
           END
       )
 WHERE r.current_round IS NULL
   AND (r.bqms_pushed_round IS NOT NULL
        OR r.quoted_price_bqms_v1 IS NOT NULL
        OR r.quoted_price_bqms_v2 IS NOT NULL
        OR r.quoted_price_bqms_v3 IS NOT NULL
        OR r.quoted_price_bqms_v4 IS NOT NULL);

-- 5c. qt_state backfill — derive from result + push/quote state.
--     Mapping (only applied where qt_state is still the default 'NEW' AND we
--     can confidently upgrade it):
--        result='won'                                   -> WON_INVITED
--        result='lost'                                  -> LOST_EXPIRED
--        result='closed'                                -> CLOSED
--        result='cancelled'                             -> CANCELLED
--        result='pending' AND bqms_pushed_at IS NOT NULL-> AWAITING_RESULT
--        result='pending' AND any V quoted (no push)    -> V1_QUOTED
--        else                                            -> leave 'NEW'
UPDATE bqms_rfq r
   SET qt_state = CASE
           WHEN r.result = 'won'       THEN 'WON_INVITED'::bqms_qt_state
           WHEN r.result = 'lost'      THEN 'LOST_EXPIRED'::bqms_qt_state
           WHEN r.result = 'closed'    THEN 'CLOSED'::bqms_qt_state
           WHEN r.result = 'cancelled' THEN 'CANCELLED'::bqms_qt_state
           WHEN r.result = 'pending' AND r.bqms_pushed_at IS NOT NULL
                THEN 'AWAITING_RESULT'::bqms_qt_state
           WHEN r.result = 'pending'
                AND (r.quoted_price_bqms_v1 IS NOT NULL
                     OR r.quoted_price_bqms_v2 IS NOT NULL
                     OR r.quoted_price_bqms_v3 IS NOT NULL
                     OR r.quoted_price_bqms_v4 IS NOT NULL)
                THEN 'V1_QUOTED'::bqms_qt_state
           ELSE r.qt_state
       END,
       state_changed_at = COALESCE(state_changed_at, NOW())
 WHERE r.qt_state = 'NEW'
   AND r.result IS NOT NULL;

COMMIT;

-- =============================================================================
-- POST-CHECK (run manually to sanity-check the backfill; SELECT-only):
--   SELECT qt_state, COUNT(*) FROM bqms_rfq GROUP BY qt_state ORDER BY 1;
--   SELECT COUNT(*) FROM bqms_rfq WHERE deadline_dt IS NOT NULL;
--   SELECT COUNT(*) FROM bqms_rfq WHERE current_round IS NOT NULL;
-- =============================================================================
