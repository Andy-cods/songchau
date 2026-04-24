-- ============================================================
-- GC Quotation Flow: Add columns for Gia Công support
-- Run on VPS: psql -U scadmin -d songchau_erp -f gc_quotation_fields.sql
-- ============================================================

-- Expand source_type to include 'onedrive' for GC files from OneDrive staging
ALTER TABLE quotations
  DROP CONSTRAINT IF EXISTS quotations_source_type_check;
ALTER TABLE quotations
  ADD CONSTRAINT quotations_source_type_check
  CHECK (source_type IN ('excel', 'rfq_code', 'ai_classify', 'onedrive'));

-- GC-specific columns
ALTER TABLE quotations
  ADD COLUMN IF NOT EXISTS flow_type TEXT NOT NULL DEFAULT 'tm',
  ADD COLUMN IF NOT EXISTS quote_level SMALLINT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS gc_source_folder TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS gc_cloned_folder TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS gc_sheet_report JSONB DEFAULT NULL;

-- Add check constraint for flow_type
ALTER TABLE quotations
  DROP CONSTRAINT IF EXISTS quotations_flow_type_check;
ALTER TABLE quotations
  ADD CONSTRAINT quotations_flow_type_check
  CHECK (flow_type IN ('tm', 'gc'));

-- Index for filtering by flow_type
CREATE INDEX IF NOT EXISTS idx_quot_flow ON quotations(flow_type);

-- Comments
COMMENT ON COLUMN quotations.flow_type IS 'tm = Thương Mại (template fill), gc = Gia Công (marker fill)';
COMMENT ON COLUMN quotations.quote_level IS 'L1=1, L2=2, L3=3, L4=4 — chỉ dùng cho GC flow';
COMMENT ON COLUMN quotations.gc_source_folder IS 'Đường dẫn thư mục Lx gốc trên OneDrive staging';
COMMENT ON COLUMN quotations.gc_cloned_folder IS 'Đường dẫn thư mục Lx+1 đã clone và sửa';
COMMENT ON COLUMN quotations.gc_sheet_report IS 'Báo cáo sửa từng sheet: [{sheet, code, price, status, marker_row}]';
