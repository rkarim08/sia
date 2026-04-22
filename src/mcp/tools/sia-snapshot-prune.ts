// Module: sia-snapshot-prune — Handler for the sia_snapshot_prune MCP tool

import type { z } from "zod";
import type { SiaDb } from "@/graph/db-interface";
import { pruneBranchSnapshots } from "@/graph/snapshots";
import type { SiaSnapshotPruneInput } from "@/mcp/server";
import { validateBranchNames } from "@/mcp/tools/sia-snapshot-shared";

// ---------------------------------------------------------------------------
// SiaSnapshotPruneResult
// ---------------------------------------------------------------------------

export interface SiaSnapshotPruneResult {
	pruned: number;
	branch_names: string[];
}

// ---------------------------------------------------------------------------
// handleSiaSnapshotPrune
// ---------------------------------------------------------------------------

/**
 * Remove branch-keyed snapshots for the named branches.
 *
 * Validates every branch name at the MCP boundary. Returns the number of
 * rows actually deleted plus the (validated) input list, preserving the
 * response shape used by the inline handler previously embedded in
 * `src/mcp/server.ts`.
 */
export async function handleSiaSnapshotPrune(
	db: SiaDb,
	input: z.infer<typeof SiaSnapshotPruneInput>,
): Promise<SiaSnapshotPruneResult> {
	const branchNames = validateBranchNames(input.branch_names);
	const pruned = await pruneBranchSnapshots(db, branchNames);
	return { pruned, branch_names: branchNames };
}
