-- Migration: bqms_contacts — Danh bạ liên hệ Samsung (từ DANH BẠ sheet)
-- Date: 2026-04-06

CREATE TABLE IF NOT EXISTS bqms_contacts (
    id              BIGSERIAL PRIMARY KEY,
    email_username  TEXT NOT NULL UNIQUE,
    full_name       TEXT NOT NULL,
    delivery_info   TEXT,
    phone           TEXT,
    is_active       BOOLEAN DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bcon_email ON bqms_contacts (email_username);
CREATE INDEX IF NOT EXISTS idx_bcon_name ON bqms_contacts (full_name);
