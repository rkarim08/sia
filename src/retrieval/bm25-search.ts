// Module: bm25-search — FTS5 MATCH keyword search with normalized ranking

import type { SiaDb } from "@/graph/db-interface";

/** A single BM25 search result. */
export interface BM25Result {
	entityId: string;
	score: number;
}

/** Options for bm25Search. */
export interface BM25SearchOpts {
	/** Maximum number of results to return. Default 20. */
	limit?: number;
	/** When true, exclude entities with trust_tier = 4 (external/untrusted). */
	paranoid?: boolean;
	/** Filter results to a specific monorepo package path. */
	packagePath?: string;
}

/**
 * Sanitize a query string for FTS5 MATCH syntax.
 *
 * - Preserves double-quoted phrases intact (e.g. `"auth module"`)
 * - Strips FTS5 special characters from unquoted parts
 * - Splits unquoted parts on whitespace so each token is a separate term
 * - Returns the sanitized query string ready for FTS5 MATCH
 */
export function sanitizeFts5Query(query: string): string {
	const trimmed = query.trim();
	if (!trimmed) return "";

	const parts: string[] = [];
	let remaining = trimmed;

	// Extract quoted phrases and unquoted segments
	while (remaining.length > 0) {
		const quoteStart = remaining.indexOf('"');
		if (quoteStart === -1) {
			// No more quotes — process remaining as unquoted
			const tokens = sanitizeUnquoted(remaining);
			if (tokens) parts.push(tokens);
			break;
		}

		// Process text before the quote
		if (quoteStart > 0) {
			const before = remaining.slice(0, quoteStart);
			const tokens = sanitizeUnquoted(before);
			if (tokens) parts.push(tokens);
		}

		// Find closing quote
		const quoteEnd = remaining.indexOf('"', quoteStart + 1);
		if (quoteEnd === -1) {
			// Unclosed quote — treat rest as unquoted
			const rest = remaining.slice(quoteStart + 1);
			const tokens = sanitizeUnquoted(rest);
			if (tokens) parts.push(tokens);
			break;
		}

		// Extract the quoted phrase (including quotes)
		const phrase = remaining.slice(quoteStart, quoteEnd + 1);
		// Only add if the phrase has actual content between quotes
		const inner = phrase.slice(1, -1).trim();
		if (inner.length > 0) {
			parts.push(`"${inner}"`);
		}

		remaining = remaining.slice(quoteEnd + 1);
	}

	return parts.join(" ");
}

/**
 * Strip FTS5 special characters from an unquoted segment and return
 * space-separated tokens. Returns empty string if no valid tokens remain.
 */
function sanitizeUnquoted(text: string): string {
	// Remove FTS5 operators and special characters: * + - ^ ~ : ( ) { } < >
	const cleaned = text.replace(/[*+\-^~:(){}|<>@!.,;'/\\[\]]/g, " ");
	const tokens = cleaned
		.split(/\s+/)
		.filter((t) => t.length > 0);
	return tokens.join(" ");
}

/**
 * Perform a BM25 keyword search against the entities_fts virtual table.
 *
 * Joins `entities_fts` with `entities` on rowid, filters for active entities
 * (t_valid_until IS NULL AND archived_at IS NULL), applies optional paranoid
 * and packagePath filters, and normalizes FTS5 rank to a 0–1 range.
 *
 * Returns an empty array for empty or invalid queries.
 */
export async function bm25Search(
	db: SiaDb,
	query: string,
	opts?: BM25SearchOpts,
): Promise<BM25Result[]> {
	const sanitized = sanitizeFts5Query(query);
	if (!sanitized) return [];

	const limit = opts?.limit ?? 20;
	const paranoid = opts?.paranoid ?? false;
	const packagePath = opts?.packagePath;

	// Build the query with optional filters
	const conditions: string[] = [
		"e.t_valid_until IS NULL",
		"e.archived_at IS NULL",
	];
	const params: unknown[] = [sanitized];

	if (paranoid) {
		conditions.push("e.trust_tier != 4");
	}

	if (packagePath) {
		conditions.push("e.package_path = ?");
		params.push(packagePath);
	}

	params.push(limit);

	const whereClause = conditions.join(" AND ");

	const sql = `
		SELECT e.id AS entityId, -fts.rank AS rawRank
		FROM entities_fts fts
		JOIN entities e ON e.rowid = fts.rowid
		WHERE entities_fts MATCH ?
		  AND ${whereClause}
		ORDER BY fts.rank
		LIMIT ?
	`;

	const result = await db.execute(sql, params);
	const rows = result.rows as Array<{ entityId: string; rawRank: number }>;

	if (rows.length === 0) return [];

	// Normalize rawRank to 0–1 range using min/max of the result set
	const rawRanks = rows.map((r) => r.rawRank);
	const minRank = Math.min(...rawRanks);
	const maxRank = Math.max(...rawRanks);
	const range = maxRank - minRank;

	return rows.map((row) => ({
		entityId: row.entityId,
		score: range === 0 ? 1.0 : (row.rawRank - minRank) / range,
	}));
}
