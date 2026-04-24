-- ============================================================
-- Extend delivery_status ENUM with English status values
-- (Frontend uses these for status filtering and transitions)
-- Run on VPS: psql -U scadmin -d songchau_erp -f extend_delivery_status.sql
-- ============================================================

-- Add new status values to existing ENUM
ALTER TYPE delivery_status ADD VALUE IF NOT EXISTS 'pending';
ALTER TYPE delivery_status ADD VALUE IF NOT EXISTS 'picked_up';
ALTER TYPE delivery_status ADD VALUE IF NOT EXISTS 'in_transit';
ALTER TYPE delivery_status ADD VALUE IF NOT EXISTS 'customs_clearance';
ALTER TYPE delivery_status ADD VALUE IF NOT EXISTS 'delivered';
ALTER TYPE delivery_status ADD VALUE IF NOT EXISTS 'completed';
ALTER TYPE delivery_status ADD VALUE IF NOT EXISTS 'hoan_tat';
