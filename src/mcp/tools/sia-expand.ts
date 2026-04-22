// Module: sia-expand — BFS neighbourhood expansion from an entity in the knowledge graph

import type { z } from "zod";
import { getOrCreateLevel1Summary } from "@/community/raptor";
import type { FeedbackCollector } from "@/feedback/collector";
import type { SiaDb } from "@/graph/db-interface";
import type { EdgeRow } from "@/graph/edges";
import type { Entity } from "@/graph/entities";
import { annotateFreshness } from "@/mcp/freshness-annotator";
import { buildNextSteps, type NextStep } from "@/mcp/next-steps";
import type { SiaExpandInput } from "@/mcp/server";

/** Optional dependencies for recording agent feedback signals. */
export interface FeedbackDeps {
	feedbackCollector?: FeedbackCollector | null;
	sessionId?: string;
}

/** Result shape for sia_expand. */
export interface SiaExpandResult {
	entity: Entity;
	neighbors: Entity[];
	edges: EdgeRow[];
	edge_count: number;
	next_steps?: NextStep[];
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
	feedbackDeps?: FeedbackDeps,
): Promise<SiaExpandResult | SiaExpandError> {
	const depth = input.depth ?? 1;
	const edgeTypes = input.edge_types;

	// --- Fetch root entity ---
	const rootResult = await db.execute(
		"SELECT * FROM graph_nodes WHERE id = ? AND t_valid_until IS NULL AND archived_at IS NULL",
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
				edgeSql = `SELECT * FROM graph_edges
					WHERE (from_id = ? OR to_id = ?)
					  AND t_valid_until IS NULL
					  AND type IN (${placeholders})`;
				edgeParams = [entityId, entityId, ...edgeTypes];
			} else {
				edgeSql = `SELECT * FROM graph_edges
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
			"SELECT * FROM graph_nodes WHERE id = ? AND t_valid_until IS NULL AND archived_at IS NULL",
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

	const allEntities = [rootEntity, ...neighbors];
	const annotated = await annotateFreshness(
		allEntities as unknown as Record<string, unknown>[],
		db,
	);
	const [annotatedRoot, ...annotatedNeighbors] = annotated;

	// Record agent feedback (agent_expand signal = 0.5). Best-effort only.
	if (feedbackDeps?.feedbackCollector) {
		try {
			await feedbackDeps.feedbackCollector.record({
				queryText: `expand:${input.entity_id}`,
				entityId: input.entity_id,
				signalType: "agent_expand",
				source: "agent",
				sessionId: feedbackDeps.sessionId ?? "unknown",
				rankPosition: 0,
				candidatesShown: 1,
			});
		} catch (err) {
			console.error("[sia] sia_expand: failed to record feedback:", err);
		}
	}

	const neighborEntities = annotatedNeighbors as unknown as Entity[];
	// `file_paths` is a JSON-encoded string array on each row. Parse the first
	// entry defensively so a malformed value simply yields no hint.
	let topFilePath: string | undefined;
	const rawFilePaths = neighborEntities[0]?.file_paths;
	if (typeof rawFilePaths === "string" && rawFilePaths.length > 0) {
		try {
			const parsed = JSON.parse(rawFilePaths) as unknown;
			if (Array.isArray(parsed) && typeof parsed[0] === "string") {
				topFilePath = parsed[0];
			}
		} catch {
			// ignore malformed file_paths for hint purposes
		}
	}

	const nextSteps = buildNextSteps("sia_expand", {
		resultCount: neighborEntities.length,
		topEntityId: input.entity_id,
		topFilePath,
		depthExplored: depth,
	});

	const result: SiaExpandResult = {
		entity: annotatedRoot as unknown as Entity,
		neighbors: neighborEntities,
		edges: dedupedEdges.slice(0, MAX_EDGES),
		edge_count: totalEdgeCount,
	};
	if (nextSteps.length > 0) result.next_steps = nextSteps;
	return result;
}
