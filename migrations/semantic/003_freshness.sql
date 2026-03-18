-- Phase 15: Freshness Engine — source_deps inverted index + current_entities shadow table

-- Maps each source file to every graph node derived from it.
-- When file X changes, SELECT node_id FROM source_deps WHERE source_path = X
-- returns the exact set of nodes that may be stale.
CREATE TABLE IF NOT EXISTS source_deps (
  source_path  TEXT NOT NULL,
  node_id      TEXT NOT NULL REFERENCES entities(id),
  dep_type     TEXT NOT NULL,
  source_mtime INTEGER NOT NULL,
  PRIMARY KEY (source_path, node_id)
);

CREATE INDEX IF NOT EXISTS idx_source_deps_path ON source_deps(source_path);
CREATE INDEX IF NOT EXISTS idx_source_deps_node ON source_deps(node_id);

-- Shadow table: contains ONLY active, non-archived entities.
-- Eliminates the temporal predicate from the most common query pattern.
CREATE TABLE IF NOT EXISTS current_entities AS
  SELECT * FROM entities
  WHERE t_valid_until IS NULL AND archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_current_type ON current_entities(type);
CREATE INDEX IF NOT EXISTS idx_current_importance ON current_entities(importance DESC);

-- Shadow maintenance triggers
CREATE TRIGGER IF NOT EXISTS shadow_invalidate
  AFTER UPDATE OF t_valid_until ON entities
  WHEN new.t_valid_until IS NOT NULL AND old.t_valid_until IS NULL
BEGIN
  DELETE FROM current_entities WHERE id = new.id;
END;

CREATE TRIGGER IF NOT EXISTS shadow_archive
  AFTER UPDATE OF archived_at ON entities
  WHEN new.archived_at IS NOT NULL AND old.archived_at IS NULL
BEGIN
  DELETE FROM current_entities WHERE id = new.id;
END;

CREATE TRIGGER IF NOT EXISTS shadow_insert
  AFTER INSERT ON entities
  WHEN new.t_valid_until IS NULL AND new.archived_at IS NULL
BEGIN
  INSERT INTO current_entities SELECT * FROM entities WHERE id = new.id;
END;

CREATE TRIGGER IF NOT EXISTS shadow_reactivate
  AFTER UPDATE OF t_valid_until ON entities
  WHEN new.t_valid_until IS NULL AND old.t_valid_until IS NOT NULL
BEGIN
  INSERT OR REPLACE INTO current_entities SELECT * FROM entities WHERE id = new.id;
END;

-- Partial indexes for hot-path queries
CREATE INDEX IF NOT EXISTS idx_entities_type_active ON entities(type)
  WHERE archived_at IS NULL AND t_valid_until IS NULL;
CREATE INDEX IF NOT EXISTS idx_entities_importance_active ON entities(importance DESC)
  WHERE archived_at IS NULL AND t_valid_until IS NULL;
CREATE INDEX IF NOT EXISTS idx_edges_from_active ON edges(from_id)
  WHERE t_valid_until IS NULL;
CREATE INDEX IF NOT EXISTS idx_edges_to_active ON edges(to_id)
  WHERE t_valid_until IS NULL;
