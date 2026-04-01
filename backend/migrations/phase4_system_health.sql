-- ============================================================
-- Phase 4: System Health & Admin — Migration
-- Song Châu ERP
-- ============================================================

-- system_health_checks: periodic health check results
CREATE TABLE IF NOT EXISTS system_health_checks (
    id BIGSERIAL PRIMARY KEY,
    check_type TEXT NOT NULL, -- 'database', 'redis', 'api', 'disk', 'memory', 'containers'
    status TEXT NOT NULL CHECK (status IN ('healthy', 'degraded', 'unhealthy')),
    response_time_ms INT,
    details JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_shc_type ON system_health_checks(check_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shc_created ON system_health_checks(created_at DESC);

-- error_log: centralized error tracking
CREATE TABLE IF NOT EXISTS error_log (
    id BIGSERIAL PRIMARY KEY,
    error_type TEXT NOT NULL, -- 'api_error', 'task_error', 'sync_error', 'system_error'
    severity TEXT NOT NULL DEFAULT 'error' CHECK (severity IN ('warning', 'error', 'critical')),
    message TEXT NOT NULL,
    stack_trace TEXT,
    endpoint TEXT,
    user_id UUID REFERENCES users(id),
    request_data JSONB,
    resolved BOOLEAN NOT NULL DEFAULT false,
    resolved_by UUID REFERENCES users(id),
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_el_type ON error_log(error_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_el_severity ON error_log(severity, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_el_unresolved ON error_log(resolved) WHERE resolved = false;
CREATE INDEX IF NOT EXISTS idx_el_created ON error_log(created_at DESC);

-- retry_queue: failed jobs that can be retried
CREATE TABLE IF NOT EXISTS retry_queue (
    id BIGSERIAL PRIMARY KEY,
    job_type TEXT NOT NULL, -- 'bqms_sync', 'email_send', 'pdf_generate', 'etl_import'
    job_data JSONB NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'retrying', 'completed', 'failed_permanently')),
    attempts INT NOT NULL DEFAULT 0,
    max_attempts INT NOT NULL DEFAULT 5,
    last_error TEXT,
    next_retry_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rq_status ON retry_queue(status) WHERE status IN ('pending', 'retrying');
CREATE INDEX IF NOT EXISTS idx_rq_next_retry ON retry_queue(next_retry_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_rq_job_type ON retry_queue(job_type, created_at DESC);

-- backup_log: backup history
CREATE TABLE IF NOT EXISTS backup_log (
    id BIGSERIAL PRIMARY KEY,
    backup_type TEXT NOT NULL CHECK (backup_type IN ('full', 'incremental', 'manual')),
    file_path TEXT,
    file_size_bytes BIGINT,
    tables_count INT,
    rows_count BIGINT,
    duration_seconds INT,
    status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
    verified BOOLEAN DEFAULT false,
    verified_at TIMESTAMPTZ,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bl_status ON backup_log(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bl_created ON backup_log(created_at DESC);

-- data_quality_checks: data quality audit results
CREATE TABLE IF NOT EXISTS data_quality_checks (
    id BIGSERIAL PRIMARY KEY,
    table_name TEXT NOT NULL,
    check_name TEXT NOT NULL,
    check_type TEXT NOT NULL, -- 'null_check', 'orphan_check', 'duplicate_check', 'range_check'
    status TEXT NOT NULL CHECK (status IN ('pass', 'warning', 'fail')),
    affected_rows INT NOT NULL DEFAULT 0,
    details JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dqc_status ON data_quality_checks(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dqc_table ON data_quality_checks(table_name, created_at DESC);
