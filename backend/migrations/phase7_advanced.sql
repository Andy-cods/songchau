-- =============================================================================
-- Phase 7: Advanced Features — Migration
-- Song Châu ERP
-- =============================================================================

-- email_history: Samsung email communication log
CREATE TABLE IF NOT EXISTS email_history (
    id BIGSERIAL PRIMARY KEY,
    direction TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
    from_email TEXT NOT NULL,
    to_email TEXT NOT NULL,
    subject TEXT NOT NULL,
    body_preview TEXT,
    body_html TEXT,
    has_attachments BOOLEAN DEFAULT false,
    attachment_names TEXT[],
    message_id TEXT UNIQUE, -- Graph API message ID
    conversation_id TEXT,
    ref_type TEXT, -- 'bqms_rfq','purchase_orders','invoices'
    ref_id BIGINT,
    is_read BOOLEAN DEFAULT false,
    received_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_eh_ref ON email_history(ref_type, ref_id);
CREATE INDEX IF NOT EXISTS idx_eh_direction ON email_history(direction, created_at DESC);

-- demand_forecasts: AI-generated demand predictions
CREATE TABLE IF NOT EXISTS demand_forecasts (
    id BIGSERIAL PRIMARY KEY,
    product_id BIGINT REFERENCES products(id),
    bqms_code TEXT,
    forecast_date DATE NOT NULL,
    period_months INT NOT NULL DEFAULT 3,
    predicted_qty NUMERIC(12,2),
    confidence NUMERIC(5,2),
    method TEXT DEFAULT 'moving_avg', -- 'moving_avg','linear_trend','seasonal'
    input_data JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_df_product ON demand_forecasts(product_id, forecast_date DESC);

-- ocr_results: document OCR extraction results
CREATE TABLE IF NOT EXISTS ocr_results (
    id BIGSERIAL PRIMARY KEY,
    document_id BIGINT REFERENCES documents(id),
    file_name TEXT NOT NULL,
    ocr_engine TEXT DEFAULT 'gemini_vision',
    extracted_data JSONB NOT NULL DEFAULT '{}',
    raw_text TEXT,
    confidence NUMERIC(5,2),
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed')),
    error_message TEXT,
    processed_at TIMESTAMPTZ,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- calendar_events: team calendar
CREATE TABLE IF NOT EXISTS calendar_events (
    id BIGSERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    event_type TEXT NOT NULL CHECK (event_type IN ('meeting','deadline','holiday','leave','delivery','other')),
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ,
    all_day BOOLEAN DEFAULT false,
    location TEXT,
    attendees UUID[] DEFAULT '{}',
    ref_type TEXT,
    ref_id BIGINT,
    color TEXT DEFAULT '#3b82f6',
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ce_date ON calendar_events(start_time);
CREATE INDEX IF NOT EXISTS idx_ce_type ON calendar_events(event_type);

-- leave_requests: employee leave management
CREATE TABLE IF NOT EXISTS leave_requests (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id),
    leave_type TEXT NOT NULL CHECK (leave_type IN ('annual','sick','personal','maternity','other')),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    days_count NUMERIC(4,1) NOT NULL,
    reason TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
    approved_by UUID REFERENCES users(id),
    approved_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lr_user ON leave_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_lr_status ON leave_requests(status);
