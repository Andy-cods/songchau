-- =============================================================================
-- Phase 5: UX & Productivity — Song Châu ERP
-- Migration: phase5_ux.sql
-- Modules: M12 Document Management, M23 Security Log,
--          M24 Excel Export, M25 Batch Operations,
--          M26 User Guide, M28 User Activity Log
-- =============================================================================

-- ---------------------------------------------------------------------------
-- documents: file/document management with versioning
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS documents (
    id          BIGSERIAL PRIMARY KEY,
    title       TEXT NOT NULL,
    description TEXT,
    file_path   TEXT NOT NULL,
    file_name   TEXT NOT NULL,
    file_size   BIGINT,
    mime_type   TEXT,
    -- 'contract','invoice','po','rfq','report','sop','general','other'
    category    TEXT DEFAULT 'general',
    tags        TEXT[] DEFAULT '{}',
    uploaded_by UUID NOT NULL REFERENCES users(id),
    is_public   BOOLEAN DEFAULT false,
    version     INT DEFAULT 1,
    parent_id   BIGINT REFERENCES documents(id), -- versioning chain
    ref_type    TEXT,   -- e.g. 'purchase_orders', 'bqms_rfq', 'suppliers'
    ref_id      BIGINT, -- FK to the linked entity
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_doc_category ON documents(category);
CREATE INDEX IF NOT EXISTS idx_doc_ref      ON documents(ref_type, ref_id);
CREATE INDEX IF NOT EXISTS idx_doc_user     ON documents(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_doc_title    ON documents USING gin(to_tsvector('simple', title));

-- ---------------------------------------------------------------------------
-- security_log: detailed security audit trail
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS security_log (
    id          BIGSERIAL PRIMARY KEY,
    -- 'login','logout','login_failed','password_change','role_change',
    -- 'permission_denied','suspicious_activity','token_refresh'
    event_type  TEXT NOT NULL,
    user_id     UUID REFERENCES users(id),
    ip_address  INET,
    user_agent  TEXT,
    details     JSONB DEFAULT '{}',
    severity    TEXT DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_seclog_type    ON security_log(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_seclog_user    ON security_log(user_id);
CREATE INDEX IF NOT EXISTS idx_seclog_sev     ON security_log(severity, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_seclog_ip      ON security_log(ip_address);

-- ---------------------------------------------------------------------------
-- user_activity_log: front-end page views, button clicks, exports, searches
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_activity_log (
    id          BIGSERIAL PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES users(id),
    -- 'page_view','button_click','export','search','create','update','delete'
    action      TEXT NOT NULL,
    page        TEXT,
    entity_type TEXT,
    entity_id   BIGINT,
    metadata    JSONB DEFAULT '{}',
    session_id  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ual_user   ON user_activity_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ual_action ON user_activity_log(action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ual_page   ON user_activity_log(page, created_at DESC);

-- ---------------------------------------------------------------------------
-- help_articles: knowledge base / user guides (Markdown content)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS help_articles (
    id           BIGSERIAL PRIMARY KEY,
    title        TEXT NOT NULL,
    slug         TEXT NOT NULL UNIQUE,
    content      TEXT NOT NULL,  -- Markdown
    category     TEXT DEFAULT 'general',
    order_index  INT DEFAULT 0,
    is_published BOOLEAN DEFAULT true,
    created_by   UUID REFERENCES users(id),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_help_slug     ON help_articles(slug);
CREATE INDEX IF NOT EXISTS idx_help_category ON help_articles(category, order_index);

-- ---------------------------------------------------------------------------
-- Seed: first-login onboarding article
-- ---------------------------------------------------------------------------
INSERT INTO help_articles (title, slug, content, category, order_index, is_published)
VALUES (
    'Hướng dẫn bắt đầu sử dụng Song Châu ERP',
    'first-login-guide',
    E'# Chào mừng đến với Song Châu ERP\n\n'
    '## Bước 1: Đổi mật khẩu\nSau khi đăng nhập lần đầu, vui lòng vào **Cài đặt → Bảo mật** để đổi mật khẩu.\n\n'
    '## Bước 2: Cập nhật thông tin cá nhân\nVào **Hồ sơ** để cập nhật tên hiển thị và thông tin liên hệ.\n\n'
    '## Bước 3: Khám phá các tính năng\n- **Dashboard**: Tổng quan hoạt động hàng ngày\n'
    '- **Mua hàng**: Tạo và theo dõi đơn mua hàng\n'
    '- **Kho**: Quản lý tồn kho và nhập xuất\n'
    '- **Bán hàng**: Tạo báo giá và đơn bán hàng\n'
    '- **Tài chính**: Quản lý hóa đơn và thanh toán\n\n'
    '## Hỗ trợ\nNếu cần hỗ trợ, liên hệ phòng IT hoặc xem thêm các bài viết trong mục **Hướng dẫn**.',
    'onboarding',
    0,
    true
)
ON CONFLICT (slug) DO NOTHING;
