-- ===========================================================================
-- migrations/procurement_v2_012_users_password_version.sql
-- Wave C — Item 5. Revoke-token infrastructure. ADDITIVE, IDEMPOTENT, re-runnable.
-- 2026-06-26.
--
-- Every existing user = version 1 (via DEFAULT). Old JWTs lack the 'pv' claim and
-- are treated as pv=1 by code -> MATCHES default 1 -> NOBODY is kicked on deploy.
--
-- ORDERING: run this migration FIRST (column + enum value exist before new code
-- queries them), THEN docker cp + restart sc-api/sc-worker/sc-scheduler (Samsung
-- push=0 first). New code before migration -> SELECT password_version errors.
-- ===========================================================================

-- 1) Revoke-token version column on users. NON-VOLATILE DEFAULT 1 applies to ALL
--    pre-existing rows, so every current user is pv=1 == old-token pv=1.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_version INTEGER NOT NULL DEFAULT 1;

COMMENT ON COLUMN users.password_version IS
  'Bump +1 on every password change/reset to revoke all old JWTs (claim pv validated every request at conn-bearing chokepoints).';

-- 2) notifications.type is a REAL enum (notification_type). change-password /
--    reset-password INSERT a 'password_changed' row, so the value must exist on the
--    enum first. ALTER TYPE ... ADD VALUE is NON-TRANSACTIONAL and CANNOT run inside
--    a DO/BEGIN block — keep it as a standalone, individually idempotent statement.
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'password_changed';

-- Post-deploy verification (expect 0):
-- SELECT COUNT(*) FROM users WHERE password_version IS DISTINCT FROM 1;
