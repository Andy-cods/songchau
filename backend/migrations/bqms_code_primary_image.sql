-- BQMS Code Primary Image — user-chosen image override (Thang 2026-05-19)
--
-- Lets a user pin a specific image as the "primary" for a bqms_code, so the
-- thumbnail in /bqms list + the embed in báo giá GC / dossier "Cam kết hình
-- ảnh" always uses that exact file instead of the auto-pick from priority
-- (override > quote > rfq > product) which can be non-deterministic when
-- multiple files share the same source.
--
-- Image leak root cause being fixed here:
--   1. `v_bqms_best_image` had non-deterministic tiebreaker when source +
--      mtime + file_size all tied — PostgreSQL would pick a random row,
--      so the same bqms_code could show different images across requests.
--      → Added `id ASC` as final tiebreaker.
--   2. No way for user to pin the correct image when the auto-pick is wrong
--      → Added `bqms_code_primary_image` table + view priority.

-- 1. User-chosen primary image per bqms_code
CREATE TABLE IF NOT EXISTS bqms_code_primary_image (
    bqms_code    TEXT PRIMARY KEY,
    image_path   TEXT NOT NULL,
    chosen_by    BIGINT,        -- user_id (FK loose — keep audit even if user deleted)
    chosen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bcpi_image_path ON bqms_code_primary_image (image_path);

-- 2. Rebuild view: user primary trumps source-priority + add deterministic id tiebreaker
CREATE OR REPLACE VIEW v_bqms_best_image AS
SELECT DISTINCT ON (bii.bqms_code)
    bii.bqms_code,
    bii.image_path,
    bii.source,
    bii.rfq_number,
    bii.file_size,
    bii.mtime,
    (pc.bqms_code IS NOT NULL) AS is_user_primary
FROM bqms_image_index bii
LEFT JOIN bqms_code_primary_image pc
       ON pc.bqms_code = bii.bqms_code
      AND pc.image_path = bii.image_path
ORDER BY
    bii.bqms_code,
    -- User-chosen primary wins absolutely
    (pc.bqms_code IS NOT NULL) DESC,
    -- Then source priority: override > quote > rfq > product
    CASE bii.source WHEN 'override' THEN 1
                    WHEN 'quote'    THEN 2
                    WHEN 'rfq'      THEN 3
                    WHEN 'product'  THEN 4
                    ELSE 5 END,
    -- Then newest mtime first
    bii.mtime DESC NULLS LAST,
    -- Then biggest file (usually higher-resolution)
    bii.file_size DESC NULLS LAST,
    -- Final deterministic tiebreaker: stable insertion order
    bii.id ASC;
