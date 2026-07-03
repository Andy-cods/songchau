-- ===========================================================================
-- tests/_bootstrap_schema.sql
--
-- MINIMAL, self-contained schema for the CI test harness FALLBACK path.
--
-- The harness (tests/conftest.py :: schema_info) prefers a full prod snapshot
-- at tests/_schema_snapshot.sql (pg_dump --schema-only). When that file is
-- ABSENT, it loads THIS file instead so the smoke suite + any auth/RBAC test
-- still runs today with zero dependency on the 119 ad-hoc migrations.
--
-- Scope on purpose: only what auth + RBAC + the smoke tests touch — the `users`
-- table and `role_enum`. Table-heavy integration tests (tests/integration/
-- test_api.py) are marked @pytest.mark.integration and SKIP unless the full
-- snapshot is present.
--
-- role_enum here mirrors PROD EXACTLY (init_v3.sql + add_viewer_role.sql +
-- vendor_portal_001.sql): admin, manager, procurement, warehouse, staff,
-- accountant, viewer, vendor. NOTE: 'sales' and 'director' are intentionally
-- ABSENT — no migration ever adds them to role_enum, even though app code
-- passes them to require_role(). Fixtures must not rely on storing those two
-- as a users.role value (see conftest _ENUM_ROLES).
--
-- The `users` DDL is copied from init_v3.sql + the password_version column
-- added by migrations/procurement_v2_012_users_password_version.sql.
--
-- conftest DROPs+recreates schema `public` before loading this, so it is
-- effectively idempotent across repeated sessions (the IF NOT EXISTS guards
-- are belt-and-suspenders).
-- ===========================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'role_enum') THEN
        CREATE TYPE role_enum AS ENUM (
            'admin',
            'manager',
            'procurement',
            'warehouse',
            'staff',
            'accountant',
            'viewer',
            'vendor'
        );
    END IF;
END
$$;

CREATE TABLE IF NOT EXISTS users (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email            TEXT NOT NULL UNIQUE,
    full_name        TEXT NOT NULL,
    display_name     TEXT,
    role             role_enum NOT NULL DEFAULT 'staff',
    department       TEXT,
    phone            TEXT,
    hashed_password  TEXT NOT NULL,
    m365_id          TEXT UNIQUE,
    is_active        BOOLEAN NOT NULL DEFAULT true,
    deleted_at       TIMESTAMPTZ,
    last_login_at    TIMESTAMPTZ,
    -- from migrations/procurement_v2_012_users_password_version.sql
    password_version INTEGER NOT NULL DEFAULT 1,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by       UUID REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);
