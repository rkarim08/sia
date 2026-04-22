// Module: sia-snapshot-restore — Handler for the sia_snapshot_restore MCP tool

import type { z } from "zod";
import type { SiaDb } from "@/graph/db-interface";
import { restoreBranchSnapshot } from "@/graph/snapshots";
import type { SiaSnapshotRestoreInput } from "@/mcp/server";
import { validateBranchName } from "@/mcp/tools/sia-snapshot-shared";

// ---------------------------------------------------------------------------
// SiaSnapshotRestoreResult
// ---------------------------------------------------------------------------

export interface SiaSnapshotRestoreResult {
	restored: boolean;
	branch_name: string;
}

// ---------------------------------------------------------------------------
// handleSiaSnapshotRestore
// ---------------------------------------------------------------------------

/**
 * Restore the active graph from a branch-keyed snapshot.
 *
 * Validates the branch name at the MCP boundary so an empty / non-string
 * input produces a clear error rather than a silent miss against the
 * branch_snapshots table. Returns `{ restored: false }` when the branch
 * exists as input but has no stored snapshot.
 */
export async function handleSiaSnapshotRestore(
	db: SiaDb,
	input: z.infer<typeof SiaSnapshotRestoreInput>,
): Promise<SiaSnapshotRestoreResult> {
	const branchName = validateBranchName(input.branch_name);
	const restored = await restoreBranchSnapshot(db, branchName);
	return { restored, branch_name: branchName };
}
