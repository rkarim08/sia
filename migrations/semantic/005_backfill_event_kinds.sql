-- Migration 005: Backfill event node kinds
-- Reclassifies existing CodeEntity nodes whose names follow event prefixes
-- into purpose-specific kind values for better semantic retrieval.

UPDATE graph_nodes SET kind = 'EditEvent' WHERE kind = 'CodeEntity' AND name LIKE 'Edit: %';
UPDATE graph_nodes SET kind = 'ExecutionEvent' WHERE kind = 'CodeEntity' AND name LIKE 'Bash: %';
UPDATE graph_nodes SET kind = 'GitEvent' WHERE kind = 'CodeEntity' AND name LIKE 'Git: %';
UPDATE graph_nodes SET kind = 'ErrorEvent' WHERE kind = 'CodeEntity' AND name LIKE 'Error: %';
