-- CRM Pipeline Kanban — Quản lý chu kỳ chăm sóc KH
-- Date: 2026-04-06

CREATE TABLE IF NOT EXISTS crm_pipeline_cards (
    id              BIGSERIAL PRIMARY KEY,
    stage           TEXT NOT NULL DEFAULT 'new'
                    CHECK (stage IN ('new', 'nurturing', 'active', 'quoting', 'waiting', 'delivering', 'aftercare')),
    title           TEXT NOT NULL,
    description     TEXT,
    customer_name   TEXT,
    customer_id     BIGINT,

    -- Links to existing data
    rfq_number      TEXT,
    po_number       TEXT,
    bqms_code       TEXT,
    quotation_id    BIGINT,
    delivery_id     BIGINT,

    -- Task/follow-up
    follow_up_date  DATE,
    follow_up_note  TEXT,
    assigned_to     UUID REFERENCES users(id),
    assigned_name   TEXT,

    -- Metadata
    priority        TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    source          TEXT DEFAULT 'manual',  -- 'manual', 'auto_rfq', 'auto_po', 'auto_delivery'
    is_archived     BOOLEAN DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    moved_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()  -- last stage change
);

CREATE INDEX IF NOT EXISTS idx_pipeline_stage ON crm_pipeline_cards(stage) WHERE NOT is_archived;
CREATE INDEX IF NOT EXISTS idx_pipeline_followup ON crm_pipeline_cards(follow_up_date) WHERE follow_up_date IS NOT NULL AND NOT is_archived;
CREATE INDEX IF NOT EXISTS idx_pipeline_customer ON crm_pipeline_cards(customer_name);
