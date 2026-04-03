// Module: vector-search — ONNX embedder + cosine similarity (VSS fallback)

import type { Embedder } from "@/capture/embedder";
import type { SiaDb } from "@/graph/db-interface";

/** A single vector search result: entity ID + similarity score. */
export interface VectorResult {
	entityId: string;
	score: number;
}

/** Options for vectorSearch. */
export interface VectorSearchOpts {
	limit?: number;
	paranoid?: boolean;
	packagePath?: string;
	/** Which embedding column to search. Defaults to "embedding" (NL). Use "embedding_code" for code-specific search. */
	embeddingColumn?: "embedding" | "embedding_code";
}

/** Default similarity threshold below which results are discarded. */
const SIMILARITY_THRESHOLD = 0.3;

/** Maximum candidate entities to scan in brute-force fallback. */
const BRUTE_FORCE_LIMIT = 1000;

/**
 * Compute cosine similarity between two Float32Arrays.
 *
 * Both vectors are assumed to be of equal length. Returns 0 if either
 * has zero magnitude (degenerate case).
 */
function cosineSim(a: Float32Array, b: Float32Array): number {
	let dot = 0;
	let normA = 0;
	let normB = 0;

	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i];
		normA += a[i] * a[i];
		normB += b[i] * b[i];
	}

	const denom = Math.sqrt(normA) * Math.sqrt(normB);
	if (denom === 0) return 0;
	return dot / denom;
}

/**
 * Search entities by vector similarity.
 *
 * 1. Embed query via the provided embedder.
 * 2. Try sqlite-vss (`vss_search`) on the `graph_nodes_vss` virtual table.
 * 3. If VSS is unavailable, fall back to brute-force cosine scan over
 *    entities that have a non-NULL embedding column (capped at 1000).
 *
 * Results are filtered by an optional paranoid flag (excludes tier 4)
 * and packagePath, then sorted by score descending and capped at `limit`.
 */
export async function vectorSearch(
	db: SiaDb,
	query: string,
	embedder: Embedder,
	opts?: VectorSearchOpts,
): Promise<VectorResult[]> {
	const limit = opts?.limit ?? 15;

	// Step 1: Embed the query text
	const queryEmbedding = await embedder.embed(query);
	if (!queryEmbedding) return [];

	const embeddingColumn = opts?.embeddingColumn ?? "embedding";

	// Step 2: Try sqlite-vss via rawSqlite() (only for the NL embedding column)
	if (embeddingColumn === "embedding") {
		const vssResults = tryVssSearch(db, queryEmbedding, limit, opts);
		if (vssResults !== null) return vssResults;
	}

	// Step 3: Brute-force cosine scan fallback
	return bruteForceCosineSearch(db, queryEmbedding, embeddingColumn, limit, opts);
}

/**
 * Attempt to use sqlite-vss extension for fast approximate search.
 * Returns null if VSS is not available (extension not loaded, table missing, etc.).
 */
function tryVssSearch(
	db: SiaDb,
	queryEmbedding: Float32Array,
	limit: number,
	opts?: VectorSearchOpts,
): VectorResult[] | null {
	const raw = db.rawSqlite();
	if (!raw) return null;

	try {
		// Serialize embedding to JSON array for vss_search
		const embeddingJson = JSON.stringify(Array.from(queryEmbedding));

		// Use vss_search to get candidate rowids with distances
		const vssRows = raw
			.prepare(
				`SELECT rowid, distance
				 FROM vss_search(graph_nodes_vss, ?, ?)`,
			)
			.all(embeddingJson, limit * 2) as Array<{ rowid: number; distance: number }>;

		if (!vssRows || vssRows.length === 0) return null;

		// Map rowids back to entity IDs with filters
		const results: VectorResult[] = [];
		for (const vssRow of vssRows) {
			// Convert distance to similarity score (VSS returns L2 distance)
			const score = 1 / (1 + vssRow.distance);
			if (score < SIMILARITY_THRESHOLD) continue;

			// Look up entity to apply filters
			const entity = raw
				.prepare(
					`SELECT id, trust_tier, package_path
					 FROM graph_nodes
					 WHERE rowid = ?
					   AND t_valid_until IS NULL
					   AND archived_at IS NULL`,
				)
				.get(vssRow.rowid) as
				| { id: string; trust_tier: number; package_path: string | null }
				| undefined;

			if (!entity) continue;
			if (opts?.paranoid && entity.trust_tier === 4) continue;
			if (opts?.packagePath && entity.package_path !== opts.packagePath) continue;

			results.push({ entityId: entity.id, score });
		}

		results.sort((a, b) => b.score - a.score);
		return results.slice(0, limit);
	} catch {
		// VSS extension not loaded or table doesn't exist — fall through to brute-force
		return null;
	}
}

/**
 * Brute-force cosine similarity scan.
 *
 * Queries up to BRUTE_FORCE_LIMIT entities that have a non-NULL embedding,
 * computes cosine similarity against the query embedding, filters by
 * threshold and optional constraints, then returns sorted top-N results.
 */
async function bruteForceCosineSearch(
	db: SiaDb,
	queryEmbedding: Float32Array,
	embeddingColumn: "embedding" | "embedding_code",
	limit: number,
	opts?: VectorSearchOpts,
): Promise<VectorResult[]> {
	// Build WHERE clauses — column name is a constrained union, not user input
	const clauses: string[] = [
		`${embeddingColumn} IS NOT NULL`,
		"t_valid_until IS NULL",
		"archived_at IS NULL",
	];
	const params: unknown[] = [];

	if (opts?.paranoid) {
		clauses.push("trust_tier < 4");
	}
	if (opts?.packagePath) {
		clauses.push("package_path = ?");
		params.push(opts.packagePath);
	}

	params.push(Math.min(limit * 10, BRUTE_FORCE_LIMIT));

	const sql = `SELECT id, ${embeddingColumn} FROM graph_nodes WHERE ${clauses.join(" AND ")} LIMIT ?`;
	const { rows } = await db.execute(sql, params);

	const results: VectorResult[] = [];

	for (const row of rows) {
		const embeddingBlob = row[embeddingColumn];
		if (!embeddingBlob) continue;

		// Convert stored BLOB to Float32Array
		let storedEmbedding: Float32Array;
		if (embeddingBlob instanceof Buffer || embeddingBlob instanceof Uint8Array) {
			storedEmbedding = new Float32Array(
				(embeddingBlob as Uint8Array).buffer,
				(embeddingBlob as Uint8Array).byteOffset,
				(embeddingBlob as Uint8Array).byteLength / 4,
			);
		} else if (embeddingBlob instanceof ArrayBuffer) {
			storedEmbedding = new Float32Array(embeddingBlob);
		} else {
			// Unexpected type — skip
			continue;
		}

		const score = cosineSim(queryEmbedding, storedEmbedding);
		if (score < SIMILARITY_THRESHOLD) continue;

		results.push({ entityId: row.id as string, score });
	}

	results.sort((a, b) => b.score - a.score);
	return results.slice(0, limit);
}
