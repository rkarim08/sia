-- Migration: 004_v5_unified_schema.sql
-- Rename entities->graph_nodes and edges->graph_edges,
-- add v5 columns, session tables, and rebuild FTS5 + triggers.

-- -----------------------------------------------------------------
-- Step A: Rename tables
-- -----------------------------------------------------------------
ALTER TABLE entities RENAME TO graph_nodes;
ALTER TABLE edges RENAME TO graph_edges;

-- -----------------------------------------------------------------
-- Step B: Add new v5 columns to graph_nodes
-- -----------------------------------------------------------------
ALTER TABLE graph_nodes ADD COLUMN kind TEXT;
ALTER TABLE graph_nodes ADD COLUMN priority_tier INTEGER DEFAULT 3;
ALTER TABLE graph_nodes ADD COLUMN session_id TEXT;
ALTER TABLE graph_nodes ADD COLUMN properties TEXT DEFAULT '{}';

-- -----------------------------------------------------------------
-- Step C: Backfill kind from type
-- -----------------------------------------------------------------
UPDATE graph_nodes SET kind = type WHERE kind IS NULL;

-- -----------------------------------------------------------------
-- Step D: Add session_resume table
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS session_resume (
  session_id    TEXT PRIMARY KEY,
  subgraph_json TEXT NOT NULL,
  last_prompt   TEXT,
  budget_used   INTEGER DEFAULT 0,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

-- -----------------------------------------------------------------
-- Step E: Add search_throttle table
-- -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS search_throttle (
  session_id   TEXT NOT NULL,
  tool_name    TEXT NOT NULL,
  call_count   INTEGER NOT NULL DEFAULT 1,
  last_called_at INTEGER NOT NULL,
  PRIMARY KEY (session_id, tool_name)
);

-- -----------------------------------------------------------------
-- Step F: Add DELETE edge_count trigger
-- -----------------------------------------------------------------
CREATE TRIGGER IF NOT EXISTS trg_edge_count_delete
  AFTER DELETE ON graph_edges
  WHEN OLD.t_valid_until IS NULL
BEGIN
  UPDATE graph_nodes SET edge_count = MAX(0, edge_count - 1) WHERE id = OLD.from_id;
  UPDATE graph_nodes SET edge_count = MAX(0, edge_count - 1) WHERE id = OLD.to_id;
END;

-- -----------------------------------------------------------------
-- Step G: Recreate FTS5 for graph_nodes
-- Drop old FTS5 triggers first (they reference 'entities')
-- -----------------------------------------------------------------
DROP TRIGGER IF EXISTS entities_ai;
DROP TRIGGER IF EXISTS entities_ad;
DROP TRIGGER IF EXISTS entities_au;

-- Drop old FTS5 virtual table
DROP TABLE IF EXISTS entities_fts;

-- Create new FTS5 for graph_nodes
CREATE VIRTUAL TABLE graph_nodes_fts USING fts5(
  name, content, summary, tags,
  content='graph_nodes',
  content_rowid='rowid'
);

-- Rebuild FTS from existing data
INSERT INTO graph_nodes_fts(graph_nodes_fts) VALUES ('rebuild');

-- New FTS sync triggers
CREATE TRIGGER graph_nodes_fts_ai AFTER INSERT ON graph_nodes BEGIN
  INSERT INTO graph_nodes_fts(rowid, name, content, summary, tags)
  VALUES (NEW.rowid, NEW.name, NEW.content, NEW.summary, NEW.tags);
END;

CREATE TRIGGER graph_nodes_fts_ad AFTER DELETE ON graph_nodes BEGIN
  INSERT INTO graph_nodes_fts(graph_nodes_fts, rowid, name, content, summary, tags)
  VALUES ('delete', OLD.rowid, OLD.name, OLD.content, OLD.summary, OLD.tags);
END;

CREATE TRIGGER graph_nodes_fts_au AFTER UPDATE ON graph_nodes BEGIN
  INSERT INTO graph_nodes_fts(graph_nodes_fts, rowid, name, content, summary, tags)
  VALUES ('delete', OLD.rowid, OLD.name, OLD.content, OLD.summary, OLD.tags);
  INSERT INTO graph_nodes_fts(rowid, name, content, summary, tags)
  VALUES (NEW.rowid, NEW.name, NEW.content, NEW.summary, NEW.tags);
END;

-- -----------------------------------------------------------------
-- Step H: Recreate edge_count triggers for graph_nodes/graph_edges
-- Drop old triggers that reference 'entities'/'edges'
-- -----------------------------------------------------------------
DROP TRIGGER IF EXISTS edges_ai_count;
DROP TRIGGER IF EXISTS edges_au_count_invalidate;
DROP TRIGGER IF EXISTS edges_au_count_reactivate;
DROP TRIGGER IF EXISTS trg_edge_count_insert;
DROP TRIGGER IF EXISTS trg_edge_count_invalidate;
DROP TRIGGER IF EXISTS trg_edge_count_reactivate;

CREATE TRIGGER trg_edge_count_insert AFTER INSERT ON graph_edges
  WHEN NEW.t_valid_until IS NULL
BEGIN
  UPDATE graph_nodes SET edge_count = edge_count + 1 WHERE id = NEW.from_id;
  UPDATE graph_nodes SET edge_count = edge_count + 1 WHERE id = NEW.to_id;
END;

CREATE TRIGGER trg_edge_count_invalidate AFTER UPDATE OF t_valid_until ON graph_edges
  WHEN OLD.t_valid_until IS NULL AND NEW.t_valid_until IS NOT NULL
BEGIN
  UPDATE graph_nodes SET edge_count = MAX(0, edge_count - 1) WHERE id = NEW.from_id;
  UPDATE graph_nodes SET edge_count = MAX(0, edge_count - 1) WHERE id = NEW.to_id;
END;

CREATE TRIGGER trg_edge_count_reactivate AFTER UPDATE OF t_valid_until ON graph_edges
  WHEN OLD.t_valid_until IS NOT NULL AND NEW.t_valid_until IS NULL
BEGIN
  UPDATE graph_nodes SET edge_count = edge_count + 1 WHERE id = NEW.from_id;
  UPDATE graph_nodes SET edge_count = edge_count + 1 WHERE id = NEW.to_id;
END;

-- -----------------------------------------------------------------
-- Step I: Drop and recreate triggers from 003_freshness.sql that
-- reference the old 'entities' table name.
-- Also fix the source_deps FK reference and current_entities shadow.
-- -----------------------------------------------------------------

-- Drop old shadow maintenance triggers (they reference 'entities')
DROP TRIGGER IF EXISTS shadow_invalidate;
DROP TRIGGER IF EXISTS shadow_archive;
DROP TRIGGER IF EXISTS shadow_insert;
DROP TRIGGER IF EXISTS shadow_reactivate;

-- Drop old current_entities shadow table (was built from entities)
DROP TABLE IF EXISTS current_entities;

-- Drop old source_deps (FK referenced entities(id), now graph_nodes)
DROP TABLE IF EXISTS source_deps;

-- Recreate source_deps referencing graph_nodes
CREATE TABLE IF NOT EXISTS source_deps (
  source_path  TEXT NOT NULL,
  node_id      TEXT NOT NULL REFERENCES graph_nodes(id),
  dep_type     TEXT NOT NULL,
  source_mtime INTEGER NOT NULL,
  PRIMARY KEY (source_path, node_id)
);

CREATE INDEX IF NOT EXISTS idx_source_deps_path ON source_deps(source_path);
CREATE INDEX IF NOT EXISTS idx_source_deps_node ON source_deps(node_id);

-- Recreate current_entities shadow as current_nodes from graph_nodes
CREATE TABLE IF NOT EXISTS current_nodes AS
  SELECT * FROM graph_nodes
  WHERE t_valid_until IS NULL AND archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_current_type ON current_nodes(type);
CREATE INDEX IF NOT EXISTS idx_current_importance ON current_nodes(importance DESC);

-- Recreate shadow maintenance triggers referencing graph_nodes / current_nodes
CREATE TRIGGER IF NOT EXISTS shadow_invalidate
  AFTER UPDATE OF t_valid_until ON graph_nodes
  WHEN NEW.t_valid_until IS NOT NULL AND OLD.t_valid_until IS NULL
BEGIN
  DELETE FROM current_nodes WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS shadow_archive
  AFTER UPDATE OF archived_at ON graph_nodes
  WHEN NEW.archived_at IS NOT NULL AND OLD.archived_at IS NULL
BEGIN
  DELETE FROM current_nodes WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS shadow_insert
  AFTER INSERT ON graph_nodes
  WHEN NEW.t_valid_until IS NULL AND NEW.archived_at IS NULL
BEGIN
  INSERT INTO current_nodes SELECT * FROM graph_nodes WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS shadow_reactivate
  AFTER UPDATE OF t_valid_until ON graph_nodes
  WHEN NEW.t_valid_until IS NULL AND OLD.t_valid_until IS NOT NULL
BEGIN
  INSERT OR REPLACE INTO current_nodes SELECT * FROM graph_nodes WHERE id = NEW.id;
END;
