// Module: sia-at-time — Bi-temporal query: entities and edges as-of a point in time

import type { z } from "zod";
import type { SiaDb } from "@/graph/db-interface";
import type { EdgeRow } from "@/graph/edges";
import type { Entity } from "@/graph/entities";
import type { SiaAtTimeInput as SiaAtTimeInputSchema } from "@/mcp/server";

export type SiaAtTimeInput = z.infer<typeof SiaAtTimeInputSchema>;

export interface SiaTemporalResult {
	entities: Entity[];
	invalidated_entities: Entity[];
	invalidated_count: number;
	edges: EdgeRow[];
	edge_count: number;
}

/**
 * Parse an `as_of` string into Unix milliseconds.
 *
 * Supports:
 * - ISO 8601 strings (anything `new Date()` can parse)
 * - Relative strings like "7 days ago", "3 months ago", "1 year ago"
 */
export function parseAsOf(asOf: string): number {
	const relativePattern = /^(\d+)\s+(days?|weeks?|months?|years?)\s+ago$/i;
	const match = asOf.trim().match(relativePattern);

	if (match) {
		const amount = Number.parseInt(match[1], 10);
		const unit = match[2].toLowerCase().replace(/s$/, "");
		const now = Date.now();

		switch (unit) {
			case "day":
				return now - amount * 24 * 60 * 60 * 1000;
			case "week":
				return now - amount * 7 * 24 * 60 * 60 * 1000;
			case "month":
				return now - amount * 30 * 24 * 60 * 60 * 1000;
			case "year":
				return now - amount * 365 * 24 * 60 * 60 * 1000;
			default:
				throw new Error(`Unknown relative time unit: ${unit}`);
		}
	}

	const parsed = new Date(asOf).getTime();
	if (Number.isNaN(parsed)) {
		throw new Error(`Cannot parse as_of timestamp: ${asOf}`);
	}
	return parsed;
}

/**
 * Query the knowledge graph at a specific point in time.
 *
 * Returns entities that were active at `as_of`, entities that had been
 * invalidated by that time, and edges that were active at that time.
 */
export async function handleSiaAtTime(
	db: SiaDb,
	input: SiaAtTimeInput,
): Promise<SiaTemporalResult> {
	const asOfMs = parseAsOf(input.as_of);
	const rawLimit = input.limit ?? 20;
	const limit = Math.min(Math.max(rawLimit, 1), 50);

	// --- Build WHERE filters for entity_types and tags ---
	const entityFilters: string[] = [];
	const entityParams: unknown[] = [];

	if (input.entity_types && input.entity_types.length > 0) {
		const placeholders = input.entity_types.map(() => "?").join(", ");
		entityFilters.push(`type IN (${placeholders})`);
		entityParams.push(...input.entity_types);
	}

	if (input.tags && input.tags.length > 0) {
		// Match any entity whose JSON tags array contains at least one of the requested tags.
		// tags is stored as a JSON string array, e.g. '["auth","api"]'.
		const tagClauses = input.tags.map(() => "tags LIKE ?");
		entityFilters.push(`(${tagClauses.join(" OR ")})`);
		for (const tag of input.tags) {
			entityParams.push(`%${tag}%`);
		}
	}

	const extraWhere = entityFilters.length > 0 ? ` AND ${entityFilters.join(" AND ")}` : "";

	// --- Active entities at as_of ---
	const activeQuery = `
		SELECT * FROM graph_nodes
		WHERE (t_valid_from IS NULL OR t_valid_from <= ?)
		  AND (t_valid_until IS NULL OR t_valid_until > ?)
		  AND archived_at IS NULL
		  ${extraWhere}
		LIMIT ?
	`;
	const activeParams = [asOfMs, asOfMs, ...entityParams, limit];
	const activeResult = await db.execute(activeQuery, activeParams);
	const entities = activeResult.rows as unknown as Entity[];

	// --- Invalidated entities: those whose t_valid_until <= as_of ---
	const invalidatedCountQuery = `
		SELECT COUNT(*) AS cnt FROM graph_nodes
		WHERE t_valid_until IS NOT NULL AND t_valid_until <= ?
		  ${extraWhere}
	`;
	const invalidatedCountParams = [asOfMs, ...entityParams];
	const countResult = await db.execute(invalidatedCountQuery, invalidatedCountParams);
	const invalidatedCount = (countResult.rows[0] as { cnt: number }).cnt;

	const invalidatedQuery = `
		SELECT * FROM graph_nodes
		WHERE t_valid_until IS NOT NULL AND t_valid_until <= ?
		  ${extraWhere}
		ORDER BY t_valid_until DESC
		LIMIT ?
	`;
	const invalidatedParams = [asOfMs, ...entityParams, limit];
	const invalidatedResult = await db.execute(invalidatedQuery, invalidatedParams);
	const invalidatedEntities = invalidatedResult.rows as unknown as Entity[];

	// --- Edges active at as_of (global, not per-entity), capped at 50 ---
	const edgesCountQuery = `
		SELECT COUNT(*) AS cnt FROM graph_edges
		WHERE (t_valid_from IS NULL OR t_valid_from <= ?)
		  AND (t_valid_until IS NULL OR t_valid_until > ?)
	`;
	const edgesCountResult = await db.execute(edgesCountQuery, [asOfMs, asOfMs]);
	const edgeCount = (edgesCountResult.rows[0] as { cnt: number }).cnt;

	const edgesQuery = `
		SELECT * FROM graph_edges
		WHERE (t_valid_from IS NULL OR t_valid_from <= ?)
		  AND (t_valid_until IS NULL OR t_valid_until > ?)
		LIMIT 50
	`;
	const edgesResult = await db.execute(edgesQuery, [asOfMs, asOfMs]);
	const edges = edgesResult.rows as unknown as EdgeRow[];

	return {
		entities,
		invalidated_entities: invalidatedEntities,
		invalidated_count: invalidatedCount,
		edges,
		edge_count: edgeCount,
	};
}
