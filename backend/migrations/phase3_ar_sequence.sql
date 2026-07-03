-- ============================================================
-- phase3_ar_sequence.sql
--
-- PHASE 3 (T4 / File 1) — dedicated chain-code SEQUENCE.
--
-- Replaces the UNSAFE `SELECT COALESCE(MAX(id),0)+1 FROM revenue_chain`
-- previously used inside chain_service.gen_chain_code() to mint the
-- numeric suffix of an RC-YYYYMM-NNNNNN chain code. Under two concurrent
-- payment-request approvals that MAX(id)+1 race could hand the SAME suffix
-- to both transactions (MED cross-link bug). `nextval()` is atomic, so two
-- parallel approvals always draw distinct numbers.
--
-- ⚠️ STAGED MIGRATION — additive + IDEMPOTENT + NON-DESTRUCTIVE.
--    Only CREATE SEQUENCE IF NOT EXISTS + a setval() seed. No table is
--    altered, no row is touched, nothing is dropped. Safe to re-run.
--    Creating the sequence does NOT by itself change financial behavior —
--    gen_chain_code only draws from it under PHASE3_AUTO_AR_ENABLED (FALSE).
--
-- LOAD-BEARING NAME: the sequence MUST be named EXACTLY
--    revenue_chain_code_seq
-- because chain_service.gen_chain_code() calls
--    nextval('revenue_chain_code_seq')
-- and the Phase-3 backfill (phase3_ar_backfill.sql) draws from the same
-- sequence. A typo here makes gen_chain_code raise at flag-on time and the
-- backfill mint colliding codes. DO NOT rename.
--
-- ORDERING: run this BEFORE phase3_ar_backfill.sql (the backfill draws
--    nextval('revenue_chain_code_seq')). Either order vs.
--    phase3_chain_activation.sql is fine — this file does not depend on the
--    Phase-3 columns.
--
-- Author: Phase 3 build (T4) — 2026-06-17
-- Run on VPS: psql -U scadmin -d songchau_erp -f phase3_ar_sequence.sql
-- ============================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- 1) The sequence itself.
--    BIGINT (matches revenue_chain.id BIGSERIAL), no CYCLE so a code
--    suffix never wraps around and re-collides with an earlier code.
-- ─────────────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS revenue_chain_code_seq
    AS BIGINT
    START WITH 1
    INCREMENT BY 1
    NO CYCLE;

COMMENT ON SEQUENCE revenue_chain_code_seq IS
    'Phase 3 — atomic source of the RC-YYYYMM-NNNNNN chain-code numeric suffix '
    '(used by chain_service.gen_chain_code via nextval). Replaces the unsafe '
    'MAX(id)+1 race. NO CYCLE — suffixes are monotonic and never re-collide.';

-- ─────────────────────────────────────────────────────────────
-- 2) Seed the sequence PAST every existing revenue_chain id.
--
--    Legacy gen_chain_code minted suffixes from MAX(id)+1, so the highest
--    code suffix already in use is <= MAX(revenue_chain.id). Seeding setval
--    to GREATEST(MAX(id), 1) means the NEXT nextval() returns MAX(id)+1 —
--    one past the last legacy code — so a freshly drawn suffix never equals
--    a legacy RC- suffix. (gen_chain_code ALSO keeps a collision-probe loop
--    as belt-and-suspenders for any legacy code whose suffix somehow ran
--    ahead of MAX(id).)
--
--    setval(seq, N) sets last_value = N and is_called = true, so the next
--    nextval() yields N + 1. GREATEST(..., 1) keeps N >= 1 on an empty table
--    (setval rejects 0 for a sequence whose MINVALUE is 1).
--
--    Idempotent / re-runnable: re-running only re-seeds to the current
--    MAX(id). On a live DB where nextval has already advanced the sequence
--    ABOVE MAX(id), this would rewind it — but this file is intended to run
--    ONCE at activation, BEFORE any nextval() draw (flag still FALSE), so the
--    sequence has not yet advanced. (If you must re-run after draws, guard
--    with GREATEST(currval, MAX(id)) manually.)
-- ─────────────────────────────────────────────────────────────
SELECT setval(
    'revenue_chain_code_seq',
    GREATEST((SELECT COALESCE(MAX(id), 0) FROM revenue_chain), 1)
);

COMMIT;

-- ============================================================
-- PRECHECK (run manually, read-only — NOT part of the migration):
--
--   -- Current seed vs. existing rows. last_value should be >= MAX(id),
--   -- so the next minted suffix (last_value + 1) clears every legacy code.
--   SELECT
--       (SELECT last_value FROM revenue_chain_code_seq)          AS seq_last_value,
--       (SELECT COALESCE(MAX(id), 0) FROM revenue_chain)         AS max_chain_id,
--       (SELECT COUNT(*) FROM revenue_chain)                     AS chain_rows;
-- ============================================================
