-- Dashboards table for Dynamic Dashboard feature
-- Stores immutable dashboard definitions with uiTree

CREATE TABLE IF NOT EXISTS dashboards (
    id TEXT NOT NULL PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,  -- ISO 8601 datetime
    metadata TEXT NOT NULL DEFAULT '{}',  -- JSON
    ui_tree_version TEXT NOT NULL,
    ui_tree_version_major INTEGER NOT NULL,  -- denormalized for semver compat queries
    ui_tree TEXT NOT NULL DEFAULT '{}'  -- JSON
);

CREATE INDEX IF NOT EXISTS idx_dashboards_created_at ON dashboards(created_at);
CREATE INDEX IF NOT EXISTS idx_dashboards_ui_tree_version_major ON dashboards(ui_tree_version_major);
CREATE INDEX IF NOT EXISTS idx_dashboards_name ON dashboards(name);
