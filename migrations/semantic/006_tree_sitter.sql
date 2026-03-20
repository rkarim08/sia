-- Migration 006: tree-sitter extraction backend tracking
-- Note: entities was renamed to graph_nodes in migration 004.
ALTER TABLE graph_nodes ADD COLUMN extraction_backend TEXT;
