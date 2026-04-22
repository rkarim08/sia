// Module: sia-snapshot-list — Handler for the sia_snapshot_list MCP tool

import type { SiaDb } from "@/graph/db-interface";
import { listBranchSnapshots } from "@/graph/snapshots";
import { buildNextSteps, type NextStep } from "@/mcp/next-steps";

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
	next_steps?: NextStep[];
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
		const rows = snapshots.map((s) => ({
			branch_name: s.branch_name,
			commit_hash: s.commit_hash,
			node_count: s.node_count,
			edge_count: s.edge_count,
			updated_at: s.updated_at,
		}));
		// `listBranchSnapshots` returns newest-first, so the first row is the newest.
		const nextSteps = buildNextSteps("sia_snapshot_list", {
			resultCount: rows.length,
			newestBranchName: rows[0]?.branch_name,
		});
		const response: SiaSnapshotListResult = { snapshots: rows };
		if (nextSteps.length > 0) response.next_steps = nextSteps;
		return response;
	} catch (err) {
		return {
			snapshots: [],
			error: `Snapshot list query failed: ${(err as Error).message}`,
		};
	}
}
