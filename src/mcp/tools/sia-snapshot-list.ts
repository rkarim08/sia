// Module: sia-snapshot-list — Handler for the sia_snapshot_list MCP tool

import type { SiaDb } from "@/graph/db-interface";
import { listBranchSnapshots } from "@/graph/snapshots";

// ---------------------------------------------------------------------------
// SiaSnapshotListRow — one row per branch snapshot
// ---------------------------------------------------------------------------

export interface SiaSnapshotListRow {
	branch_name: string;
	commit_hash: string;
	node_count: number;
	edge_count: number;
	updated_at: number;
}

// ---------------------------------------------------------------------------
// SiaSnapshotListResult — MCP response shape
// ---------------------------------------------------------------------------

export interface SiaSnapshotListResult {
	snapshots: SiaSnapshotListRow[];
	error?: string;
}

// ---------------------------------------------------------------------------
// handleSiaSnapshotList
// ---------------------------------------------------------------------------

/**
 * Return all branch-keyed graph snapshots, newest first (ordering is
 * delegated to `listBranchSnapshots`). The `snapshot_data` blob and
 * `created_at` / `id` columns are intentionally omitted from the MCP
 * response — callers only need the summary columns.
 *
 * On failure the handler does not propagate the error; it matches the
 * `sia-stats` convention and returns `{ snapshots: [], error: string }`.
 */
export async function handleSiaSnapshotList(db: SiaDb): Promise<SiaSnapshotListResult> {
	try {
		const snapshots = await listBranchSnapshots(db);
		return {
			snapshots: snapshots.map((s) => ({
				branch_name: s.branch_name,
				commit_hash: s.commit_hash,
				node_count: s.node_count,
				edge_count: s.edge_count,
				updated_at: s.updated_at,
			})),
		};
	} catch (err) {
		return {
			snapshots: [],
			error: `Snapshot list query failed: ${(err as Error).message}`,
		};
	}
}
