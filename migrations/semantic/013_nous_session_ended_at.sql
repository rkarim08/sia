-- 013_nous_session_ended_at.sql — Phase A6: SessionEnd final consolidation
--
-- Adds an `ended_at` column to `nous_sessions`. Written by the SessionEnd
-- hook (markSessionEnded) so downstream queries can distinguish sessions
-- that closed cleanly (ended_at IS NOT NULL) from sessions abandoned mid-run
-- (ended_at IS NULL, eligible for the stale-session sweep).
--
-- Nullable — pre-existing rows and in-progress sessions have no wall-clock
-- end time. Stored as unix-seconds to match `created_at` / `updated_at`.

ALTER TABLE nous_sessions ADD COLUMN ended_at INTEGER;
