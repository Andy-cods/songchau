CREATE TABLE IF NOT EXISTS file_review_status (
    id BIGSERIAL PRIMARY KEY,
    file_path TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','skipped','imported','error')),
    reviewed_by UUID REFERENCES users(id),
    reviewed_at TIMESTAMPTZ,
    reason TEXT,
    last_import_result JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_frs_path ON file_review_status(file_path);
CREATE INDEX IF NOT EXISTS idx_frs_status ON file_review_status(status);
