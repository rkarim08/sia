// Module: status — knowledge graph health dashboard

import type { SiaDb } from "@/graph/db-interface";

export interface GraphHealth {
	totalEntities: number;
	totalEdges: number;
	totalCommunities: number;
	byType: Record<string, number>;
	byTier: Record<number, number>;
	byKind: Record<string, number>;
	conflictGroups: number;
	archivedEntities: number;
	recentEntities24h: number;
	oldestEntity: string | null;
	newestEntity: string | null;
}

const TIER_LABELS: Record<number, string> = {
	1: "User-Direct  ",
	2: "Code-Analysis",
	3: "LLM-Inferred ",
	4: "External     ",
};

/**
 * Gather health metrics from the knowledge graph.
 */
export async function getGraphHealth(db: SiaDb): Promise<GraphHealth> {
	// Active entities total
	const { rows: totalRows } = await db.execute(
		"SELECT COUNT(*) AS cnt FROM graph_nodes WHERE t_valid_until IS NULL AND archived_at IS NULL",
	);
	const totalEntities = (totalRows[0]?.cnt as number) ?? 0;

	// By type
	const byType: Record<string, number> = {};
	const { rows: typeRows } = await db.execute(
		"SELECT type, COUNT(*) AS cnt FROM graph_nodes WHERE t_valid_until IS NULL AND archived_at IS NULL GROUP BY type",
	);
	for (const row of typeRows) {
		byType[row.type as string] = row.cnt as number;
	}

	// By trust tier
	const byTier: Record<number, number> = {};
	const { rows: tierRows } = await db.execute(
		"SELECT trust_tier, COUNT(*) AS cnt FROM graph_nodes WHERE t_valid_until IS NULL AND archived_at IS NULL GROUP BY trust_tier",
	);
	for (const row of tierRows) {
		byTier[row.trust_tier as number] = row.cnt as number;
	}

	// By kind
	const byKind: Record<string, number> = {};
	const { rows: kindRows } = await db.execute(
		"SELECT kind, COUNT(*) AS cnt FROM graph_nodes WHERE t_valid_until IS NULL AND archived_at IS NULL AND kind IS NOT NULL GROUP BY kind",
	);
	for (const row of kindRows) {
		byKind[row.kind as string] = row.cnt as number;
	}

	// Total edges
	const { rows: edgeRows } = await db.execute(
		"SELECT COUNT(*) AS cnt FROM graph_edges WHERE t_valid_until IS NULL",
	);
	const totalEdges = (edgeRows[0]?.cnt as number) ?? 0;

	// Communities
	const { rows: communityRows } = await db.execute("SELECT COUNT(*) AS cnt FROM communities");
	const totalCommunities = (communityRows[0]?.cnt as number) ?? 0;

	// Conflict groups
	const { rows: conflictRows } = await db.execute(
		"SELECT COUNT(DISTINCT conflict_group_id) AS cnt FROM graph_nodes WHERE conflict_group_id IS NOT NULL AND t_valid_until IS NULL",
	);
	const conflictGroups = (conflictRows[0]?.cnt as number) ?? 0;

	// Archived
	const { rows: archivedRows } = await db.execute(
		"SELECT COUNT(*) AS cnt FROM graph_nodes WHERE archived_at IS NOT NULL",
	);
	const archivedEntities = (archivedRows[0]?.cnt as number) ?? 0;

	// Recent (24h)
	const oneDayAgo = Date.now() - 86_400_000;
	const { rows: recentRows } = await db.execute(
		"SELECT COUNT(*) AS cnt FROM graph_nodes WHERE created_at > ? AND t_valid_until IS NULL AND archived_at IS NULL",
		[oneDayAgo],
	);
	const recentEntities24h = (recentRows[0]?.cnt as number) ?? 0;

	// Oldest / newest
	const { rows: oldestRows } = await db.execute(
		"SELECT MIN(created_at) AS ts FROM graph_nodes WHERE t_valid_until IS NULL AND archived_at IS NULL",
	);
	const oldestTs = oldestRows[0]?.ts as number | null;
	const oldestEntity = oldestTs ? new Date(oldestTs).toISOString() : null;

	const { rows: newestRows } = await db.execute(
		"SELECT MAX(created_at) AS ts FROM graph_nodes WHERE t_valid_until IS NULL AND archived_at IS NULL",
	);
	const newestTs = newestRows[0]?.ts as number | null;
	const newestEntity = newestTs ? new Date(newestTs).toISOString() : null;

	return {
		totalEntities,
		totalEdges,
		totalCommunities,
		byType,
		byTier,
		byKind,
		conflictGroups,
		archivedEntities,
		recentEntities24h,
		oldestEntity,
		newestEntity,
	};
}

/**
 * Format GraphHealth as a human-friendly terminal string.
 */
export function formatHealth(health: GraphHealth): string {
	const lines: string[] = [];

	lines.push("=== SIA Knowledge Graph Health ===");
	lines.push(`Total entities:  ${health.totalEntities}`);
	lines.push(`Total edges:     ${health.totalEdges}`);
	lines.push(`Communities:     ${health.totalCommunities}`);
	lines.push(`Conflicts:       ${health.conflictGroups} group${health.conflictGroups !== 1 ? "s" : ""}`);
	lines.push(`Archived:        ${health.archivedEntities}`);
	lines.push(`Recent (24h):    ${health.recentEntities24h}`);

	if (health.oldestEntity && health.newestEntity) {
		const oldestDate = new Date(health.oldestEntity);
		const newestDate = new Date(health.newestEntity);
		const ageDays = Math.round((newestDate.getTime() - oldestDate.getTime()) / 86_400_000);
		lines.push(`Graph age:       ${ageDays} day${ageDays !== 1 ? "s" : ""}`);
	}

	// By type
	const typeEntries = Object.entries(health.byType).sort((a, b) => b[1] - a[1]);
	if (typeEntries.length > 0) {
		lines.push("");
		lines.push("--- By Type ---");
		for (const [type, count] of typeEntries) {
			lines.push(`  ${type.padEnd(21)}${count}`);
		}
	}

	// By tier
	const tierEntries = Object.entries(health.byTier)
		.map(([tier, count]) => [Number(tier), count] as [number, number])
		.sort((a, b) => a[0] - b[0]);
	if (tierEntries.length > 0) {
		lines.push("");
		lines.push("--- By Trust Tier ---");
		for (const [tier, count] of tierEntries) {
			const label = TIER_LABELS[tier] ?? `Tier ${tier}      `;
			lines.push(`  Tier ${tier} (${label}) ${count}`);
		}
	}

	return lines.join("\n");
}

/**
 * CLI entry point for `sia status`.
 */
export async function runStatus(db: SiaDb): Promise<void> {
	const health = await getGraphHealth(db);
	console.log(formatHealth(health));
}
