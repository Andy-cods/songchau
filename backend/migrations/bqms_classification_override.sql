-- Phase E (Thang 2026-05-13): cho phép user override classification TM/GC nếu
-- auto-detect không đúng. Auto-detect đặt giá trị 'classification=TM|GC' trong
-- notes. Nếu user click Loại column → chọn TM/GC/Auto, ta ghi vào
-- classification_override (NULL = revert về auto).

ALTER TABLE bqms_rfq ADD COLUMN IF NOT EXISTS classification_override TEXT
    CHECK (classification_override IS NULL OR classification_override IN ('TM','GC'));

CREATE INDEX IF NOT EXISTS idx_bqms_rfq_classification_override
    ON bqms_rfq(classification_override) WHERE classification_override IS NOT NULL;

COMMENT ON COLUMN bqms_rfq.classification_override IS
    'User override của classification TM/GC. NULL = dùng auto-detect từ notes.';
