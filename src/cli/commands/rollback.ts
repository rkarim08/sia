// Module: rollback — restore graph from a snapshot

import { readFileSync } from "node:fs";
import type { SiaDb } from "@/graph/db-interface";
import type { SnapshotData } from "@/graph/snapshots";
import { findNearestSnapshot, listSnapshots, restoreSnapshot } from "@/graph/snapshots";

export interface RollbackOpts {
	/** Target date string (YYYY-MM-DD) or timestamp to roll back to. */
	target?: string | number;
	/** Override SIA_HOME. */
	siaHome?: string;
}

export interface RollbackResult {
	snapshotUsed: string;
	restoredEntities: number;
	restoredEdges: number;
}

/**
 * Roll back the graph database to a previous snapshot.
 *
 * - If `opts.target` is a YYYY-MM-DD string, it is parsed to a UTC timestamp.
 * - If `opts.target` is a number, it is used directly as a timestamp.
 * - If no target is provided, the most recent snapshot is used.
 */
export async function rollbackGraph(
	db: SiaDb,
	repoHash: string,
	opts?: RollbackOpts,
): Promise<RollbackResult> {
	const siaHome = opts?.siaHome;
	let snapshotPath: string | null = null;

	if (opts?.target != null) {
		const targetTs =
			typeof opts.target === "string" ? new Date(opts.target).getTime() : opts.target;

		snapshotPath = findNearestSnapshot(repoHash, targetTs, siaHome);
	} else {
		// No target — use the most recent snapshot (last item)
		const all = listSnapshots(repoHash, siaHome);
		snapshotPath = all.length > 0 ? all[all.length - 1] : null;
	}

	if (!snapshotPath) {
		throw new Error("No snapshot found for the specified date");
	}

	// Restore the snapshot into the database
	await restoreSnapshot(db, snapshotPath, repoHash, siaHome);

	// Read the snapshot file to count entities and edges
	const raw = readFileSync(snapshotPath, "utf-8");
	const data = JSON.parse(raw) as SnapshotData;

	return {
		snapshotUsed: snapshotPath,
		restoredEntities: data.entities.length,
		restoredEdges: data.edges.length,
	};
}

/**
 * List all available snapshot file paths for a repo, sorted oldest-first.
 */
export function listAvailableSnapshots(repoHash: string, siaHome?: string): string[] {
	return listSnapshots(repoHash, siaHome);
}
