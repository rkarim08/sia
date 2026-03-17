CREATE TABLE repos (
  id                TEXT PRIMARY KEY,    -- sha256 of resolved absolute path
  path              TEXT NOT NULL UNIQUE,
  name              TEXT,
  detected_type     TEXT,                -- 'standalone'|'monorepo_root'|'monorepo_package'
  monorepo_root_id  TEXT REFERENCES repos(id),
  created_at        INTEGER NOT NULL,    -- Unix ms
  last_accessed     INTEGER
);

CREATE TABLE workspaces (
  id         TEXT PRIMARY KEY,           -- UUID v4
  name       TEXT NOT NULL UNIQUE,       -- human name; user-facing commands resolve name->id
  created_at INTEGER NOT NULL
);

CREATE TABLE workspace_repos (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  repo_id      TEXT NOT NULL REFERENCES repos(id),
  role         TEXT DEFAULT 'member',    -- 'member' | 'primary'
  PRIMARY KEY (workspace_id, repo_id)
);

-- API contracts between repos (from .sia-manifest.yaml or auto-detection)
-- contract_type covers both code-level and project-manifest relationships
CREATE TABLE api_contracts (
  id               TEXT PRIMARY KEY,
  provider_repo_id TEXT NOT NULL REFERENCES repos(id),
  consumer_repo_id TEXT NOT NULL REFERENCES repos(id),
  contract_type    TEXT NOT NULL,
    -- 'openapi' | 'graphql' | 'trpc' | 'grpc'
    -- 'npm-package' | 'ts-reference' | 'csproj-reference'
    -- 'cargo-dependency' | 'go-mod-replace' | 'python-path-dep' | 'gradle-project'
  spec_path        TEXT,                 -- relative to provider repo root (if applicable)
  trust_tier       INTEGER DEFAULT 2,   -- 1=declared in manifest, 2=auto-detected
  detected_at      INTEGER NOT NULL,
  confidence       REAL DEFAULT 1.0
);

-- Team sync configuration (written by 'npx sia team join', read on every startup)
-- Auth token is NOT stored here — it lives in the OS keychain
CREATE TABLE sync_config (
  id           TEXT PRIMARY KEY DEFAULT 'default',
  server_url   TEXT,
  enabled      INTEGER NOT NULL DEFAULT 0,  -- 0=local-only
  developer_id TEXT,                        -- stable UUID for this device
  last_sync_at INTEGER                      -- Unix ms of last successful sync
);

-- One row per known teammate device
CREATE TABLE sync_peers (
  peer_id       TEXT PRIMARY KEY,
  display_name  TEXT,
  last_seen_hlc INTEGER,  -- HLC of last received changeset from this peer
  last_seen_at  INTEGER   -- Unix ms
);

-- Sharing rules: which entity types auto-promote to which visibility in which workspace.
-- Stored in meta.db (not graph.db) so they apply workspace-wide regardless of which
-- repo a developer captured a fact in. Synced to teammates as workspace metadata.
CREATE TABLE sharing_rules (
  id                 TEXT PRIMARY KEY,
  workspace_id       TEXT REFERENCES workspaces(id),  -- NULL = all workspaces
  entity_type        TEXT,                            -- NULL = all types
  default_visibility TEXT NOT NULL,                   -- 'private'|'team'|'project'
  created_by         TEXT,
  created_at         INTEGER NOT NULL
);
