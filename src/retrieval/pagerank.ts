// Module: pagerank — Retrieval-layer PageRank wrapper

import { writeAuditEntry } from "@/graph/audit";
import type { SiaDb } from "@/graph/db-interface";

export const EDGE_TYPE_WEIGHTS: Record<string, number> = {
	calls: 0.5,
	pertains_to: 0.4,
	solves: 0.4,
	relates_to: 0.3,
	imports: 0.3,
	caused_by: 0.3,
	elaborates: 0.2,
	supersedes: 0.2,
	member_of: 0.1,
};

export async function getImportanceScore(db: SiaDb, nodeId: string): Promise<number> {
	const { rows } = await db.execute("SELECT importance FROM entities WHERE id = ?", [nodeId]);
	if (rows.length === 0) return 0.5;
	return (rows[0] as { importance: number }).importance;
}

export async function updateImportanceScores(
	db: SiaDb,
	scores: Map<string, number>,
): Promise<number> {
	if (scores.size === 0) return 0;
	const statements = [...scores.entries()].map(([id, score]) => ({
		sql: "UPDATE entities SET importance = ? WHERE id = ?",
		params: [score, id] as unknown[],
	}));
	await db.executeMany(statements);
	await writeAuditEntry(db, "PAGERANK_UPDATE", {});
	return scores.size;
}

export function getEdgeWeight(edgeType: string): number {
	return EDGE_TYPE_WEIGHTS[edgeType] ?? 0.1;
}
