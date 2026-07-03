-- crm_owner.sql — CRM P1: customer ownership (manager-assigned, no backfill).
-- owner_id is UUID because users.id is UUID.
-- Idempotent: safe to re-run.

ALTER TABLE customers
    ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES users(id);

-- Partial index: owner-scoped queries (e.g. ?owner=mine work queue) skip soft-deleted rows.
CREATE INDEX IF NOT EXISTS idx_customers_owner
    ON customers(owner_id)
    WHERE deleted_at IS NULL;

-- Follow-up work queue scans crm_interactions by follow_up_date; index the due ones.
CREATE INDEX IF NOT EXISTS idx_crm_interactions_follow_up
    ON crm_interactions(follow_up_date)
    WHERE follow_up_date IS NOT NULL;
