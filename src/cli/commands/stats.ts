// Module: stats — graph statistics

import type { SiaDb } from "@/graph/db-interface";

export interface GraphStats {
	totalEntitiesByType: Record<string, number>;
	archivedCount: number;
	invalidatedCount: number;
	activeEdgesByType: Record<string, number>;
	communityCount: number;
	episodeCount: number;
	pendingConflicts: number;
}

/**
 * Gather aggregate statistics from the graph, episodic, and meta databases.
 */
export async function getStats(
	graphDb: SiaDb,
	episodicDb?: SiaDb,
	_metaDb?: SiaDb,
): Promise<GraphStats> {
	// --- Active entities by type ---
	const totalEntitiesByType: Record<string, number> = {};
	const { rows: entityTypeRows } = await graphDb.execute(
		"SELECT type, COUNT(*) AS cnt FROM graph_nodes WHERE t_valid_until IS NULL AND archived_at IS NULL GROUP BY type",
	);
	for (const row of entityTypeRows) {
		totalEntitiesByType[row.type as string] = row.cnt as number;
	}

	// --- Archived count ---
	const { rows: archivedRows } = await graphDb.execute(
		"SELECT COUNT(*) AS cnt FROM graph_nodes WHERE archived_at IS NOT NULL",
	);
	const archivedCount = (archivedRows[0]?.cnt as number) ?? 0;

	// --- Invalidated count ---
	const { rows: invalidatedRows } = await graphDb.execute(
		"SELECT COUNT(*) AS cnt FROM graph_nodes WHERE t_valid_until IS NOT NULL",
	);
	const invalidatedCount = (invalidatedRows[0]?.cnt as number) ?? 0;

	// --- Active edges by type ---
	const activeEdgesByType: Record<string, number> = {};
	const { rows: edgeTypeRows } = await graphDb.execute(
		"SELECT type, COUNT(*) AS cnt FROM graph_edges WHERE t_valid_until IS NULL GROUP BY type",
	);
	for (const row of edgeTypeRows) {
		activeEdgesByType[row.type as string] = row.cnt as number;
	}

	// --- Community count ---
	const { rows: communityRows } = await graphDb.execute("SELECT COUNT(*) AS cnt FROM communities");
	const communityCount = (communityRows[0]?.cnt as number) ?? 0;

	// --- Episode count (from episodicDb if provided) ---
	let episodeCount = 0;
	if (episodicDb) {
		const { rows: episodeRows } = await episodicDb.execute("SELECT COUNT(*) AS cnt FROM episodes");
		episodeCount = (episodeRows[0]?.cnt as number) ?? 0;
	}

	// --- Pending conflicts ---
	const { rows: conflictRows } = await graphDb.execute(
		"SELECT COUNT(DISTINCT conflict_group_id) AS cnt FROM graph_nodes WHERE conflict_group_id IS NOT NULL AND t_valid_until IS NULL",
	);
	const pendingConflicts = (conflictRows[0]?.cnt as number) ?? 0;

	return {
		totalEntitiesByType,
		archivedCount,
		invalidatedCount,
		activeEdgesByType,
		communityCount,
		episodeCount,
		pendingConflicts,
	};
}
