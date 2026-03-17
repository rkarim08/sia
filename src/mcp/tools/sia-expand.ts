// Module: sia-expand — BFS neighbourhood expansion from an entity in the knowledge graph

import type { z } from "zod";
import { getOrCreateLevel1Summary } from "@/community/raptor";
import type { SiaDb } from "@/graph/db-interface";
import type { EdgeRow } from "@/graph/edges";
import type { Entity } from "@/graph/entities";
import type { SiaExpandInput } from "@/mcp/server";

/** Result shape for sia_expand. */
export interface SiaExpandResult {
	entity: Entity;
	neighbors: Entity[];
	edges: EdgeRow[];
	edge_count: number;
}

/** Error result when root entity is not found. */
export interface SiaExpandError {
	error: string;
}

const MAX_ENTITIES = 50;
const MAX_EDGES = 200;

/**
 * BFS expansion from `entity_id` through active edges.
 *
 * - Configurable depth (default 1, max 3).
 * - Hard cap of 50 entities in the result.
 * - Optional `edge_types` filter restricts which edge types are traversed.
 * - `edge_count` is the total number of active edges found (before the 200 cap).
 * - `edges[]` is capped at 200 entries.
 * - Returns an error object if the root entity does not exist or is inactive.
 */
export async function handleSiaExpand(
	db: SiaDb,
	input: z.infer<typeof SiaExpandInput>,
): Promise<SiaExpandResult | SiaExpandError> {
	const depth = input.depth ?? 1;
	const edgeTypes = input.edge_types;

	// --- Fetch root entity ---
	const rootResult = await db.execute(
		"SELECT * FROM entities WHERE id = ? AND t_valid_until IS NULL AND archived_at IS NULL",
		[input.entity_id],
	);

	if (rootResult.rows.length === 0) {
		return { error: `Entity not found or inactive: ${input.entity_id}` };
	}

	const rootEntity = rootResult.rows[0] as unknown as Entity;

	// Fire-and-forget: lazily generate Level 1 summary for this entity
	void getOrCreateLevel1Summary(db, input.entity_id);

	// --- BFS ---
	const visited = new Set<string>([input.entity_id]);
	const allEdges: EdgeRow[] = [];
	let totalEdgeCount = 0;

	// Current frontier of entity IDs to expand
	let frontier = [input.entity_id];

	for (let d = 0; d < depth; d++) {
		if (frontier.length === 0) break;
		if (visited.size >= MAX_ENTITIES) break;

		const nextFrontier: string[] = [];

		for (const entityId of frontier) {
			if (visited.size >= MAX_ENTITIES) break;

			// Build edge query with optional type filter
			let edgeSql: string;
			let edgeParams: unknown[];

			if (edgeTypes && edgeTypes.length > 0) {
				const placeholders = edgeTypes.map(() => "?").join(", ");
				edgeSql = `SELECT * FROM edges
					WHERE (from_id = ? OR to_id = ?)
					  AND t_valid_until IS NULL
					  AND type IN (${placeholders})`;
				edgeParams = [entityId, entityId, ...edgeTypes];
			} else {
				edgeSql = `SELECT * FROM edges
					WHERE (from_id = ? OR to_id = ?)
					  AND t_valid_until IS NULL`;
				edgeParams = [entityId, entityId];
			}

			const edgeResult = await db.execute(edgeSql, edgeParams);
			const edges = edgeResult.rows as unknown as EdgeRow[];

			for (const edge of edges) {
				totalEdgeCount++;

				// Track the edge (up to cap)
				if (allEdges.length < MAX_EDGES) {
					// Avoid duplicate edges
					if (!allEdges.some((e) => e.id === edge.id)) {
						allEdges.push(edge);
					}
				}

				// Determine the neighbor on the other side
				const neighborId = edge.from_id === entityId ? edge.to_id : edge.from_id;

				if (!visited.has(neighborId) && visited.size < MAX_ENTITIES) {
					visited.add(neighborId);
					nextFrontier.push(neighborId);
				}
			}
		}

		frontier = nextFrontier;
	}

	// --- Fetch neighbor entities (active only) ---
	const neighborIds = [...visited].filter((id) => id !== input.entity_id);
	const neighbors: Entity[] = [];

	for (const nid of neighborIds) {
		const nResult = await db.execute(
			"SELECT * FROM entities WHERE id = ? AND t_valid_until IS NULL AND archived_at IS NULL",
			[nid],
		);
		if (nResult.rows.length > 0) {
			neighbors.push(nResult.rows[0] as unknown as Entity);
		}
	}

	// Deduplicate allEdges by id (edges may have been encountered from both sides)
	const seenEdgeIds = new Set<string>();
	const dedupedEdges: EdgeRow[] = [];
	for (const edge of allEdges) {
		if (!seenEdgeIds.has(edge.id)) {
			seenEdgeIds.add(edge.id);
			dedupedEdges.push(edge);
		}
	}

	return {
		entity: rootEntity,
		neighbors,
		edges: dedupedEdges.slice(0, MAX_EDGES),
		edge_count: totalEdgeCount,
	};
}
