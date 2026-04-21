-- 012_nous.sql — Nous cognitive layer schema
-- Note: entities table was renamed to graph_nodes in migration 004.

CREATE TABLE IF NOT EXISTS nous_sessions (
  session_id         TEXT    PRIMARY KEY,
  parent_session_id  TEXT,
  session_type       TEXT    NOT NULL DEFAULT 'primary',
  state              TEXT    NOT NULL DEFAULT '{}',
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS nous_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT    NOT NULL,
  event_type  TEXT    NOT NULL,
  score       REAL    NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nous_history_session
  ON nous_history(session_id);

CREATE INDEX IF NOT EXISTS idx_nous_history_type
  ON nous_history(event_type, created_at);

ALTER TABLE graph_nodes ADD COLUMN captured_by_session_id   TEXT;
ALTER TABLE graph_nodes ADD COLUMN captured_by_session_type TEXT;
