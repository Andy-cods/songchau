-- Add heartbeat column to bqms_dossier_jobs (Thang 2026-05-18 — B3 concurrency).
-- Worker updates last_heartbeat_at every ~30s. Watchdog detects stuck jobs.

ALTER TABLE bqms_dossier_jobs
    ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_dossier_jobs_heartbeat
    ON bqms_dossier_jobs (status, last_heartbeat_at)
    WHERE status IN ('queued', 'running');
