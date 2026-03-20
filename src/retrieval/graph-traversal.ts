// Module: graph-traversal — Entity name extraction + 1-hop graph expansion search signal

import type { SiaDb } from "@/graph/db-interface";

/** A single result from the graph traversal search signal. */
export interface GraphTraversalResult {
	entityId: string;
	score: number;
}

/** Options for graphTraversalSearch. */
export interface GraphTraversalSearchOpts {
	/** Maximum number of results to return. Default 20. */
	limit?: number;
	/** When true, exclude trust_tier >= 4 entities. */
	paranoid?: boolean;
}

/**
 * Extract candidate entity names from a natural-language query.
 *
 * Steps:
 * 1. Split on whitespace, keep tokens >= 2 chars.
 * 2. Try CamelCase splits on each token (e.g. "TokenStore" -> ["Token", "Store"]).
 * 3. Generate two-word combinations from adjacent tokens:
 *    - CamelCase joined ("token store" -> "TokenStore")
 *    - snake_case joined ("token store" -> "token_store")
 */
export function extractQueryTerms(query: string): string[] {
	const raw = query.split(/\s+/).filter((t) => t.length >= 2);
	const terms = new Set<string>();

	for (const token of raw) {
		terms.add(token);

		// CamelCase split: "TokenStore" -> ["Token", "Store"]
		const camelParts = token.match(/[A-Z][a-z]+|[a-z]+|[A-Z]+(?=[A-Z][a-z]|\b)/g);
		if (camelParts && camelParts.length > 1) {
			for (const part of camelParts) {
				if (part.length >= 2) {
					terms.add(part);
				}
			}
		}
	}

	// Two-word combinations from adjacent tokens
	for (let i = 0; i < raw.length - 1; i++) {
		const a = raw[i];
		const b = raw[i + 1];
		// CamelCase: capitalize first letter of each word
		const camel =
			a.charAt(0).toUpperCase() +
			a.slice(1).toLowerCase() +
			b.charAt(0).toUpperCase() +
			b.slice(1).toLowerCase();
		terms.add(camel);
		// snake_case
		terms.add(`${a.toLowerCase()}_${b.toLowerCase()}`);
	}

	return [...terms];
}

/**
 * Graph traversal search signal.
 *
 * 1. Extract candidate terms from the query.
 * 2. Direct lookup: exact name match on active entities (score 1.0).
 * 3. LIKE partial match for terms >= 3 chars (score 0.9, limit 5 per term).
 * 4. 1-hop expansion via active edges for each matched entity (score 0.7).
 * 5. Deduplicate (highest score wins), sort by score DESC, cap at limit.
 */
export async function graphTraversalSearch(
	db: SiaDb,
	query: string,
	opts?: GraphTraversalSearchOpts,
): Promise<GraphTraversalResult[]> {
	const limit = opts?.limit ?? 20;
	const paranoid = opts?.paranoid ?? false;
	const terms = extractQueryTerms(query);

	if (terms.length === 0) {
		return [];
	}

	// Map<entityId, score> — highest score wins
	const scoreMap = new Map<string, number>();

	function addScore(entityId: string, score: number): void {
		const existing = scoreMap.get(entityId);
		if (existing === undefined || score > existing) {
			scoreMap.set(entityId, score);
		}
	}

	// Collect direct-match entity IDs for 1-hop expansion
	const directMatchIds: string[] = [];

	// Stage 1: Direct exact lookup (score 1.0)
	for (const term of terms) {
		const paranoidClause = paranoid ? " AND trust_tier < 4" : "";
		const result = await db.execute(
			`SELECT id FROM graph_nodes WHERE name = ? AND t_valid_until IS NULL AND archived_at IS NULL${paranoidClause}`,
			[term],
		);
		for (const row of result.rows) {
			const id = row.id as string;
			addScore(id, 1.0);
			directMatchIds.push(id);
		}
	}

	// Stage 2: LIKE partial match (score 0.9) for terms >= 3 chars
	for (const term of terms) {
		if (term.length < 3) continue;
		const paranoidClause = paranoid ? " AND trust_tier < 4" : "";
		const result = await db.execute(
			`SELECT id FROM graph_nodes WHERE name LIKE ? AND t_valid_until IS NULL AND archived_at IS NULL${paranoidClause} LIMIT 5`,
			[`%${term}%`],
		);
		for (const row of result.rows) {
			const id = row.id as string;
			addScore(id, 0.9);
			if (!directMatchIds.includes(id)) {
				directMatchIds.push(id);
			}
		}
	}

	// Stage 3: 1-hop expansion via edges (score 0.7)
	for (const entityId of directMatchIds) {
		const edgeResult = await db.execute(
			"SELECT from_id, to_id FROM graph_edges WHERE (from_id = ? OR to_id = ?) AND t_valid_until IS NULL",
			[entityId, entityId],
		);
		for (const row of edgeResult.rows) {
			const fromId = row.from_id as string;
			const toId = row.to_id as string;
			const neighborId = fromId === entityId ? toId : fromId;

			// Only add neighbor if it is an active, non-archived entity
			if (paranoid) {
				const check = await db.execute(
					"SELECT id FROM graph_nodes WHERE id = ? AND t_valid_until IS NULL AND archived_at IS NULL AND trust_tier < 4",
					[neighborId],
				);
				if (check.rows.length === 0) continue;
			} else {
				const check = await db.execute(
					"SELECT id FROM graph_nodes WHERE id = ? AND t_valid_until IS NULL AND archived_at IS NULL",
					[neighborId],
				);
				if (check.rows.length === 0) continue;
			}

			addScore(neighborId, 0.7);
		}
	}

	// Build sorted result list
	const results: GraphTraversalResult[] = [...scoreMap.entries()]
		.map(([entityId, score]) => ({ entityId, score }))
		.sort((a, b) => b.score - a.score)
		.slice(0, limit);

	return results;
}
