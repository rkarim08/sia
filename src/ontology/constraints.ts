// Module: constraints — Application-layer edge validation using edge_constraints table

import type { SiaDb } from "@/graph/db-interface";

/** Shape of a row in the edge_constraints table. */
export interface EdgeConstraint {
	id: number;
	source_type: string;
	edge_type: string;
	target_type: string;
	description: string | null;
	cardinality: string;
	required: number;
}

/**
 * Check whether a (source_type, edge_type, target_type) triple exists
 * in the edge_constraints table.
 *
 * Returns true if the triple is declared valid, false otherwise.
 */
export async function validateEdge(
	db: SiaDb,
	sourceType: string,
	edgeType: string,
	targetType: string,
): Promise<boolean> {
	const result = await db.execute(
		`SELECT COUNT(*) AS cnt FROM edge_constraints
		 WHERE source_type = ? AND edge_type = ? AND target_type = ?`,
		[sourceType, edgeType, targetType],
	);
	const row = result.rows[0] as { cnt: number } | undefined;
	return (row?.cnt ?? 0) > 0;
}

/**
 * Return all valid edge constraint rows for a given source entity type.
 */
export async function getConstraintsForType(
	db: SiaDb,
	sourceType: string,
): Promise<EdgeConstraint[]> {
	const result = await db.execute("SELECT * FROM edge_constraints WHERE source_type = ?", [
		sourceType,
	]);
	return result.rows as unknown as EdgeConstraint[];
}

/**
 * Return the entire constraint set from the edge_constraints table.
 */
export async function getAllConstraints(db: SiaDb): Promise<EdgeConstraint[]> {
	const result = await db.execute("SELECT * FROM edge_constraints", []);
	return result.rows as unknown as EdgeConstraint[];
}
