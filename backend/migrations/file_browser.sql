-- =============================================================================
-- File Browser Module — Song Châu ERP
-- Migration: file_browser.sql
-- Creates: system_settings, onedrive_file_index
-- =============================================================================

-- ---------------------------------------------------------------------------
-- system_settings: key-value admin configuration
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS system_settings (
    key         TEXT PRIMARY KEY,
    value       JSONB NOT NULL DEFAULT '{}',
    updated_by  UUID REFERENCES users(id),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO system_settings (key, value)
VALUES ('onedrive_sync_direction', '{"enabled": false}')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- onedrive_file_index: metadata index for ~95K OneDrive files
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS onedrive_file_index (
    id                  BIGSERIAL PRIMARY KEY,

    -- MS Graph identifiers
    graph_item_id       TEXT NOT NULL UNIQUE,
    graph_parent_id     TEXT,

    -- File metadata
    name                TEXT NOT NULL,
    file_path           TEXT NOT NULL,
    file_extension      TEXT,
    file_size           BIGINT NOT NULL DEFAULT 0,
    mime_type           TEXT,

    -- Flags
    is_folder           BOOLEAN NOT NULL DEFAULT false,

    -- Timestamps from OneDrive
    remote_created_at   TIMESTAMPTZ,
    remote_modified_at  TIMESTAMPTZ,

    -- Local cache status
    is_cached           BOOLEAN NOT NULL DEFAULT false,
    local_path          TEXT,
    cached_at           TIMESTAMPTZ,
    cache_size          BIGINT DEFAULT 0,

    -- Sync metadata
    sync_status         TEXT NOT NULL DEFAULT 'indexed',
    last_synced_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    etag                TEXT,

    -- Conversion cache (for CAD files)
    converted_path      TEXT,
    converted_at        TIMESTAMPTZ,

    -- Trigram search column
    name_trgm           TEXT GENERATED ALWAYS AS (lower(name)) STORED,

    -- Timestamps
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Primary lookup indexes
CREATE INDEX IF NOT EXISTS idx_ofi_parent
    ON onedrive_file_index(graph_parent_id);

CREATE INDEX IF NOT EXISTS idx_ofi_path
    ON onedrive_file_index(file_path);

CREATE INDEX IF NOT EXISTS idx_ofi_extension
    ON onedrive_file_index(file_extension);

CREATE INDEX IF NOT EXISTS idx_ofi_folder
    ON onedrive_file_index(is_folder, graph_parent_id);

CREATE INDEX IF NOT EXISTS idx_ofi_cached
    ON onedrive_file_index(is_cached) WHERE is_cached = true;

CREATE INDEX IF NOT EXISTS idx_ofi_sync_status
    ON onedrive_file_index(sync_status);

-- Trigram index for fuzzy file name search (requires pg_trgm extension)
CREATE INDEX IF NOT EXISTS idx_ofi_name_trgm
    ON onedrive_file_index USING gin(name_trgm gin_trgm_ops);

-- Full-text search index
CREATE INDEX IF NOT EXISTS idx_ofi_name_fts
    ON onedrive_file_index USING gin(to_tsvector('simple', name));

-- Cache management: sort by last access for LRU eviction
CREATE INDEX IF NOT EXISTS idx_ofi_cache_lru
    ON onedrive_file_index(cached_at ASC) WHERE is_cached = true;

-- Cache size calculation
CREATE INDEX IF NOT EXISTS idx_ofi_cache_size
    ON onedrive_file_index(cache_size DESC) WHERE is_cached = true;
