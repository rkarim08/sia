CREATE TABLE episodes (
  id           TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL,
  ts           INTEGER NOT NULL,     -- Unix ms
  hlc          INTEGER,              -- HLC timestamp (read via hlcFromDb())
  type         TEXT NOT NULL,
    -- 'conversation' | 'tool_use' | 'file_read' | 'command'
  role         TEXT,                 -- 'user' | 'assistant' | 'tool'
  content      TEXT NOT NULL,
  tool_name    TEXT,
  file_path    TEXT,
  token_count  INTEGER,
  trust_tier   INTEGER NOT NULL DEFAULT 3
);

CREATE VIRTUAL TABLE episodes_fts USING fts5(
  content, file_path, tool_name,
  content=episodes,
  content_rowid=rowid
);

CREATE INDEX idx_episodes_session ON episodes(session_id, ts);
CREATE INDEX idx_episodes_ts      ON episodes(ts DESC);

-- sessions_processed: tracks which sessions have completed extraction.
-- Used by the episodic-to-semantic promotion job (Module 7) to find
-- sessions whose Stop hook never fired (abrupt terminations).
CREATE TABLE sessions_processed (
  session_id        TEXT PRIMARY KEY,
  processing_status TEXT NOT NULL DEFAULT 'complete',
    -- 'complete' | 'partial' | 'failed'
  processed_at      INTEGER NOT NULL,
  entity_count      INTEGER NOT NULL DEFAULT 0,
  pipeline_version  TEXT    -- captureModel version used for extraction
);
