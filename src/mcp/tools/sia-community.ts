// Module: sia-community — Community-level summary retrieval for Phase 3
//
// Looks up communities by entity membership, text query (LIKE match),
// level, and package_path.  Returns up to 3 CommunitySummary objects.
// Full vector search upgrades arrive in Phase 7.

import type { z } from "zod";
import type { SiaDb } from "@/graph/db-interface";
import { buildNextSteps, type NextStep } from "@/mcp/next-steps";
import type { SiaCommunityInput } from "@/mcp/server";

/** Shape returned for each community in sia_community results. */
export interface CommunitySummary {
	id: string;
	level: number;
	summary: string | null;
	member_count: number;
	parent_id: string | null;
	package_path: string | null;
}

/** Top-level result envelope for sia_community. */
export interface SiaCommunityResult {
	communities: CommunitySummary[];
	global_unavailable?: boolean;
	next_steps?: NextStep[];
}

/** Maximum number of community results returned. */
const MAX_RESULTS = 3;

/**
 * Execute the sia_community tool logic.
 *
 * Lookup strategies (applied in order of precedence):
 *  1. `entity_id` — find the community containing that entity via community_members
 *  2. `query`     — LIKE match against community summary text
 *  3. Neither     — return all communities (subject to level/package_path filters)
 *
 * Additional filters applied on top:
 *  - `level`        — exact match on community level (0 | 1 | 2)
 *  - `package_path` — exact match on community package_path
 *
 * When the graph has no communities and the total entity count is < 100,
 * returns `{ communities: [], global_unavailable: true }`.
 */
export async function handleSiaCommunity(
	db: SiaDb,
	input: z.infer<typeof SiaCommunityInput>,
): Promise<SiaCommunityResult> {
	const clauses: string[] = [];
	const params: unknown[] = [];

	// --- entity_id lookup via community_members join -----------------------
	if (input.entity_id) {
		clauses.push("c.id IN (SELECT community_id FROM community_members WHERE entity_id = ?)");
		params.push(input.entity_id);
	}

	// --- query: simple LIKE match on summary text --------------------------
	if (input.query) {
		clauses.push("c.summary LIKE ?");
		params.push(`%${input.query}%`);
	}

	// --- level filter ------------------------------------------------------
	if (input.level !== undefined) {
		clauses.push("c.level = ?");
		params.push(input.level);
	}

	// --- package_path filter -----------------------------------------------
	if (input.package_path) {
		clauses.push("c.package_path = ?");
		params.push(input.package_path);
	}

	const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
	params.push(MAX_RESULTS);

	const sql = `SELECT c.id, c.level, c.summary, c.member_count, c.parent_id, c.package_path
		FROM communities c
		${whereClause}
		ORDER BY c.member_count DESC
		LIMIT ?`;

	const result = await db.execute(sql, params);

	const communities: CommunitySummary[] = result.rows.map((row) => ({
		id: row.id as string,
		level: row.level as number,
		summary: (row.summary as string | null) ?? null,
		member_count: (row.member_count as number) ?? 0,
		parent_id: (row.parent_id as string | null) ?? null,
		package_path: (row.package_path as string | null) ?? null,
	}));

	// If no communities found, check whether this is because the graph is too
	// small (< 100 entities) to have generated communities at all.
	if (communities.length === 0) {
		const countResult = await db.execute("SELECT COUNT(*) AS cnt FROM communities", []);
		const totalCommunities = (countResult.rows[0]?.cnt as number) ?? 0;

		if (totalCommunities === 0) {
			const entityCountResult = await db.execute("SELECT COUNT(*) AS cnt FROM graph_nodes", []);
			const totalEntities = (entityCountResult.rows[0]?.cnt as number) ?? 0;

			if (totalEntities < 100) {
				return { communities: [], global_unavailable: true };
			}
		}
	}

	const nextSteps = buildNextSteps("sia_community", {
		resultCount: communities.length,
		topEntityId: communities[0]?.id,
	});
	return nextSteps.length > 0 ? { communities, next_steps: nextSteps } : { communities };
}
