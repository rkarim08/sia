-- Migration: 008_process_tracing.sql

CREATE TABLE IF NOT EXISTS processes (
    id               TEXT PRIMARY KEY,
    name             TEXT NOT NULL,
    entry_node_id    TEXT REFERENCES graph_nodes(id),
    terminal_node_id TEXT REFERENCES graph_nodes(id),
    step_count       INTEGER NOT NULL DEFAULT 0,
    scope            TEXT DEFAULT 'intra',
    entry_score      REAL NOT NULL DEFAULT 0.5,
    package_path     TEXT,
    created_at       INTEGER NOT NULL,
    updated_at       INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_processes_entry ON processes(entry_node_id);
CREATE INDEX IF NOT EXISTS idx_processes_package ON processes(package_path);

CREATE TABLE IF NOT EXISTS process_steps (
    process_id  TEXT NOT NULL REFERENCES processes(id) ON DELETE CASCADE,
    node_id     TEXT NOT NULL REFERENCES graph_nodes(id),
    step_order  INTEGER NOT NULL,
    confidence  REAL NOT NULL DEFAULT 0.7,
    PRIMARY KEY (process_id, node_id)
);

CREATE INDEX IF NOT EXISTS idx_process_steps_node ON process_steps(node_id);

-- Entry point scoring on graph_nodes
ALTER TABLE graph_nodes ADD COLUMN entry_point_score REAL DEFAULT NULL;

-- Keep current_nodes shadow table in sync with graph_nodes
ALTER TABLE current_nodes ADD COLUMN entry_point_score REAL DEFAULT NULL;

-- Community cohesion
ALTER TABLE communities ADD COLUMN cohesion REAL DEFAULT NULL;

-- New edge constraint seeds
INSERT OR IGNORE INTO edge_constraints (source_type, edge_type, target_type, description)
VALUES
    ('CodeEntity', 'overrides', 'CodeEntity', 'Method overrides parent class method'),
    ('CodeEntity', 'step_in_process', 'CodeEntity', 'Function is a step in an execution flow');
