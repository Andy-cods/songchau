-- Seed bqms_won_sync_periodic_enabled flag so the scheduled periodic task actually fires.
-- Without this row, _periodic_enabled() returns False and bqms_won_sync_periodic is dormant.
INSERT INTO app_config (key, value)
VALUES ('bqms_won_sync_periodic_enabled', 'true'::jsonb)
ON CONFLICT (key) DO UPDATE
SET value = 'true'::jsonb,
    updated_at = NOW();
