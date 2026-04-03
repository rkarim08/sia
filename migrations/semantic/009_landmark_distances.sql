-- Migration 009: Landmark-based graph distance index for Graphormer attention bias (Task 3.5)
-- Goldberg & Harrelson (SODA 2005): precomputed BFS from top-N landmark nodes.
-- Distances are capped at 5 (Graphormer bias saturates at hop distance 5, Ying et al. NeurIPS 2021).

CREATE TABLE IF NOT EXISTS landmark_distances (
    landmark_id TEXT NOT NULL,
    target_id   TEXT NOT NULL,
    distance    INTEGER NOT NULL,  -- shortest-path hop count, capped at 5
    computed_at INTEGER NOT NULL,
    PRIMARY KEY (landmark_id, target_id)
);
CREATE INDEX IF NOT EXISTS idx_landmark_target ON landmark_distances(target_id);
