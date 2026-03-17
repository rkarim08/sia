-- graph.db initial schema (ARCHI v4.1 section 2.4)
-- Full bi-temporal model for entities and edges.

-- -----------------------------------------------------------------
-- ENTITIES
-- Full bi-temporal model: both t_valid_from and t_valid_until apply
-- to entities, not just to edges. When a Decision entity is
-- superseded, it is invalidated (t_valid_until set) rather than
-- soft-deleted (archived_at set). archived_at is reserved for
-- low-importance entities that have simply decayed out of relevance.
-- -----------------------------------------------------------------
CREATE TABLE entities (
  id               TEXT PRIMARY KEY,    -- UUID v4

  -- Classification
  type             TEXT NOT NULL,
    -- 'CodeEntity' | 'Concept' | 'Decision' | 'Bug'
    -- 'Solution' | 'Convention' | 'Community'
  name             TEXT NOT NULL,
  content          TEXT NOT NULL,       -- Full description (max ~500 words)
  summary          TEXT NOT NULL,       -- One sentence (max 20 words)

  -- Monorepo package scoping
  package_path     TEXT,               -- e.g. 'packages/frontend'; NULL for standalone

  -- Tags and file associations
  tags             TEXT NOT NULL DEFAULT '[]',        -- JSON string[]
  file_paths       TEXT NOT NULL DEFAULT '[]',        -- JSON string[] (relative paths)

  -- Trust and confidence
  trust_tier       INTEGER NOT NULL DEFAULT 3,
    -- 1=UserDirect(x1.00) 2=CodeAnalysis(x0.90) 3=LLMInferred(x0.70) 4=External(x0.50)
  confidence       REAL NOT NULL DEFAULT 0.7,
  base_confidence  REAL NOT NULL DEFAULT 0.7,

  -- Importance (retrieval ranking + decay)
  importance       REAL NOT NULL DEFAULT 0.5,
  base_importance  REAL NOT NULL DEFAULT 0.5,
  access_count     INTEGER NOT NULL DEFAULT 0,
  edge_count       INTEGER NOT NULL DEFAULT 0,    -- denormalized; maintained by trigger
  last_accessed    INTEGER NOT NULL,              -- Unix ms
  created_at       INTEGER NOT NULL,              -- Unix ms

  -- *** FULL BI-TEMPORAL METADATA ON ENTITIES ***
  t_created        INTEGER NOT NULL,   -- Unix ms: when Sia recorded this entity
  t_expired        INTEGER,            -- Unix ms: when Sia invalidated it
  t_valid_from     INTEGER,            -- Unix ms: when the fact became true in the world
  t_valid_until    INTEGER,            -- Unix ms: when it stopped being true (NULL = still true)

  -- Team visibility
  visibility       TEXT NOT NULL DEFAULT 'private',   -- 'private' | 'team' | 'project'
  created_by       TEXT NOT NULL,                     -- developer_id from sync_config
  workspace_scope  TEXT,                              -- workspace_id when visibility='project'

  -- Sync metadata
  hlc_created      INTEGER,
  hlc_modified     INTEGER,
  synced_at        INTEGER,           -- NULL = not yet pushed to server

  -- Conflict tracking
  conflict_group_id TEXT,

  -- Provenance
  source_episode    TEXT,             -- episodic.episodes.id (cross-db ref, not enforced)
  extraction_method TEXT,
    -- 'tree-sitter' | 'spacy' | 'llm-haiku' | 'user-direct' | 'manifest'
  extraction_model  TEXT,            -- model version string if LLM-extracted

  -- Embedding (384-dim from all-MiniLM-L6-v2)
  embedding        BLOB,

  -- Soft delete for low-importance, disconnected, decayed entities
  archived_at      INTEGER            -- NULL = active
);

-- -----------------------------------------------------------------
-- FTS5 content table -- kept in sync via triggers
-- -----------------------------------------------------------------
CREATE VIRTUAL TABLE entities_fts USING fts5(
  name, content, summary, tags,
  content=entities,
  content_rowid=rowid
);

-- Triggers to keep entities_fts in sync
CREATE TRIGGER entities_ai AFTER INSERT ON entities BEGIN
  INSERT INTO entities_fts(rowid, name, content, summary, tags)
  VALUES (new.rowid, new.name, new.content, new.summary, new.tags);
END;
CREATE TRIGGER entities_ad AFTER DELETE ON entities BEGIN
  INSERT INTO entities_fts(entities_fts, rowid, name, content, summary, tags)
  VALUES ('delete', old.rowid, old.name, old.content, old.summary, old.tags);
END;
CREATE TRIGGER entities_au AFTER UPDATE ON entities BEGIN
  INSERT INTO entities_fts(entities_fts, rowid, name, content, summary, tags)
  VALUES ('delete', old.rowid, old.name, old.content, old.summary, old.tags);
  INSERT INTO entities_fts(rowid, name, content, summary, tags)
  VALUES (new.rowid, new.name, new.content, new.summary, new.tags);
END;

-- entities_vss (sqlite-vss) created at runtime when extension is loaded

-- -----------------------------------------------------------------
-- Entity indexes
-- -----------------------------------------------------------------
CREATE INDEX idx_entities_type       ON entities(type) WHERE archived_at IS NULL AND t_valid_until IS NULL;
CREATE INDEX idx_entities_package    ON entities(package_path) WHERE archived_at IS NULL;
CREATE INDEX idx_entities_importance ON entities(importance DESC) WHERE archived_at IS NULL AND t_valid_until IS NULL;
CREATE INDEX idx_entities_trust      ON entities(trust_tier, confidence);
CREATE INDEX idx_entities_visibility ON entities(visibility, synced_at);
CREATE INDEX idx_entities_accessed   ON entities(last_accessed DESC);
CREATE INDEX idx_entities_temporal   ON entities(t_valid_from, t_valid_until);
CREATE INDEX idx_entities_conflict   ON entities(conflict_group_id) WHERE conflict_group_id IS NOT NULL;

-- -----------------------------------------------------------------
-- EDGES (bi-temporal, typed, weighted)
-- -----------------------------------------------------------------
CREATE TABLE edges (
  id            TEXT PRIMARY KEY,
  from_id       TEXT NOT NULL REFERENCES entities(id),
  to_id         TEXT NOT NULL REFERENCES entities(id),
  type          TEXT NOT NULL,
    -- Structural (from AST):
    --   'calls' | 'imports' | 'inherits_from' | 'contains' | 'depends_on'
    -- Semantic (from LLM extraction):
    --   'relates_to' | 'solves' | 'caused_by' | 'supersedes'
    --   'elaborates' | 'contradicts' | 'used_in'
    -- Community (from Leiden):
    --   'member_of' | 'summarized_by'
  weight        REAL NOT NULL DEFAULT 1.0,
  confidence    REAL NOT NULL DEFAULT 0.7,
  trust_tier    INTEGER NOT NULL DEFAULT 3,

  -- Bi-temporal metadata
  t_created     INTEGER NOT NULL,
  t_expired     INTEGER,
  t_valid_from  INTEGER,
  t_valid_until INTEGER,            -- NULL = still active

  -- Sync metadata
  hlc_created   INTEGER,
  hlc_modified  INTEGER,

  source_episode    TEXT,
  extraction_method TEXT
);

CREATE INDEX idx_edges_from     ON edges(from_id) WHERE t_valid_until IS NULL;
CREATE INDEX idx_edges_to       ON edges(to_id)   WHERE t_valid_until IS NULL;
CREATE INDEX idx_edges_type     ON edges(type);
CREATE INDEX idx_edges_temporal ON edges(t_valid_from, t_valid_until);

-- -----------------------------------------------------------------
-- Edge count triggers
-- -----------------------------------------------------------------

-- Insert trigger: increment edge_count on both endpoints when a new active edge is created
CREATE TRIGGER edges_ai_count AFTER INSERT ON edges
  WHEN new.t_valid_until IS NULL
BEGIN
  UPDATE entities SET edge_count = edge_count + 1 WHERE id = new.from_id;
  UPDATE entities SET edge_count = edge_count + 1 WHERE id = new.to_id;
END;

-- Invalidation trigger: decrement when edge goes from active -> invalidated
CREATE TRIGGER edges_au_count_invalidate
  AFTER UPDATE OF t_valid_until ON edges
  WHEN old.t_valid_until IS NULL AND new.t_valid_until IS NOT NULL
BEGIN
  UPDATE entities SET edge_count = edge_count - 1 WHERE id = new.from_id;
  UPDATE entities SET edge_count = edge_count - 1 WHERE id = new.to_id;
END;

-- Reactivation trigger: increment when edge goes from invalidated -> active
CREATE TRIGGER edges_au_count_reactivate
  AFTER UPDATE OF t_valid_until ON edges
  WHEN old.t_valid_until IS NOT NULL AND new.t_valid_until IS NULL
BEGIN
  UPDATE entities SET edge_count = edge_count + 1 WHERE id = new.from_id;
  UPDATE entities SET edge_count = edge_count + 1 WHERE id = new.to_id;
END;

-- -----------------------------------------------------------------
-- COMMUNITIES AND SUMMARY TREE
-- -----------------------------------------------------------------
CREATE TABLE communities (
  id                        TEXT PRIMARY KEY,
  level                     INTEGER NOT NULL,    -- 0=fine, 1=medium, 2=coarse
  parent_id                 TEXT REFERENCES communities(id),
  summary                   TEXT,
  summary_hash              TEXT,                -- SHA-256 of sorted member entity IDs
  member_count              INTEGER DEFAULT 0,
  last_summary_member_count INTEGER DEFAULT 0,  -- member_count at time of last summary generation
  package_path              TEXT,               -- NULL=whole repo; set=monorepo package
  created_at                INTEGER NOT NULL,
  updated_at                INTEGER NOT NULL
);

CREATE TABLE community_members (
  community_id TEXT NOT NULL REFERENCES communities(id),
  entity_id    TEXT NOT NULL REFERENCES entities(id),
  level        INTEGER NOT NULL,
  PRIMARY KEY (community_id, entity_id)
);

CREATE TABLE summary_tree (
  id           TEXT PRIMARY KEY,
  level        INTEGER NOT NULL,   -- 0=raw entity, 1=entity summary, 2=module, 3=architectural
  scope_id     TEXT NOT NULL,      -- entity_id (levels 0-1) | community_id (levels 2-3)
  content      TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  token_count  INTEGER NOT NULL,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER             -- NULL = valid; set when source facts change
);

-- -----------------------------------------------------------------
-- SECURITY STAGING
-- Physically isolated: no FK relationships to entities or edges.
-- -----------------------------------------------------------------
CREATE TABLE memory_staging (
  id                   TEXT PRIMARY KEY,
  source_episode       TEXT,
  proposed_type        TEXT NOT NULL,
  proposed_name        TEXT NOT NULL,
  proposed_content     TEXT NOT NULL,
  proposed_tags        TEXT NOT NULL DEFAULT '[]',
  proposed_file_paths  TEXT NOT NULL DEFAULT '[]',
  trust_tier           INTEGER NOT NULL DEFAULT 4,
  raw_confidence       REAL NOT NULL,
  validation_status    TEXT NOT NULL DEFAULT 'pending',
    -- 'pending' | 'passed' | 'rejected' | 'quarantined'
  rejection_reason     TEXT,
  created_at           INTEGER NOT NULL,
  expires_at           INTEGER NOT NULL  -- created_at + (7 * 86400000)
);

-- -----------------------------------------------------------------
-- SESSION FLAGS AND AUDIT LOG
-- -----------------------------------------------------------------
CREATE TABLE session_flags (
  id                  TEXT PRIMARY KEY,
  session_id          TEXT NOT NULL,
  reason              TEXT NOT NULL,        -- sanitized, max 100 chars
  transcript_position INTEGER,
  created_at          INTEGER NOT NULL,
  consumed            INTEGER NOT NULL DEFAULT 0   -- 1 = pipeline processed this flag
);
CREATE INDEX idx_flags_session ON session_flags(session_id, consumed);

CREATE TABLE audit_log (
  id               TEXT PRIMARY KEY,
  ts               INTEGER NOT NULL,
  hlc              INTEGER,
  operation        TEXT NOT NULL,
    -- 'ADD' | 'UPDATE' | 'INVALIDATE' | 'NOOP'
    -- 'STAGE' | 'PROMOTE' | 'QUARANTINE'
    -- 'SYNC_RECV' | 'SYNC_SEND'
    -- 'ARCHIVE' | 'VSS_REFRESH'
  entity_id        TEXT,
  edge_id          TEXT,
  source_episode   TEXT,
  trust_tier       INTEGER,
  extraction_method TEXT,
  source_hash      TEXT,                    -- SHA-256 of raw source content
  developer_id     TEXT,
  snapshot_id      TEXT
);

-- -----------------------------------------------------------------
-- DEDUPLICATION LOGS
-- Two separate tables for two separate processes (Issue #21).
-- -----------------------------------------------------------------

-- local_dedup_log: nightly consolidation sweep (intra-developer, local graph only)
CREATE TABLE local_dedup_log (
  entity_a_id TEXT NOT NULL,
  entity_b_id TEXT NOT NULL,
  decision    TEXT NOT NULL,   -- 'merged' | 'different' | 'related' | 'pending'
  checked_at  INTEGER NOT NULL,
  PRIMARY KEY (entity_a_id, entity_b_id)
);

-- sync_dedup_log: post-sync deduplication (cross-developer; peer_id disambiguates source)
CREATE TABLE sync_dedup_log (
  entity_a_id  TEXT NOT NULL,   -- local entity
  entity_b_id  TEXT NOT NULL,   -- peer entity
  peer_id      TEXT NOT NULL,   -- which teammate this came from
  decision     TEXT NOT NULL,   -- 'merged' | 'different' | 'related' | 'pending'
  checked_at   INTEGER NOT NULL,
  PRIMARY KEY (entity_a_id, entity_b_id, peer_id)
);
