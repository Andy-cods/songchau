# Phase 3 Auto-AR (Auto Công Nợ) — Manager Readiness Report

**Date:** 2026-06-17
**Author:** Manager (final sign-off)
**Scope:** Pre-activation fixes that make it SAFE to enable `PHASE3_AUTO_AR_ENABLED`. The read-side (dashboard / endpoints) is already LIVE with the flag = `False`.
**Project:** Song Chau ERP — `songchau-erp/backend`

---

## 1. Executive Summary + GO / NO-GO on Enabling the Flag

The Phase-3 flag machinery itself is **solid and correct**: `gen_chain_code` is now concurrency-safe via the dedicated `revenue_chain_code_seq` sequence (name byte-identical across `chain_service.py` and both migrations), the auto-AR hook is correctly **best-effort** (nested savepoint + `try/except` logging at WARNING, so no in-hook error can abort an accountant's approval), `ensure_ar_for_order` idempotency and the customer-null SKIP+FLAG behaviour are correct, and with `PHASE3_AUTO_AR_ENABLED=False` (config.py:37) the whole `chain_service` write path is never executed — a true no-op on deploy.

**However**, adversarial QC surfaced **one HIGH, deploy-blocking regression that is NOT gated by the flag** (T3, `invoice_management.py`): the always-on invoice path now links `accounts_receivable.invoice_id` to the PK of the `invoices` table, but that column's FK references `revenue_invoices(id)` — a different table — so `auto_generate_invoice` will raise `23503` foreign-key violation and fail invoice creation.

- **Critical findings:** 0
- **High findings:** 1 (T3 `invoice_id` FK mismatch — blocks deploy)
- **GO / NO-GO to ENABLE the flag:** **NO-GO.** Do **not** enable `PHASE3_AUTO_AR_ENABLED` yet — (a) owner decision keeps it `False`, (b) the sequence + backfill migrations have not been run, and (c) the HIGH T3 bug must be fixed first.
- **GO / NO-GO to DEPLOY the 3 backend files with flag OFF:** **NO-GO until the T3 FK link is removed.** The enum fix (`'unpaid'→'pending'`) and the added NOT-NULL columns (`invoice_date`, `due_date`, `created_by`) are correct and valuable; only the `invoice_id`/`invoice_number` link in the AR INSERT must be reverted.

Once the one-line T3 fix lands, deploy is safe with the flag OFF, and the flag stays OFF until the migrations are run and re-reviewed.

---

## 2. What Each of the 4 Tasks Changed (file:line)

### T1 — `chain_service` (`backend/app/services/chain_service.py`)
- **`gen_chain_code` (chain_service.py:75-97 → body now ~102-120):** Replaced the concurrency-unsafe `SELECT COALESCE(MAX(id),0)+1 FROM revenue_chain` with an atomic `nextval('revenue_chain_code_seq')` draw, then `candidate = f"{prefix}{int(seq):06d}"`. Kept the collision-probe loop (bumps via another `nextval`, not `+=1`) as a belt-and-suspenders guard against legacy `RC-` codes. Added a defensive fallback to `MAX(id)+1` on `asyncpg.PostgresError` (un-migrated DB). Signature unchanged. **Fixes the MED cross-link bug** — two parallel approvals now get distinct codes.
- **`ensure_ar_for_order` (chain_service.py:257-363, skip-log ~line 306/352):** Raised the customer-null skip log from `logger.info` → `logger.warning` with the owner-mandated flag message. Still returns `None`, never raises. Idempotency (pre-check + `ON CONFLICT (sourcing_order_id) WHERE sourcing_order_id IS NOT NULL DO NOTHING` + re-read on race) left intact. AR `status='pending'` (valid `payment_status` enum) unchanged.
- **`ensure_chain_for_order` (chain_service.py:100-136):** Unchanged signature/behaviour; benefits from the new sequence transitively.

### T2 — `payment_requests` (`backend/app/api/v1/payment_requests.py`)
- **Auto-AR hook (payment_requests.py:454-503, inside `if settings.PHASE3_AUTO_AR_ENABLED:`):** Wrapped the existing 4 chain_service calls (`ensure_chain_for_order` ~461, `ensure_ar_for_order` ~469, `emit_event`, `advance_chain` → ~502) in a **nested** `async with conn.transaction():` (savepoint ~line 475) inside a `try/except Exception` that logs at WARNING (`'Phase3 auto-AR hook failed for SO %s / PR %s: %s'`, ~lines 521-526). Flag gate, call signatures/arg-names, and `from app.services import chain_service` import all unchanged. **Net runtime effect on deploy: zero** (flag `False`).

### T3 — `invoice_management` (`backend/app/api/v1/invoice_management.py`)
- **AR INSERT (invoice_management.py:369-388):** (1) `status` literal `'unpaid'` → `'pending'` (only valid "awaiting" member of `payment_status`). (2) Supplied the omitted NOT NULL columns `invoice_date`, `due_date`, `created_by`. (3) **[REGRESSION]** Also added `invoice_id` + `invoice_number` links and casts `$8::currency_code`, `$9::uuid`. `ON CONFLICT DO NOTHING` + `RETURNING *` kept. **The `invoice_id` link is the HIGH bug — see §4.**

### T4 — migrations (NEW files only, none run)
- **`backend/migrations/phase3_ar_sequence.sql`:** `CREATE SEQUENCE IF NOT EXISTS revenue_chain_code_seq` (BIGINT, NO CYCLE) + `setval('revenue_chain_code_seq', GREATEST((SELECT COALESCE(MAX(id),0) FROM revenue_chain), 1))`, wrapped in `BEGIN/COMMIT`, idempotent, additive.
- **`backend/migrations/phase3_ar_backfill.sql`:** Idempotent backfill for `payment_approved` (and shipped/delivered) orders with `deleted_at IS NULL AND customer_id IS NOT NULL` that lack a chain and/or AR. Mints chain via `nextval`, INSERTs `revenue_chain` `ON CONFLICT (chain_code) DO NOTHING`, INSERTs AR supplying all NOT NULL cols with `status='pending'::payment_status` and `ON CONFLICT (sourcing_order_id) WHERE sourcing_order_id IS NOT NULL DO NOTHING`, back-links `sourcing_orders.accounts_receivable_id`. Customerless orders SKIPPED by design (PRECHECK/POSTCHECK counts as comments). Run AFTER `phase3_chain_activation.sql` AND AFTER the sequence file.

> File-disjoint discipline held: T1↔chain_service.py, T2↔payment_requests.py, T3↔invoice_management.py, T4↔new .sql only. `config.py` untouched — flag stays `False`.

---

## 3. The Two Decisions Applied

### 3a. Best-effort atomicity (T2)
The hook runs inside the **single outer** `async with conn.transaction():` opened at payment_requests.py:378. A bare `try/except` that only logs is a trap: once any statement raises, asyncpg marks the **whole** transaction aborted, so the later notifications INSERT (~line 544) and final `fetchrow` (~line 560) fail with `InFailedSQLTransactionError` and **still break the approval**. The fix wraps the 4 chain_service calls in a **nested** `async with conn.transaction():` (savepoint) inside `try/except` logging at WARNING. The savepoint rolls back **only** the auto-AR writes; the PR approval, the `sourcing_order` transition, and the notification all commit, and the outer transaction stays clean and usable. **Verified correct by QC and Test.**

### 3b. Customer-null SKIP + FLAG (T1)
When `sourcing_orders.customer_id IS NULL`, `ensure_ar_for_order` returns `None` **without** creating an AR row (`accounts_receivable.customer_id` is NOT NULL, so creation is impossible) and logs at **WARNING** (raised from INFO) so the gap is visible: `'... payment_approved but has no customer_id — AR SKIPPED, will be attached by backfill once customer linked'`. The chain/event still advance (`ar_id` stays `None`); approval is never blocked. The T4 backfill attaches the AR once a `customer_id` is present, and only ever touches `customer_id IS NOT NULL` rows. **Verified correct by QC and Test.**

---

## 4. QC Findings (severity-ranked) + Whether Any Block Enabling

| # | Sev | Finding | File | Blocks deploy? | Blocks enable? |
|---|-----|---------|------|----------------|----------------|
| 1 | **HIGH** | T3 writes `invoices.id` into `accounts_receivable.invoice_id`, whose FK targets `revenue_invoices(id)` (init_v3.sql:1657) — a **different** table. The always-on `auto_generate_invoice` path will raise `23503` and abort invoice creation. **Not gated by the flag.** Enum fix + NOT-NULL fixes are correct; only the `invoice_id` link is the regression. | invoice_management.py:369-388 | **YES** | YES (path is always-on) |
| 2 | low | `gen_chain_code`'s `MAX(id)+1` fallback is effectively dead code on a real aborted (sub)transaction (`InFailedSQLTransactionError` precedes it). Benign — contained by the savepoint; only runs flag-ON. | chain_service.py | No | No |
| 3 | low | Backfill `Step 1` has no legacy-collision guard when stamping `chain_code` (vs `gen_chain_code`'s probe loop). Very low likelihood given the `setval` seed. Staged/not-run. | phase3_ar_backfill.sql | No | Guard before running |
| 4 | info | Atomicity savepoint correct; only the two local imports sit outside the `try` (acceptable, static deploy-time). | payment_requests.py | No | No |
| 5 | info | Sequence name byte-identical across code + both migrations; enum/NOT-NULL/idempotency contracts otherwise met. | chain_service.py | No | No |
| 6 | info | Security: no SQL injection (fully parameterized; `advance_chain` dynamic SET uses a hard-coded column allow-list); `approve_payment_request` gated by `require_role('accountant','admin')`. | chain_service.py | No | No |

**Counts:** critical = 0, high = 1, the rest low/info. **Finding #1 blocks both deploy and enable.** No other finding blocks.

**Recommended fix for #1 (quickest, keeps the valuable corrections):** Remove `invoice_id` + `invoice_number` from the AR INSERT column list and bound values; keep `(customer_id, sales_order_id, invoice_date, due_date, amount, currency, paid_amount, status, created_by)`. Alternatively, repoint the FK to `invoices(id)` in a migration if linking the phase-2 `invoices` table is the real intent. Add a regression test that creates an invoice end-to-end so the FK actually fires.

---

## 5. Test Results

- **`py_compile` (Python 3.13.3)** on all 3 changed files individually and together: **all OK** — `chain_service.py`, `payment_requests.py`, `invoice_management.py`.
- **SQL static/logical review** (read-only, NO DB connection, NO migrations run) of `phase3_chain_activation.sql`, `phase3_ar_sequence.sql`, `phase3_ar_backfill.sql`: balanced `BEGIN/COMMIT`, idempotency guards (`ADD COLUMN IF NOT EXISTS`, `CREATE [UNIQUE] INDEX IF NOT EXISTS`, `CREATE SEQUENCE IF NOT EXISTS`, `ON CONFLICT DO NOTHING`, `IS NULL`/`NOT EXISTS` guards, `TEMP TABLE ON COMMIT DROP`). Verified the `ON CONFLICT` predicate `WHERE sourcing_order_id IS NOT NULL` byte-matches across `uq_ar_sourcing_order`, the backfill upsert, and `ensure_ar_for_order`; and that `revenue_chain_code_seq` matches `gen_chain_code`'s `nextval`.
- **Throwaway unit-style tests** (asyncpg stubbed into `sys.modules`, mock conn; file deleted after running):
  1. `gen_chain_code` fallback — `nextval` raising → degrades to `MAX(id)+1` → `RC-202606-000042` **PASS**
  2. `gen_chain_code` happy path with sequence present → `RC-202606-000007` **PASS**
  3. `ensure_ar_for_order` customer-null branch returns `None` with **zero** writes **PASS**
  4. Replicated the nested-savepoint best-effort wrapper; a simulated chain_service error is swallowed so the approval still commits **PASS**
- **No prod DB connection, no migrations executed.** Overall test verdict: **PASS** (auto-AR write path stays inert because it is gated behind the flag).

> Caveat: tests run with asyncpg stubbed locally (asyncpg lives on the VPS). The HIGH FK finding (#1) is a schema-level mismatch that a stubbed test cannot catch — it requires an end-to-end invoice creation against the real DB, which is exactly the recommended regression test.

---

## 6. EXACT Safe Deploy + Enable Sequence

**Pre-req (blocking):** Apply the T3 fix for finding #1 — remove `invoice_id` + `invoice_number` from the AR INSERT (or repoint the FK). Re-run `py_compile` and re-review.

Then, in order:

1. **Run the sequence migration** (idempotent, additive):
   `psql "$DATABASE_URL" -f backend/migrations/phase3_ar_sequence.sql`
   Confirms `revenue_chain_code_seq` exists and is seeded to `GREATEST(MAX(revenue_chain.id), 1)`.
2. **Deploy the 3 backend files** (with the T3 fix applied) — `chain_service.py`, `payment_requests.py`, `invoice_management.py`. Per the VPS deploy pattern: `docker cp` the image/files and restart **sc-api + sc-worker + sc-scheduler together** (else the scheduler steals jobs with stale code). **Flag stays `False`** — this is a no-op for the auto-AR path and only ships the (now-correct) invoice AR INSERT fix.
3. **Run the backfill** (idempotent, re-runnable; only AFTER steps 1-2 and AFTER `phase3_chain_activation.sql`):
   First run the file's PRECHECK + the legacy-collision check from finding #3, then
   `psql "$DATABASE_URL" -f backend/migrations/phase3_ar_backfill.sql`
   Review the POSTCHECK skipped-customerless count.
4. **Set `PHASE3_AUTO_AR_ENABLED=true`** in `config.py` default **and** the VPS `.env`, then restart sc-api + sc-worker + sc-scheduler. Verify a single test approval mints a chain + AR and emits `payment.approved`.

> Do NOT skip step 1 before step 4: enabling the flag against an un-migrated DB makes every `gen_chain_code` call's `nextval` fail (savepoint-rolled-back, approvals still safe, but auto-AR silently does nothing).

---

## 7. Remaining Risks / What to Watch After Enabling

- **Sequence-name drift (resolved, keep frozen):** `revenue_chain_code_seq` is byte-identical in `chain_service.py` and both migrations. Any future rename must change all three together.
- **Enum trap:** `accounts_receivable.status` = `payment_status` = `{pending, partial_paid, paid, overdue, disputed}`. Never write `'unpaid'` or `'partial'` (→ `22P02`). Keep `'pending'`.
- **Customerless-order gap (by design):** Watch for the WARNING flag `'... AR SKIPPED, will be attached by backfill ...'` in logs after enabling. Each occurrence = a chain at the `payment` stage with no công nợ until a `customer_id` is linked and the backfill re-run. Set up a log alert / periodic count.
- **Backfill legacy-collision (finding #3):** Before each backfill run, verify no legacy `revenue_chain.chain_code` suffix exceeds the seeded sequence `last_value`; optionally guard the `UPDATE` with `AND EXISTS (... rc.chain_code = e.new_code)`.
- **Best-effort silent failures:** After enabling, the auto-AR hook can fail-and-log without breaking approval. Monitor `'Phase3 auto-AR hook failed for SO %s / PR %s'` WARNING lines — a spike means the AR table is silently diverging from approvals and a backfill re-run is needed.
- **Migrations are forward-only/additive:** All `IF NOT EXISTS` / `ON CONFLICT DO NOTHING`. `setval` is rewind-aware on re-run (documented in the file); re-running the sequence file after rows exist re-seeds to current `MAX(id)`, which is safe.
- **T3 regression test debt:** Add an end-to-end invoice-creation test so the `accounts_receivable` FK fires in CI — the stubbed local tests cannot catch schema FK mismatches like finding #1.
