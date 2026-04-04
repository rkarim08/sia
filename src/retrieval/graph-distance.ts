// Module: graph-distance — landmark-based shortest-path cache for Graphormer attention bias
//
// Algorithm: Goldberg & Harrelson (SODA 2005) — select top-N landmark nodes by
// access_count, run BFS from each landmark to all reachable nodes, store
// results capped at GRAPHORMER_MAX_DIST (5). At inference time, use triangle
// inequality: dist(A, B) ≤ min_L( dist(A, L) + dist(L, B) ).
//
// Graphormer distance saturation: Ying et al. (NeurIPS 2021) showed that the
// learned bias is flat for distances ≥ 5, so bounded overestimates are harmless.

import type { SiaDb } from "@/graph/db-interface";

/** Distances saturate at this hop count in the Graphormer bias lookup table. */
export const GRAPHORMER_MAX_DIST = 5;

export interface LandmarkCacheOptions {
	/** Number of landmark nodes to select (default: 25). */
	topN?: number;
}

/**
 * Recompute the landmark distance index.
 *
 * Selects the top-N nodes by access_count as landmarks, runs BFS from each
 * to all reachable nodes, stores hop counts (capped at GRAPHORMER_MAX_DIST)
 * in the landmark_distances table.
 *
 * Call on MCP server startup and after significant graph mutations (sia_index).
 */
export async function updateLandmarkCache(
	db: SiaDb,
	opts: LandmarkCacheOptions = {},
): Promise<void> {
	const topN = opts.topN ?? 25;

	// Clear stale entries before rebuild to prevent leftover distances from removed landmarks
	await db.execute("DELETE FROM landmark_distances");

	// Select top-N landmarks by access_count
	const { rows: landmarkRows } = await db.execute(
		`SELECT id FROM graph_nodes
		 WHERE t_valid_until IS NULL AND archived_at IS NULL
		 ORDER BY access_count DESC
		 LIMIT ?`,
		[topN],
	);

	if (landmarkRows.length === 0) return;

	// Pre-fetch the entire active adjacency list in one query
	const { rows: allEdges } = await db.execute(
		"SELECT from_id, to_id FROM graph_edges WHERE t_valid_until IS NULL",
	);

	// Build in-memory adjacency map (bidirectional)
	const adjacency = new Map<string, Set<string>>();
	for (const row of allEdges) {
		const from = row.from_id as string;
		const to = row.to_id as string;
		if (!adjacency.has(from)) adjacency.set(from, new Set());
		if (!adjacency.has(to)) adjacency.set(to, new Set());
		adjacency.get(from)!.add(to);
		adjacency.get(to)!.add(from);
	}

	const now = Date.now();

	for (const lmRow of landmarkRows) {
		const landmarkId = lmRow.id as string;

		// BFS from landmark — purely in-memory using pre-fetched adjacency
		const distances = new Map<string, number>();
		distances.set(landmarkId, 0);
		const queue: [string, number][] = [[landmarkId, 0]];
		let head = 0;

		while (head < queue.length) {
			const [nodeId, dist] = queue[head++];
			if (dist >= GRAPHORMER_MAX_DIST) continue;

			const neighbours = adjacency.get(nodeId);
			if (!neighbours) continue;

			for (const neighbour of neighbours) {
				if (!distances.has(neighbour)) {
					const newDist = dist + 1;
					distances.set(neighbour, newDist);
					queue.push([neighbour, newDist]);
				}
			}
		}

		await db.execute("BEGIN");
		try {
			// Upsert all distances for this landmark
			for (const [targetId, dist] of distances) {
				await db.execute(
					`INSERT OR REPLACE INTO landmark_distances
					 (landmark_id, target_id, distance, computed_at)
					 VALUES (?, ?, ?, ?)`,
					[landmarkId, targetId, Math.min(dist, GRAPHORMER_MAX_DIST), now],
				);
			}
			await db.execute("COMMIT");
		} catch (err) {
			await db.execute("ROLLBACK");
			console.error(
				`[sia] landmark cache: failed for landmark ${landmarkId}:`,
				err instanceof Error ? err.message : String(err),
			);
		}
	}
}

/**
 * Compute the K×K pairwise distance matrix for a set of candidate entity IDs.
 *
 * Uses stored landmark distances + triangle inequality for O(K²·L) lookups where K is candidate count and L is landmark count.
 * Falls back to GRAPHORMER_MAX_DIST (treated as "far") for pairs with no
 * landmark path, which is correct given Graphormer bias saturation.
 *
 * Self-distances are always 0.
 *
 * @param db - graph database
 * @param candidateIds - ordered list of entity IDs (K=10-15 typically)
 * @returns K×K matrix of hop distances, each entry in [0, GRAPHORMER_MAX_DIST]
 */
export async function computeGraphDistances(
	db: SiaDb,
	candidateIds: string[],
): Promise<number[][]> {
	const K = candidateIds.length;
	const matrix: number[][] = Array.from({ length: K }, () =>
		new Array(K).fill(GRAPHORMER_MAX_DIST),
	);

	// Self-distances
	for (let i = 0; i < K; i++) matrix[i][i] = 0;

	if (K <= 1) return matrix;

	try {
		// Load all landmark rows touching any candidate ID
		const placeholders = candidateIds.map(() => "?").join(", ");
		const { rows } = await db.execute(
			`SELECT landmark_id, target_id, distance FROM landmark_distances WHERE landmark_id IN (${placeholders})
			 UNION
			 SELECT landmark_id, target_id, distance FROM landmark_distances WHERE target_id IN (${placeholders})`,
			[...candidateIds, ...candidateIds],
		);

		// Build per-node distance-from-landmark map: node → Map<landmark, dist>
		const fromLandmark = new Map<string, Map<string, number>>();
		for (const row of rows) {
			const lm = row.landmark_id as string;
			const tgt = row.target_id as string;
			const dist = Math.min(row.distance as number, GRAPHORMER_MAX_DIST);

			if (!fromLandmark.has(tgt)) fromLandmark.set(tgt, new Map());
			fromLandmark.get(tgt)!.set(lm, dist);

			// Symmetric: landmark's own distance to itself is 0
			if (!fromLandmark.has(lm)) fromLandmark.set(lm, new Map());
			fromLandmark.get(lm)!.set(lm, 0);
		}

		// Triangle inequality: dist(A, B) ≤ min_L( dist(A, L) + dist(L, B) )
		for (let i = 0; i < K; i++) {
			for (let j = i + 1; j < K; j++) {
				const nodeA = candidateIds[i];
				const nodeB = candidateIds[j];

				const landmarksA = fromLandmark.get(nodeA);
				const landmarksB = fromLandmark.get(nodeB);

				if (!landmarksA || !landmarksB) continue;

				let best = GRAPHORMER_MAX_DIST;
				for (const [lm, distA] of landmarksA) {
					const distB = landmarksB.get(lm);
					if (distB !== undefined) {
						best = Math.min(best, distA + distB);
					}
				}

				matrix[i][j] = best;
				matrix[j][i] = best; // symmetric
			}
		}
	} catch (err) {
		console.error(
			`[sia] graph-distance: computeGraphDistances failed for ${K} candidates:`,
			err instanceof Error ? err.message : String(err),
		);
		// Return default matrix with self-distances = 0, all else = GRAPHORMER_MAX_DIST
		return matrix;
	}

	return matrix;
}

/** Type alias for use in caller code. */
export type GraphDistanceCache = Awaited<ReturnType<typeof computeGraphDistances>>;
