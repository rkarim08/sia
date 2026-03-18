// Module: export — serialize active graph to portable JSON

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { SiaDb } from "@/graph/db-interface";

/** Options for graph export. */
export interface ExportOpts {
	/** Optional bridge.db handle for cross-repo edges */
	bridgeDb?: SiaDb;
	/** Repo hash for filtering bridge edges */
	repoHash?: string;
}

/** Portable snapshot of the active graph. */
export interface ExportData {
	version: 1;
	exportedAt: number;
	entities: Record<string, unknown>[];
	edges: Record<string, unknown>[];
	communities: Record<string, unknown>[];
	crossRepoEdges: Record<string, unknown>[];
}

/**
 * Export the active graph to a portable JSON structure.
 *
 * 1. Active entities (not invalidated, not archived)
 * 2. Active edges (not invalidated)
 * 3. All communities
 * 4. Optionally, active cross-repo edges from bridge.db
 */
export async function exportGraph(db: SiaDb, opts?: ExportOpts): Promise<ExportData> {
	// 1. Active entities
	const entitiesResult = await db.execute(
		"SELECT * FROM entities WHERE t_valid_until IS NULL AND archived_at IS NULL",
	);

	// 2. Active edges
	const edgesResult = await db.execute("SELECT * FROM edges WHERE t_valid_until IS NULL");

	// 3. All communities
	const communitiesResult = await db.execute("SELECT * FROM communities");

	// 4. Cross-repo edges (only if bridgeDb + repoHash provided)
	let crossRepoEdges: Record<string, unknown>[] = [];
	if (opts?.bridgeDb && opts?.repoHash) {
		const crossResult = await opts.bridgeDb.execute(
			"SELECT * FROM cross_repo_edges WHERE (source_repo_id = ? OR target_repo_id = ?) AND t_valid_until IS NULL",
			[opts.repoHash, opts.repoHash],
		);
		crossRepoEdges = crossResult.rows;
	}

	return {
		version: 1,
		exportedAt: Date.now(),
		entities: entitiesResult.rows,
		edges: edgesResult.rows,
		communities: communitiesResult.rows,
		crossRepoEdges,
	};
}

/**
 * Export the active graph to a JSON file on disk.
 *
 * Creates parent directories if they don't exist.
 * Returns the output path.
 */
export async function exportToFile(
	db: SiaDb,
	outputPath: string,
	opts?: ExportOpts,
): Promise<string> {
	const data = await exportGraph(db, opts);

	const dir = dirname(outputPath);
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}

	writeFileSync(outputPath, JSON.stringify(data, null, 2), "utf-8");
	return outputPath;
}
