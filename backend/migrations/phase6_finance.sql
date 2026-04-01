-- =============================================================================
-- Phase 6: Finance & CRM — Migration
-- Song Châu ERP
-- =============================================================================

-- cash_book: daily cash flow ledger
CREATE TABLE IF NOT EXISTS cash_book (
    id BIGSERIAL PRIMARY KEY,
    entry_date DATE NOT NULL,
    entry_type TEXT NOT NULL CHECK (entry_type IN ('income','expense','transfer')),
    category TEXT NOT NULL, -- 'supplier_payment','customer_receipt','salary','rent','tax','other'
    description TEXT NOT NULL,
    amount NUMERIC(16,2) NOT NULL,
    currency TEXT NOT NULL DEFAULT 'VND',
    exchange_rate NUMERIC(10,4) DEFAULT 1,
    amount_vnd NUMERIC(16,2) NOT NULL,
    balance_after NUMERIC(16,2),
    payment_method TEXT, -- 'bank_transfer','cash','check'
    bank_ref TEXT,
    ref_type TEXT, -- 'ap','ar','po','invoice'
    ref_id BIGINT,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cb_date ON cash_book(entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_cb_type ON cash_book(entry_type);
CREATE INDEX IF NOT EXISTS idx_cb_category ON cash_book(category);
CREATE INDEX IF NOT EXISTS idx_cb_ref ON cash_book(ref_type, ref_id);

-- budget_targets: monthly budget targets per category
CREATE TABLE IF NOT EXISTS budget_targets (
    id BIGSERIAL PRIMARY KEY,
    year INT NOT NULL,
    month INT NOT NULL CHECK (month BETWEEN 1 AND 12),
    category TEXT NOT NULL,
    budget_amount NUMERIC(16,2) NOT NULL,
    actual_amount NUMERIC(16,2) DEFAULT 0,
    notes TEXT,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(year, month, category)
);
CREATE INDEX IF NOT EXISTS idx_bt_year_month ON budget_targets(year, month);

-- crm_contacts: customer contacts (people at Samsung, LG, etc)
CREATE TABLE IF NOT EXISTS crm_contacts (
    id BIGSERIAL PRIMARY KEY,
    customer_id BIGINT REFERENCES customers(id),
    full_name TEXT NOT NULL,
    position TEXT,
    department TEXT,
    email TEXT,
    phone TEXT,
    is_primary BOOLEAN DEFAULT false,
    notes TEXT,
    last_contacted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_crmc_customer ON crm_contacts(customer_id);
CREATE INDEX IF NOT EXISTS idx_crmc_email ON crm_contacts(email);

-- crm_interactions: log of customer interactions
CREATE TABLE IF NOT EXISTS crm_interactions (
    id BIGSERIAL PRIMARY KEY,
    customer_id BIGINT NOT NULL REFERENCES customers(id),
    contact_id BIGINT REFERENCES crm_contacts(id),
    interaction_type TEXT NOT NULL CHECK (interaction_type IN ('email','call','meeting','visit','other')),
    subject TEXT NOT NULL,
    notes TEXT,
    outcome TEXT,
    follow_up_date DATE,
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_crmi_customer ON crm_interactions(customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crmi_follow_up ON crm_interactions(follow_up_date) WHERE follow_up_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_crmi_type ON crm_interactions(interaction_type);
