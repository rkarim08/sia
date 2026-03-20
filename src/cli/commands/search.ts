// Module: search — CLI search against the knowledge graph

import type { SiaDb } from "@/graph/db-interface";

export interface SearchOpts {
	limit?: number;
	taskType?: string;
	packagePath?: string;
}

export interface SearchResultItem {
	id: string;
	name: string;
	type: string;
	content: string;
	summary: string;
	importance: number;
	confidence: number;
	trustTier: number;
	score: number;
}

/**
 * Sanitize an FTS5 query string: strip special characters and wrap tokens
 * in double-quotes so SQLite treats them as literals.
 */
function sanitizeFtsQuery(query: string): string {
	// Remove FTS5 operators and special chars, keep alphanumerics, underscores, hyphens, spaces
	const cleaned = query.replace(/[^a-zA-Z0-9_\- ]/g, " ").trim();
	if (cleaned.length === 0) return '""';

	// Wrap each token in double-quotes to avoid FTS5 syntax errors
	const tokens = cleaned.split(/\s+/).filter(Boolean);
	return tokens.map((t) => `"${t}"`).join(" ");
}

/**
 * Map a raw database row to a SearchResultItem.
 */
function rowToItem(row: Record<string, unknown>, score: number): SearchResultItem {
	return {
		id: String(row.id ?? ""),
		name: String(row.name ?? ""),
		type: String(row.type ?? ""),
		content: String(row.content ?? ""),
		summary: String(row.summary ?? ""),
		importance: Number(row.importance ?? 0),
		confidence: Number(row.confidence ?? 0),
		trustTier: Number(row.trust_tier ?? 0),
		score,
	};
}

/**
 * Search the knowledge graph for entities matching the given query.
 *
 * Tries FTS5 first for ranked full-text search; falls back to a LIKE-based
 * query if the FTS5 virtual table is unavailable or the query fails.
 */
export async function searchGraph(
	db: SiaDb,
	query: string,
	opts?: SearchOpts,
): Promise<SearchResultItem[]> {
	const limit = opts?.limit ?? 20;

	// --- Attempt FTS5 search ---
	try {
		const ftsQuery = sanitizeFtsQuery(query);
		const result = await db.execute(
			`SELECT graph_nodes.id, graph_nodes.name, graph_nodes.type, graph_nodes.content,
				graph_nodes.summary, graph_nodes.importance, graph_nodes.confidence,
				graph_nodes.trust_tier, graph_nodes_fts.rank
			FROM graph_nodes_fts
			JOIN graph_nodes ON graph_nodes.rowid = graph_nodes_fts.rowid
			WHERE graph_nodes_fts MATCH ?
				AND graph_nodes.t_valid_until IS NULL
				AND graph_nodes.archived_at IS NULL
			ORDER BY rank
			LIMIT ?`,
			[ftsQuery, limit],
		);

		return result.rows.map((row) => rowToItem(row, Number(row.rank ?? 0)));
	} catch {
		// FTS5 table missing or query error — fall through to LIKE search
	}

	// --- Fallback: LIKE search ---
	const likePattern = `%${query}%`;
	const result = await db.execute(
		`SELECT id, name, type, content, summary, importance, confidence, trust_tier
		FROM graph_nodes
		WHERE (name LIKE ? OR content LIKE ?)
			AND t_valid_until IS NULL
			AND archived_at IS NULL
		ORDER BY importance DESC
		LIMIT ?`,
		[likePattern, likePattern, limit],
	);

	return result.rows.map((row) => rowToItem(row, Number(row.importance ?? 0)));
}
