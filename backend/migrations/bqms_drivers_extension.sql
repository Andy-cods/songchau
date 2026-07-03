-- Phase G (Thang 2026-05-13): mở rộng bqms_contacts để chứa driver info
-- + thêm FK driver_id vào bqms_deliveries để chỉ định ai giao đơn này.

ALTER TABLE bqms_contacts
    ADD COLUMN IF NOT EXISTS is_driver BOOL DEFAULT false,
    ADD COLUMN IF NOT EXISTS cccd_number TEXT,
    ADD COLUMN IF NOT EXISTS cccd_image_path TEXT,
    ADD COLUMN IF NOT EXISTS license_plate TEXT,
    ADD COLUMN IF NOT EXISTS license_plate_image_path TEXT,
    ADD COLUMN IF NOT EXISTS vehicle_type TEXT,
    ADD COLUMN IF NOT EXISTS driver_notes TEXT;

ALTER TABLE bqms_deliveries
    ADD COLUMN IF NOT EXISTS driver_id BIGINT REFERENCES bqms_contacts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_bqms_deliveries_driver
    ON bqms_deliveries(driver_id) WHERE driver_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bqms_contacts_driver
    ON bqms_contacts(is_driver) WHERE is_driver = true;

COMMENT ON COLUMN bqms_contacts.is_driver IS 'true = contact này là người giao hàng (có CCCD + biển số xe)';
COMMENT ON COLUMN bqms_contacts.cccd_image_path IS 'Đường dẫn file ảnh CCCD trên /data/driver-docs/{id}/cccd.{ext}';
COMMENT ON COLUMN bqms_contacts.license_plate_image_path IS 'Đường dẫn file ảnh biển số xe trên /data/driver-docs/{id}/plate.{ext}';
COMMENT ON COLUMN bqms_deliveries.driver_id IS 'Người giao hàng được gán cho đơn này (bqms_contacts.id with is_driver=true)';
