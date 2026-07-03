-- Widen bqms_code_primary_image.chosen_by from BIGINT to TEXT (Thang 2026-05-20)
--
-- The application's TokenData.user_id is a UUID string (e.g. "cc296402-...")
-- but the column was BIGINT, so every POST /code/{code}/primary-image,
-- /upload-image and /crop-image attempted `int(uuid_str)` which raises
-- ValueError → 500 Internal Server Error → the user-pinned primary never
-- persisted, and `/rfq/image` PRIORITY 0 silently never fired.
--
-- Cast existing rows (if any) via ::text so we don't lose data.

ALTER TABLE bqms_code_primary_image
    ALTER COLUMN chosen_by TYPE TEXT USING chosen_by::text;
