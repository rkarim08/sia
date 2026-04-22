// Module: sia-stats — Graph metrics: node/edge counts by type, optional session stats

import type { z } from "zod";
import type { SiaDb } from "@/graph/db-interface";
import { buildNextSteps, type NextStep } from "@/mcp/next-steps";
import type { SiaStatsInput } from "@/mcp/server";

export interface SiaStatsResult {
	nodes: Record<string, number>;
	edges: Record<string, number>;
	session?: { callCounts: Record<string, number> };
	error?: string;
	next_steps?: NextStep[];
}

/**
 * Return graph metrics: active node counts by type, active edge counts by type,
 * and optionally the per-tool call counts for the current session from search_throttle.
 */
export async function handleSiaStats(
	db: SiaDb,
	input: z.infer<typeof SiaStatsInput>,
	sessionId?: string,
): Promise<SiaStatsResult> {
	try {
		// Node counts by type (active only)
		const { rows: nodeRows } = await db.execute(
			"SELECT type, COUNT(*) as count FROM graph_nodes WHERE t_expired IS NULL GROUP BY type",
		);

		const nodes: Record<string, number> = {};
		for (const row of nodeRows) {
			nodes[row.type as string] = row.count as number;
		}

		// Edge counts by type (active only)
		const { rows: edgeRows } = await db.execute(
			"SELECT type, COUNT(*) as count FROM graph_edges WHERE t_expired IS NULL GROUP BY type",
		);

		const edges: Record<string, number> = {};
		for (const row of edgeRows) {
			edges[row.type as string] = row.count as number;
		}

		// Derive hint-relevant counts: total active entities + tier-3 subset.
		const totalEntities = Object.values(nodes).reduce((sum, n) => sum + n, 0);
		let tier3Count = 0;
		try {
			const { rows: tier3Rows } = await db.execute(
				"SELECT COUNT(*) AS cnt FROM graph_nodes WHERE trust_tier = 3 AND t_expired IS NULL",
			);
			tier3Count = (tier3Rows[0]?.cnt as number) ?? 0;
		} catch {
			// Non-fatal: if trust_tier column is absent for any reason, skip the hint.
		}
		const nextSteps = buildNextSteps("sia_stats", {
			emptyGraph: totalEntities === 0,
			tier3Count,
		});

		// Optional session stats from search_throttle
		if (input.include_session && sessionId) {
			const { rows: throttleRows } = await db.execute(
				"SELECT tool_name, call_count FROM search_throttle WHERE session_id = ?",
				[sessionId],
			);

			const callCounts: Record<string, number> = {};
			for (const row of throttleRows) {
				callCounts[row.tool_name as string] = row.call_count as number;
			}

			const sessionResponse: SiaStatsResult = { nodes, edges, session: { callCounts } };
			if (nextSteps.length > 0) sessionResponse.next_steps = nextSteps;
			return sessionResponse;
		}

		const response: SiaStatsResult = { nodes, edges };
		if (nextSteps.length > 0) response.next_steps = nextSteps;
		return response;
	} catch (err) {
		return { nodes: {}, edges: {}, error: `Stats query failed: ${(err as Error).message}` };
	}
}
