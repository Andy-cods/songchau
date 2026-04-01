-- ============================================================
-- PHASE 1: Business Intelligence — 4 new tables + extensions
-- Run on VPS: psql -U scadmin -d songchau_erp -f phase1_tables.sql
-- ============================================================

-- Extension for fuzzy text matching (M03: Smart Classify)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ─── M01: Quotation Templates ───────────────────────────────
CREATE TABLE IF NOT EXISTS quotation_templates (
    id          BIGSERIAL PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT,
    template_type TEXT NOT NULL CHECK (template_type IN ('cam_ket', 'commercial', 'combined')),
    file_path   TEXT NOT NULL,
    is_default  BOOLEAN NOT NULL DEFAULT false,
    created_by  UUID NOT NULL REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_qt_type ON quotation_templates(template_type);
CREATE INDEX IF NOT EXISTS idx_qt_default ON quotation_templates(is_default) WHERE is_default = true;

-- ─── M01: Quotations (generated) ────────────────────────────
CREATE TABLE IF NOT EXISTS quotations (
    id              BIGSERIAL PRIMARY KEY,
    rfq_no          TEXT NOT NULL,
    quotation_no    TEXT,
    status          TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','processing','completed','failed','submitted')),
    template_id     BIGINT REFERENCES quotation_templates(id),
    source_type     TEXT NOT NULL DEFAULT 'excel'
                        CHECK (source_type IN ('excel','rfq_code','ai_classify')),
    source_file     TEXT,
    items           JSONB NOT NULL DEFAULT '[]',
    output_xlsx     TEXT,
    output_pdf      TEXT,
    total_items     INT NOT NULL DEFAULT 0,
    filled_items    INT NOT NULL DEFAULT 0,
    error_message   TEXT,
    created_by      UUID NOT NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quot_rfq ON quotations(rfq_no);
CREATE INDEX IF NOT EXISTS idx_quot_status ON quotations(status);
CREATE INDEX IF NOT EXISTS idx_quot_created ON quotations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quot_user ON quotations(created_by);

-- ─── M03: AI Classification Results ─────────────────────────
CREATE TABLE IF NOT EXISTS ai_classification_results (
    id              BIGSERIAL PRIMARY KEY,
    rfq_id          BIGINT REFERENCES bqms_rfq(id),
    bqms_code       TEXT NOT NULL,
    specification   TEXT,
    classification  TEXT NOT NULL CHECK (classification IN ('chot', 'xem', 'bo')),
    confidence      NUMERIC(5,4),
    reasoning       TEXT,
    similar_history JSONB DEFAULT '[]',
    model_version   TEXT,
    accepted        BOOLEAN,
    reviewed_by     UUID REFERENCES users(id),
    reviewed_at     TIMESTAMPTZ,
    batch_id        TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_aicr_rfq ON ai_classification_results(rfq_id);
CREATE INDEX IF NOT EXISTS idx_aicr_class ON ai_classification_results(classification);
CREATE INDEX IF NOT EXISTS idx_aicr_batch ON ai_classification_results(batch_id);
CREATE INDEX IF NOT EXISTS idx_aicr_created ON ai_classification_results(created_at DESC);

-- pg_trgm index for fuzzy matching on bqms_rfq
CREATE INDEX IF NOT EXISTS idx_bqms_rfq_code_trgm ON bqms_rfq USING gin (bqms_code gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_bqms_rfq_spec_trgm ON bqms_rfq USING gin (specification gin_trgm_ops);

-- ─── M08: Scheduled Reports ─────────────────────────────────
CREATE TABLE IF NOT EXISTS scheduled_reports (
    id              BIGSERIAL PRIMARY KEY,
    report_type     TEXT NOT NULL,
    report_name     TEXT NOT NULL,
    schedule_cron   TEXT NOT NULL,
    recipients      UUID[] NOT NULL,
    email_subject   TEXT,
    parameters      JSONB NOT NULL DEFAULT '{}',
    is_active       BOOLEAN NOT NULL DEFAULT true,
    last_run_at     TIMESTAMPTZ,
    next_run_at     TIMESTAMPTZ,
    created_by      UUID NOT NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sr_active ON scheduled_reports(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_sr_next ON scheduled_reports(next_run_at);

CREATE TABLE IF NOT EXISTS report_executions (
    id              BIGSERIAL PRIMARY KEY,
    schedule_id     BIGINT REFERENCES scheduled_reports(id),
    report_type     TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','running','completed','failed')),
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    file_path       TEXT,
    error_message   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_re_schedule ON report_executions(schedule_id);
CREATE INDEX IF NOT EXISTS idx_re_status ON report_executions(status);
CREATE INDEX IF NOT EXISTS idx_re_created ON report_executions(created_at DESC);
