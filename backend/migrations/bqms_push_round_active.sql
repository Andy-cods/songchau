-- BQMS Push Round-Active + 8-step checklist tracking (Thang 2026-06-22)
--
-- WHY: bqms_pushed_round is written ONLY on the SUCCESS path (saved_temp).
-- While a V2/V3 push is RUNNING, the row still carries the V1 round number,
-- so the progress popup mislabels the round as "V1" and the dedup
-- (PARTITION BY ... bqms_pushed_round) can mis-rank the running row against
-- the historical V1 row. Introduce bqms_push_round_active — set at enqueue +
-- at "mark running" — so the live round is authoritative DURING a push, while
-- bqms_pushed_round stays the historical record other UI reads on success.
--
-- Also add the canonical 8-step checklist progress fields so the popup renders
-- an identical step list for every round V1..Vn:
--   bqms_push_step_index  — current step 1..8 (0 = not started)
--   bqms_push_total_steps — always 8 (future-proofed as a column)
--   bqms_push_step_key    — machine key of current step (login/session/...)
--
-- Idempotent: every column is ADD COLUMN IF NOT EXISTS.
ALTER TABLE bqms_rfq
    ADD COLUMN IF NOT EXISTS bqms_push_round_active INT,
    ADD COLUMN IF NOT EXISTS bqms_push_step_index   SMALLINT,
    ADD COLUMN IF NOT EXISTS bqms_push_total_steps  SMALLINT,
    ADD COLUMN IF NOT EXISTS bqms_push_step_key      TEXT;
