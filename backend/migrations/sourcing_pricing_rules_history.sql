-- Audit history for sourcing_pricing_rules — captures old/new values + actor + summary
-- per every upsert. Read-only ledger; never mutated by app code, never auto-deleted.
-- Thang 2026-06-14.

CREATE TABLE IF NOT EXISTS sourcing_pricing_rules_history (
    id BIGSERIAL PRIMARY KEY,
    rule_item_type   TEXT NOT NULL,
    old_values       JSONB NOT NULL,
    new_values       JSONB NOT NULL,
    changed_at       TIMESTAMPTZ DEFAULT NOW(),
    changed_by_id    BIGINT,
    changed_by_email TEXT,
    change_summary   TEXT
);

-- Lookup for "last N changes of this rule" — endpoint reads
-- WHERE rule_item_type = $1 ORDER BY changed_at DESC LIMIT 50.
CREATE INDEX IF NOT EXISTS idx_pricing_rules_history_item
    ON sourcing_pricing_rules_history (rule_item_type, changed_at DESC);

COMMENT ON TABLE sourcing_pricing_rules_history IS
    'Audit ledger cho sourcing_pricing_rules — mỗi upsert insert 1 row với old/new JSONB diff';
COMMENT ON COLUMN sourcing_pricing_rules_history.old_values IS
    'Snapshot toàn bộ row trước UPDATE — {} nếu là INSERT (rule mới)';
COMMENT ON COLUMN sourcing_pricing_rules_history.new_values IS
    'Snapshot toàn bộ row sau UPSERT';
COMMENT ON COLUMN sourcing_pricing_rules_history.change_summary IS
    'Tóm tắt thay đổi dạng "markup_pct: 1.4 -> 1.5; tax_pct: 10 -> 8" — render nhanh ở UI';
