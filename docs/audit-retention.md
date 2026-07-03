# Audit-Log Retention Policy

**Status:** Active
**Owner:** Backend / Data
**Last reviewed:** 2026-06-13
**Implementation:** `backend/app/tasks/audit_retention.py`
**Schedule:** `@app.periodic(cron="0 2 * * *")` — daily at 02:00 UTC (≈ 09:00 ICT)

---

## Goal

Bound storage growth of audit / transient tables without losing forensic value.
Hot tables stay fast; long-tail history is archived or pruned according to the
policies below.

## Tables under policy

| Table | Action | Retention | Rationale |
|---|---|---|---|
| `notifications` | DELETE | 90 days | Transient UI hints; underlying event (workflow, leave, sourcing order) keeps its own audit trail. |
| `sourcing_order_status_history` | ARCHIVE to `*_archive` | 2 years online | Quote-to-order timeline; legal/forensic value but read-rare beyond 2 years. |
| `sourcing_supplier_prices.*_by_email` | NOT pruned | column-level audit | Per-row forensic snapshot; lifecycle tied to the supplier_price row itself. |
| `sourcing_pricing_rules.*_by_email` | NOT pruned | column-level audit | Same as above. |
| `procrastinate_jobs` (status='succeeded') | DELETE | 30 days | Job log; events cascade-delete with job. |
| `procrastinate_jobs` (status='failed') | KEPT | forever | Debug post-mortem; manual purge only. |

## Policy details

### 1. `notifications` — DELETE > 90 days

```sql
DELETE FROM notifications
WHERE created_at < NOW() - INTERVAL '90 days';
```

Read state is **not** considered — unread notifications older than 90 days are
also deleted (they are stale by definition).

### 2. `sourcing_order_status_history` — ARCHIVE > 2 years

On first run the task creates `sourcing_order_status_history_archive` via
`CREATE TABLE … (LIKE … INCLUDING DEFAULTS)`. Subsequent runs move expired rows:

```sql
WITH moved AS (
    DELETE FROM sourcing_order_status_history
    WHERE at < NOW() - INTERVAL '730 days'
    RETURNING *
)
INSERT INTO sourcing_order_status_history_archive
SELECT * FROM moved;
```

Single-transaction: a crash mid-archive cannot lose rows.

### 3. `procrastinate_jobs` — DELETE succeeded > 30 days

Procrastinate ships no built-in periodic prune by default; we run it from this
task so all retention logic is co-located. `procrastinate_events.job_id`
cascades, so the event stream trims automatically.

```sql
DELETE FROM procrastinate_jobs
WHERE status = 'succeeded'
  AND COALESCE(
          (SELECT MAX(at) FROM procrastinate_events e WHERE e.job_id = procrastinate_jobs.id),
          scheduled_at
      ) < NOW() - INTERVAL '30 days';
```

## Surveying current table sizes

Before tweaking retention, check live row counts:

```bash
docker exec sc-postgres psql -U scadmin -d songchau_erp -c "
  SELECT relname, n_live_tup
  FROM pg_stat_user_tables
  WHERE relname IN ('notifications',
                    'sourcing_order_status_history',
                    'sourcing_order_status_history_archive',
                    'procrastinate_jobs',
                    'procrastinate_events')
  ORDER BY n_live_tup DESC;
"
```

## Manual run

```bash
docker exec sc-worker python -c \
  "from app.tasks.audit_retention import prune_audit_logs; \
   print(prune_audit_logs(timestamp=0))"
```

Returns a JSON-shaped dict:

```json
{
  "started_at": "...",
  "notifications_deleted": 123,
  "sourcing_history_archived": 45,
  "procrastinate_jobs_deleted": 678,
  "finished_at": "..."
}
```

A value of `-1` means that policy errored — check worker logs.

## Emergency / one-off cleanup scripts

If the periodic task has been off for a while and tables have grown, run
these manually inside `sc-postgres`. They mirror the policies above and are
safe to re-run (idempotent).

```sql
-- 1. notifications older than 90 days
DELETE FROM notifications
WHERE created_at < NOW() - INTERVAL '90 days';

-- 2. sourcing_order_status_history older than 2 years (archive then delete)
CREATE TABLE IF NOT EXISTS sourcing_order_status_history_archive
    (LIKE sourcing_order_status_history INCLUDING DEFAULTS);

WITH moved AS (
    DELETE FROM sourcing_order_status_history
    WHERE at < NOW() - INTERVAL '730 days'
    RETURNING *
)
INSERT INTO sourcing_order_status_history_archive
SELECT * FROM moved;

-- 3. procrastinate_jobs (succeeded) older than 30 days
DELETE FROM procrastinate_jobs
WHERE status = 'succeeded'
  AND COALESCE(
          (SELECT MAX(at) FROM procrastinate_events e WHERE e.job_id = procrastinate_jobs.id),
          scheduled_at
      ) < NOW() - INTERVAL '30 days';

-- 4. (optional) Reclaim physical disk after large deletes
VACUUM (ANALYZE) notifications;
VACUUM (ANALYZE) sourcing_order_status_history;
VACUUM (ANALYZE) procrastinate_jobs;
```

## Changing a retention window

All windows are constants at the top of `audit_retention.py`:

```python
NOTIFICATIONS_RETAIN_DAYS           = 90
SOURCING_HISTORY_RETAIN_DAYS        = 365 * 2
PROCRASTINATE_SUCCEEDED_RETAIN_DAYS = 30
```

Update both the constant **and** the matching row in the table above when
changing a policy. Then redeploy `sc-worker`; the next 02:00 run will use the
new window.

## Tables explicitly excluded

- `workflow_history`, `audit_log` — long-term legal record, kept indefinitely.
- `sales_orders`, `sourcing_orders` — business records, not audit.
- `bqms_*` — synced from external system; managed by sync tasks.
- Soft-deleted rows (`deleted_at IS NOT NULL`) — separate concern (TBD).
