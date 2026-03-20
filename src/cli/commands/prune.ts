// Module: prune — hard-delete archived entities

import type { SiaDb } from "@/graph/db-interface";

export interface PruneCandidate {
	id: string;
	name: string;
	type: string;
	importance: number;
	daysSinceAccess: number;
}

/**
 * Return the list of archived-but-not-invalidated entities that would be
 * removed by `pruneConfirm`, together with a computed `daysSinceAccess`.
 */
export async function pruneDryRun(db: SiaDb): Promise<PruneCandidate[]> {
	const { rows } = await db.execute(
		"SELECT id, name, type, importance, last_accessed FROM graph_nodes WHERE archived_at IS NOT NULL AND t_valid_until IS NULL",
	);

	const now = Date.now();

	return rows.map((row) => {
		const lastAccessed = row.last_accessed as string | number | null;
		let daysSinceAccess = 0;
		if (lastAccessed != null) {
			const ts = typeof lastAccessed === "number" ? lastAccessed : new Date(lastAccessed).getTime();
			daysSinceAccess = Math.floor((now - ts) / (1000 * 60 * 60 * 24));
		}

		return {
			id: row.id as string,
			name: row.name as string,
			type: row.type as string,
			importance: row.importance as number,
			daysSinceAccess,
		};
	});
}

/**
 * Hard-delete all archived (but not bi-temporally invalidated) entities,
 * their community memberships, and related edges.
 *
 * Returns the number of entities deleted.
 */
export async function pruneConfirm(db: SiaDb): Promise<number> {
	let deletedCount = 0;

	await db.transaction(async (tx) => {
		// 1. Remove community memberships for archived entities
		await tx.execute(
			"DELETE FROM community_members WHERE entity_id IN (SELECT id FROM graph_nodes WHERE archived_at IS NOT NULL AND t_valid_until IS NULL)",
		);

		// 2. Remove edges referencing archived entities
		await tx.execute(
			"DELETE FROM graph_edges WHERE from_id IN (SELECT id FROM graph_nodes WHERE archived_at IS NOT NULL AND t_valid_until IS NULL) OR to_id IN (SELECT id FROM graph_nodes WHERE archived_at IS NOT NULL AND t_valid_until IS NULL)",
		);

		// 3. Count entities about to be deleted
		const { rows } = await tx.execute(
			"SELECT COUNT(*) AS cnt FROM graph_nodes WHERE archived_at IS NOT NULL AND t_valid_until IS NULL",
		);
		deletedCount = (rows[0]?.cnt as number) ?? 0;

		// 4. Delete the archived entities themselves
		await tx.execute(
			"DELETE FROM graph_nodes WHERE archived_at IS NOT NULL AND t_valid_until IS NULL",
		);
	});

	return deletedCount;
}
