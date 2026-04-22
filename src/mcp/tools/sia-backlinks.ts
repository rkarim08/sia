// Module: sia-backlinks — Backlink traversal for knowledge graph nodes

import type { SiaDb } from "@/graph/db-interface";
import { buildNextSteps, type NextStep } from "@/mcp/next-steps";

export interface SiaBacklinksInput {
	node_id: string;
	edge_types?: string[];
}

export interface BacklinkEntry {
	id: string;
	type: string;
	name: string;
	summary: string;
	importance: number;
	edge_type: string;
}

export interface SiaBacklinksResult {
	target_id: string;
	backlinks: Record<string, BacklinkEntry[]>; // grouped by edge_type
	total_count: number;
	next_steps?: NextStep[];
}

/**
 * Find all active incoming edges to a given node, grouped by edge type.
 * Returns entities that reference the target node via active edges.
 *
 * Only considers edges where t_valid_until IS NULL (active edges) and
 * source entities that are neither invalidated nor archived.
 */
export async function handleSiaBacklinks(
	db: SiaDb,
	input: SiaBacklinksInput,
): Promise<SiaBacklinksResult> {
	const params: unknown[] = [input.node_id];

	let edgeTypeFilter = "";
	if (input.edge_types && input.edge_types.length > 0) {
		const placeholders = input.edge_types.map(() => "?").join(", ");
		edgeTypeFilter = `AND e.type IN (${placeholders})`;
		params.push(...input.edge_types);
	}

	const sql = `
		SELECT
			e.type AS edge_type,
			ent.id, ent.type, ent.name, ent.summary, ent.importance
		FROM graph_edges e
		JOIN graph_nodes ent ON ent.id = e.from_id
		WHERE e.to_id = ?
			AND e.t_valid_until IS NULL
			AND ent.t_valid_until IS NULL
			AND ent.archived_at IS NULL
			${edgeTypeFilter}
		ORDER BY e.type, ent.importance DESC
	`;

	const result = await db.execute(sql, params);

	const backlinks: Record<string, BacklinkEntry[]> = {};
	let totalCount = 0;

	for (const row of result.rows) {
		const edgeType = row.edge_type as string;
		const entry: BacklinkEntry = {
			id: row.id as string,
			type: row.type as string,
			name: row.name as string,
			summary: row.summary as string,
			importance: row.importance as number,
			edge_type: edgeType,
		};

		if (!backlinks[edgeType]) {
			backlinks[edgeType] = [];
		}
		backlinks[edgeType].push(entry);
		totalCount++;
	}

	// Grab the most-important caller (first entry across all groups) for
	// the hint's `entity_id` arg, if one exists.
	let topCallerId: string | undefined;
	for (const group of Object.values(backlinks)) {
		if (group.length > 0) {
			topCallerId = group[0].id;
			break;
		}
	}

	const nextSteps = buildNextSteps("sia_backlinks", {
		resultCount: totalCount,
		topEntityId: topCallerId,
	});

	const response: SiaBacklinksResult = {
		target_id: input.node_id,
		backlinks,
		total_count: totalCount,
	};
	if (nextSteps.length > 0) response.next_steps = nextSteps;
	return response;
}
