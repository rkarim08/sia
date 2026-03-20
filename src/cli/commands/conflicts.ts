// Module: conflicts — conflict listing and resolution

import type { SiaDb } from "@/graph/db-interface";
import { invalidateEntity } from "@/graph/entities";

export async function listConflicts(db: SiaDb): Promise<Record<string, string[]>> {
	const rows = await db.execute(
		"SELECT conflict_group_id, id FROM graph_nodes WHERE conflict_group_id IS NOT NULL AND archived_at IS NULL AND t_valid_until IS NULL",
	);
	const groups: Record<string, string[]> = {};
	for (const row of rows.rows as Array<{ conflict_group_id: string; id: string }>) {
		if (!groups[row.conflict_group_id]) groups[row.conflict_group_id] = [];
		groups[row.conflict_group_id].push(row.id);
	}
	return groups;
}

export async function resolveConflict(
	db: SiaDb,
	groupId: string,
	keepEntityId: string,
): Promise<void> {
	const keepRow = await db.execute(
		"SELECT id FROM graph_nodes WHERE id = ? AND conflict_group_id = ?",
		[keepEntityId, groupId],
	);
	if (keepRow.rows.length === 0) {
		throw new Error(`Entity '${keepEntityId}' not found in conflict group '${groupId}'`);
	}

	const rows = await db.execute("SELECT id FROM graph_nodes WHERE conflict_group_id = ?", [
		groupId,
	]);
	for (const row of rows.rows as Array<{ id: string }>) {
		if (row.id === keepEntityId) continue;
		await invalidateEntity(db, row.id);
	}
	await db.execute("UPDATE graph_nodes SET conflict_group_id = NULL WHERE conflict_group_id = ?", [
		groupId,
	]);
}
