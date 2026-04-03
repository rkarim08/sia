-- Migration 011: Feedback events table for attention head training (Task 4.3)
-- Stores implicit user signals (visualizer interactions, agent citations, CLI usage)
-- used to train the attention fusion head once ≥50 real events exist.

CREATE TABLE IF NOT EXISTS feedback_events (
    id              TEXT PRIMARY KEY,
    query_text      TEXT NOT NULL,
    entity_id       TEXT NOT NULL,
    signal_strength REAL NOT NULL,
    source          TEXT NOT NULL CHECK (source IN ('visualizer', 'agent', 'cli', 'synthetic')),
    timestamp       INTEGER NOT NULL,
    session_id      TEXT NOT NULL,
    rank_position   INTEGER NOT NULL DEFAULT 0,
    candidates_shown INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_feedback_events_timestamp ON feedback_events(timestamp);
CREATE INDEX IF NOT EXISTS idx_feedback_events_entity ON feedback_events(entity_id);
