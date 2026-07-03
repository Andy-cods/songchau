-- Add 'viewer' role for guest read-only accounts (Thang 2026-05-20)
--
-- Viewer can hit ANY endpoint via GET (browse the whole system, read data,
-- view ảnh, download files, etc.) but rejected on POST/PUT/PATCH/DELETE.
-- Enforced centrally in app/core/rbac.py require_role().

DO $$
BEGIN
    -- Add 'viewer' to role_enum if not already present
    IF NOT EXISTS (
        SELECT 1 FROM pg_enum
         WHERE enumlabel = 'viewer'
           AND enumtypid = 'role_enum'::regtype
    ) THEN
        ALTER TYPE role_enum ADD VALUE 'viewer';
    END IF;
END
$$;
