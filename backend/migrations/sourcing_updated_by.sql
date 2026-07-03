-- Track who last updated a sourcing entry (audit trail for edits).
ALTER TABLE sourcing_entries
    ADD COLUMN IF NOT EXISTS updated_by_id BIGINT,
    ADD COLUMN IF NOT EXISTS updated_by_email TEXT;

CREATE INDEX IF NOT EXISTS idx_sourcing_updated_by ON sourcing_entries(updated_by_id)
    WHERE updated_by_id IS NOT NULL;
