-- Migration 007: branch-keyed snapshots for fast branch switching
--
-- Stores graph snapshots per branch so that switching back to a
-- previously-analyzed branch restores its state without a full rebuild.
-- Each branch gets exactly one snapshot (UPSERT on branch_name).

CREATE TABLE IF NOT EXISTS branch_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    branch_name TEXT NOT NULL UNIQUE,
    commit_hash TEXT NOT NULL,
    node_count INTEGER NOT NULL DEFAULT 0,
    edge_count INTEGER NOT NULL DEFAULT 0,
    snapshot_data TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS idx_branch_snapshots_branch
    ON branch_snapshots(branch_name);

CREATE INDEX IF NOT EXISTS idx_branch_snapshots_updated
    ON branch_snapshots(updated_at);
