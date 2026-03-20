-- Migration 006: tree-sitter extraction backend tracking
-- Note: entities was renamed to graph_nodes in migration 004.
-- current_nodes is a shadow table maintained by triggers (SELECT * FROM graph_nodes),
-- so it must also get the new column to keep column counts in sync.
ALTER TABLE graph_nodes ADD COLUMN extraction_backend TEXT;
ALTER TABLE current_nodes ADD COLUMN extraction_backend TEXT;
