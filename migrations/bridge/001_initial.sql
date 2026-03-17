-- Cross-repo edges only. Never contains intra-repo edges.
-- Full bi-temporal model matches the per-repo edges table.
CREATE TABLE cross_repo_edges (
  id               TEXT PRIMARY KEY,
  source_repo_id   TEXT NOT NULL,
  source_entity_id TEXT NOT NULL,
  target_repo_id   TEXT NOT NULL,
  target_entity_id TEXT NOT NULL,
  type             TEXT NOT NULL,
    -- 'calls_api' | 'depends_on' | 'shares_type' | 'references'
  weight           REAL NOT NULL DEFAULT 1.0,
  confidence       REAL NOT NULL DEFAULT 0.9,
  trust_tier       INTEGER NOT NULL DEFAULT 2,
  properties       TEXT,           -- JSON metadata (HTTP method, endpoint path, etc.)

  -- Full bi-temporal metadata (matches per-repo edges)
  t_created        INTEGER NOT NULL,    -- Unix ms: when recorded in Sia
  t_expired        INTEGER,             -- Unix ms: when Sia invalidated this edge
  t_valid_from     INTEGER,             -- Unix ms: when this cross-repo relationship began
  t_valid_until    INTEGER,             -- Unix ms: when it ended (NULL = still active)

  -- Sync metadata (HLC values read back as BigInt via hlcFromDb() helper)
  hlc_created      INTEGER,
  hlc_modified     INTEGER,

  -- Provenance
  created_by       TEXT               -- developer_id or 'auto-detect'
);

CREATE INDEX idx_bridge_source ON cross_repo_edges(source_repo_id, source_entity_id)
  WHERE t_valid_until IS NULL;
CREATE INDEX idx_bridge_target ON cross_repo_edges(target_repo_id, target_entity_id)
  WHERE t_valid_until IS NULL;
CREATE INDEX idx_bridge_temporal ON cross_repo_edges(t_valid_from, t_valid_until);
