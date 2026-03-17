// Module: search — Three-stage pipeline orchestration
//
// Stage 1: Parallel BM25 + graph traversal + vector search
// Stage 2: 1-hop neighbor expansion for candidates
// Stage 3: RRF combination + trust-weighted reranking
// Global queries bypass the pipeline and return community summaries.

import type { Embedder } from "@/capture/embedder";
import type { SiaDb } from "@/graph/db-interface";
import type { SiaSearchResult } from "@/mcp/tools/sia-search";
import { bm25Search } from "@/retrieval/bm25-search";
import { graphTraversalSearch } from "@/retrieval/graph-traversal";
import { classifyQuery } from "@/retrieval/query-classifier";
import { type RankedCandidate, rerank, rrfCombine } from "@/retrieval/reranker";
import { vectorSearch } from "@/retrieval/vector-search";

/** Options accepted by hybridSearch. */
export interface SearchOptions {
	query: string;
	taskType?: string;
	nodeTypes?: string[];
	packagePath?: string;
	paranoid?: boolean;
	limit?: number;
	includeProvenance?: boolean;
	communityMinGraphSize?: number;
}

/** Result returned by hybridSearch. */
export interface SearchResult {
	results: SiaSearchResult[];
	mode: "local" | "global";
	globalUnavailable: boolean;
}

/** Default minimum graph size before community summaries are available. */
const DEFAULT_COMMUNITY_MIN_GRAPH_SIZE = 100;

/**
 * Three-stage hybrid retrieval pipeline.
 *
 * 1. Classify query as local or global.
 * 2. If global, return community summaries from the `communities` table.
 * 3. Stage 1: parallel BM25 + graph traversal + vector search.
 * 4. Stage 2: expand 1-hop neighbors for every candidate.
 * 5. Stage 3: RRF combine + trust-weighted rerank.
 * 6. Post-filter by nodeTypes if specified.
 * 7. Attach extraction_method if includeProvenance is set.
 *
 * The `embedder` parameter is nullable -- when null, vector search is skipped
 * and the pipeline runs on BM25 + graph traversal only.
 */
export async function hybridSearch(
	db: SiaDb,
	embedder: Embedder | null,
	opts: SearchOptions,
): Promise<SearchResult> {
	const limit = opts.limit ?? 15;
	const communityMinGraphSize =
		opts.communityMinGraphSize ?? DEFAULT_COMMUNITY_MIN_GRAPH_SIZE;

	// --- Classify query ---------------------------------------------------
	const classification = await classifyQuery(db, opts.query, {
		communityMinGraphSize,
	});

	// --- Global mode: return community summaries --------------------------
	if (classification.mode === "global") {
		const communities = await fetchCommunitySummaries(db, limit);
		return {
			results: communities,
			mode: "global",
			globalUnavailable: false,
		};
	}

	// --- Stage 1: parallel retrieval signals ------------------------------
	const searchOpts = {
		limit: limit * 3, // over-fetch to leave room for reranking
		paranoid: opts.paranoid,
		packagePath: opts.packagePath,
	};

	const [bm25Results, graphResults, vecResults] = await Promise.all([
		bm25Search(db, opts.query, searchOpts),
		graphTraversalSearch(db, opts.query, searchOpts),
		embedder
			? vectorSearch(db, opts.query, embedder, searchOpts)
			: Promise.resolve([]),
	]);

	// --- Stage 2: expand 1-hop neighbors ----------------------------------
	const expandedGraphResults = await expandNeighbors(
		db,
		graphResults,
		opts.paranoid,
	);

	// --- Stage 3: RRF combine + rerank ------------------------------------
	const bm25Candidates: RankedCandidate[] = bm25Results.map((r) => ({
		entityId: r.entityId,
		score: r.score,
	}));
	const graphCandidates: RankedCandidate[] = expandedGraphResults.map((r) => ({
		entityId: r.entityId,
		score: r.score,
	}));
	const vecCandidates: RankedCandidate[] = vecResults.map((r) => ({
		entityId: r.entityId,
		score: r.score,
	}));

	const rrfScores = rrfCombine(bm25Candidates, graphCandidates, vecCandidates);

	let results = await rerank(db, rrfScores, {
		taskType: opts.taskType,
		packagePath: opts.packagePath,
		paranoid: opts.paranoid,
		limit,
		includeProvenance: opts.includeProvenance,
	});

	// --- Post-filter by nodeTypes ------------------------------------------
	if (opts.nodeTypes && opts.nodeTypes.length > 0) {
		const allowed = new Set(opts.nodeTypes);
		results = results.filter((r) => allowed.has(r.type));
	}

	// --- Provenance --------------------------------------------------------
	if (opts.includeProvenance) {
		await attachProvenance(db, results);
	}

	return {
		results,
		mode: "local",
		globalUnavailable: classification.globalUnavailable,
	};
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Fetch community summaries for global-mode queries.
 * Returns communities that have a non-NULL summary, ordered by member_count DESC.
 */
async function fetchCommunitySummaries(
	db: SiaDb,
	limit: number,
): Promise<SiaSearchResult[]> {
	const result = await db.execute(
		"SELECT * FROM communities WHERE summary IS NOT NULL ORDER BY member_count DESC LIMIT ?",
		[limit],
	);

	return (result.rows as Record<string, unknown>[]).map((row) => ({
		id: row.id as string,
		type: "Community",
		name: (row.id as string),
		summary: (row.summary as string) ?? "",
		content: (row.summary as string) ?? "",
		trust_tier: 1,
		confidence: 1.0,
		importance: 1.0,
		tags: "[]",
		file_paths: "[]",
		conflict_group_id: null,
		t_valid_from: null,
		source_repo_name: null,
	}));
}

/**
 * Stage 2: expand 1-hop neighbors for each candidate entity.
 *
 * For each entity in the input list, query the `edges` table for active
 * 1-hop neighbors. Neighbors not already present in the result set are
 * added at score 0.7.
 */
async function expandNeighbors(
	db: SiaDb,
	results: Array<{ entityId: string; score: number }>,
	paranoid?: boolean,
): Promise<Array<{ entityId: string; score: number }>> {
	const scoreMap = new Map<string, number>();

	// Seed with existing results
	for (const r of results) {
		const existing = scoreMap.get(r.entityId);
		if (existing === undefined || r.score > existing) {
			scoreMap.set(r.entityId, r.score);
		}
	}

	// Expand each candidate
	const candidateIds = results.map((r) => r.entityId);
	for (const entityId of candidateIds) {
		const edgeResult = await db.execute(
			"SELECT from_id, to_id FROM edges WHERE (from_id = ? OR to_id = ?) AND t_valid_until IS NULL",
			[entityId, entityId],
		);

		for (const row of edgeResult.rows) {
			const fromId = row.from_id as string;
			const toId = row.to_id as string;
			const neighborId = fromId === entityId ? toId : fromId;

			// Skip if already in the result set
			if (scoreMap.has(neighborId)) continue;

			// Validate the neighbor is active (and paranoid-safe)
			const paranoidClause = paranoid ? " AND trust_tier < 4" : "";
			const check = await db.execute(
				`SELECT id FROM entities WHERE id = ? AND t_valid_until IS NULL AND archived_at IS NULL${paranoidClause}`,
				[neighborId],
			);
			if (check.rows.length === 0) continue;

			scoreMap.set(neighborId, 0.7);
		}
	}

	return [...scoreMap.entries()].map(([entityId, score]) => ({
		entityId,
		score,
	}));
}

/**
 * Attach extraction_method to results that don't already have it set.
 * Only queries the DB for results where extraction_method is undefined.
 */
async function attachProvenance(
	db: SiaDb,
	results: SiaSearchResult[],
): Promise<void> {
	for (const result of results) {
		if (result.extraction_method === undefined) {
			const row = await db.execute(
				"SELECT extraction_method FROM entities WHERE id = ?",
				[result.id],
			);
			if (row.rows.length > 0) {
				result.extraction_method =
					(row.rows[0].extraction_method as string | null) ?? null;
			}
		}
	}
}
