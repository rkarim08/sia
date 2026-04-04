// Module: search — Five-stage hybrid retrieval pipeline
//
// Stage 1: Parallel BM25 + graph traversal + vector search
// Stage 2: 1-hop neighbor expansion for candidates
// Stage 3: Cross-encoder reranking filter (optional, 500ms timeout)
// Stage 4: RRF combination + trust-weighted reranking
// Stage 5: Attention fusion head or RRF fallback
// Global queries bypass the pipeline and return community summaries.
//
// Design note: The cross-encoder score is NOT fused into the RRF combination (Stage 4).
// RRF assumes independent unsupervised rankers. CE is supervised and correlated with
// the signals it re-scores, violating RRF's independence assumption. Instead, CE acts
// as a pre-filter (Stage 3) that eliminates low-quality candidates before RRF.

import type { Embedder, NamedEmbedder } from "@/capture/embedder";
import type { SiaDb } from "@/graph/db-interface";
import type { OnnxSession } from "@/models/types";
import type { CrossEncoderReranker } from "@/retrieval/cross-encoder";
import type { SiaSearchResult } from "@/mcp/tools/sia-search";
import type { TaskType } from "@/shared/config";
import { bm25Search } from "@/retrieval/bm25-search";
import { graphTraversalSearch } from "@/retrieval/graph-traversal";
import { classifyQuery } from "@/retrieval/query-classifier";
import { selectEmbedders } from "@/retrieval/query-router";
import { type RankedCandidate, rerank, rrfCombine } from "@/retrieval/reranker";
import { vectorSearch } from "@/retrieval/vector-search";

/** Options accepted by hybridSearch. */
export interface SearchOptions {
	query: string;
	taskType?: TaskType;
	nodeTypes?: string[];
	packagePath?: string;
	paranoid?: boolean;
	limit?: number;
	includeProvenance?: boolean;
	communityMinGraphSize?: number;
	crossEncoderTimeoutMs?: number;
}

/** Result returned by hybridSearch. */
export interface SearchResult {
	results: SiaSearchResult[];
	mode: "local" | "global";
	globalUnavailable: boolean;
	/** Whether vector search was used in this query (embedder was available). */
	vectorSearchUsed?: boolean;
	/** Model tier active during this search (from config). */
	modelTier?: string;
	/** Total candidate entities before reranking. */
	totalCandidates?: number;
}

/** Optional pipeline dependencies for extended stages. */
export interface PipelineDeps {
	crossEncoder?: CrossEncoderReranker | null;
	attentionFusionSession?: OnnxSession | null;
	codeEmbedder?: NamedEmbedder | null;
}

/** Default minimum graph size before community summaries are available. */
const DEFAULT_COMMUNITY_MIN_GRAPH_SIZE = 100;

/** Module-level flag to avoid repeated attention-fusion debug logging. */
let _attentionFusionFallbackLogged = false;

/**
 * Five-stage hybrid retrieval pipeline.
 *
 * 1. Classify query as local or global.
 * 2. If global, return community summaries from the `communities` table.
 * 3. Stage 1: parallel BM25 + graph traversal + vector search.
 * 4. Stage 2: expand 1-hop neighbors for every candidate.
 * 5. Stage 3: cross-encoder reranking filter (optional, 500ms timeout).
 * 6. Stage 4: RRF combine + trust-weighted rerank.
 * 7. Stage 5: attention fusion head or RRF fallback.
 * 8. Post-filter by nodeTypes if specified.
 * 9. Attach extraction_method if includeProvenance is set.
 *
 * The `embedder` parameter is nullable -- when null, vector search is skipped
 * and the pipeline runs on BM25 + graph traversal only.
 */
export async function hybridSearch(
	db: SiaDb,
	embedder: Embedder | null,
	opts: SearchOptions,
	deps?: PipelineDeps,
): Promise<SearchResult> {
	const limit = opts.limit ?? 15;
	const communityMinGraphSize = opts.communityMinGraphSize ?? DEFAULT_COMMUNITY_MIN_GRAPH_SIZE;

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
			vectorSearchUsed: false,
			totalCandidates: 0,
		};
	}

	// --- Stage 1: parallel retrieval signals ------------------------------
	const searchOpts = {
		limit: limit * 3, // over-fetch to leave room for reranking
		paranoid: opts.paranoid,
		packagePath: opts.packagePath,
	};

	// Determine which embedders to use based on query content
	const embedderSelection = selectEmbedders(opts.query, opts.taskType);
	const useNlEmbedder = embedder && embedderSelection.useNlEmbedder;
	const useCodeEmbedder = deps?.codeEmbedder && embedderSelection.useCodeEmbedder;

	const [bm25Results, graphResults, vecResults, codeVecResults] = await Promise.all([
		bm25Search(db, opts.query, searchOpts),
		graphTraversalSearch(db, opts.query, searchOpts),
		useNlEmbedder ? vectorSearch(db, opts.query, embedder, searchOpts) : Promise.resolve([]),
		useCodeEmbedder ? vectorSearch(db, opts.query, deps!.codeEmbedder!, searchOpts) : Promise.resolve([]),
	]);

	// --- Stage 2: expand 1-hop neighbors ----------------------------------
	const expandedGraphResults = await expandNeighbors(db, graphResults, opts.paranoid);

	// --- Stage 3: Cross-encoder reranking (optional) ----------------------
	// Cross-encoder FILTERS candidates (top-K → top-N) and provides a score
	// feature for Stage 4. It is NOT fused via RRF — see design note at module header.
	const allCandidateIds = new Set<string>();
	for (const r of bm25Results) allCandidateIds.add(r.entityId);
	for (const r of expandedGraphResults) allCandidateIds.add(r.entityId);
	for (const r of vecResults) allCandidateIds.add(r.entityId);
	for (const r of codeVecResults) allCandidateIds.add(r.entityId);

	// Candidates that survive Stage 3 filtering; defaults to full set when no CE model.
	let filteredCandidateIds: Set<string> = allCandidateIds;
	const CE_TOP_N = 10;

	if (deps?.crossEncoder && allCandidateIds.size > 0) {
		// Fetch entity content for cross-encoder scoring
		const idArray = [...allCandidateIds];
		const placeholders = idArray.map(() => "?").join(", ");
		const { rows } = await db.execute(
			`SELECT id, content, summary FROM graph_nodes WHERE id IN (${placeholders})`,
			idArray,
		);

		const textMap = new Map<string, string>();
		for (const row of rows) {
			const text = `${(row.summary as string) ?? ""} ${(row.content as string) ?? ""}`.trim();
			textMap.set(row.id as string, text);
		}

		const candidates = idArray
			.filter((id) => textMap.has(id))
			.map((id) => ({ entityId: id, text: textMap.get(id)! }));

		// Stage 3 must not block the pipeline. Timeout configurable via crossEncoderTimeoutMs.
		// On timeout, ceResults is empty — all candidates survive with crossEncoderScore=0.
		const ceTimeoutMs = opts.crossEncoderTimeoutMs ?? 500;
		let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
		const ceResults = await Promise.race([
			deps.crossEncoder.rerank(opts.query, candidates),
			new Promise<Array<{ entityId: string; score: number }>>((resolve) => {
				timeoutHandle = setTimeout(() => resolve([]), ceTimeoutMs);
				if (typeof timeoutHandle === "object" && "unref" in timeoutHandle) {
					(timeoutHandle as NodeJS.Timeout).unref();
				}
			}),
		]);
		if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
		if (ceResults.length === 0 && candidates.length > 0) {
			console.debug(`[sia] cross-encoder: timed out after ${ceTimeoutMs}ms with ${candidates.length} candidates — using RRF ordering`);
		}
		const crossEncoderScores = new Map(ceResults.map((r) => [r.entityId, r.score]));

		// Filter: keep only top-N by CE score. Dropped candidates are excluded from
		// Stage 4 entirely. CE score is currently used for filtering only; it will be
		// passed as a feature to the attention fusion head in the activation phase.
		if (crossEncoderScores.size > 0) {
			filteredCandidateIds = new Set(
				[...crossEncoderScores.entries()]
					.sort((a, b) => b[1] - a[1])
					.slice(0, CE_TOP_N)
					.map(([entityId]) => entityId),
			);
		}
	}

	// --- Stage 4: RRF combine (BM25 + graph + vector + code-vector) --------
	// Only candidates that survived Stage 3 CE filtering are included.
	// CE score is NOT an RRF input — it is a feature for the attention fusion head.
	const bm25Candidates: RankedCandidate[] = bm25Results
		.filter((r) => filteredCandidateIds.has(r.entityId))
		.map((r) => ({ entityId: r.entityId, score: r.score }));
	const graphCandidates: RankedCandidate[] = expandedGraphResults
		.filter((r) => filteredCandidateIds.has(r.entityId))
		.map((r) => ({ entityId: r.entityId, score: r.score }));
	const vecCandidates: RankedCandidate[] = vecResults
		.filter((r) => filteredCandidateIds.has(r.entityId))
		.map((r) => ({ entityId: r.entityId, score: r.score }));
	const codeVecCandidates: RankedCandidate[] = codeVecResults
		.filter((r) => filteredCandidateIds.has(r.entityId))
		.map((r) => ({ entityId: r.entityId, score: r.score }));

	const rrfScores = rrfCombine(bm25Candidates, graphCandidates, vecCandidates, codeVecCandidates);

	// --- Stage 5: Attention fusion or RRF fallback -------------------------
	// attentionFusionSession is null until ≥50 real feedback events exist AND
	// a trained .onnx head is on disk. Until that gate passes, RRF rerank is used.
	// TODO: when attention fusion is activated, assemble CandidateFeatures from
	// entity data and call attentionFusion() instead of rerank().
	if (deps?.attentionFusionSession && !_attentionFusionFallbackLogged) {
		console.debug("[sia] attention fusion session provided but not yet active — using RRF fallback");
		_attentionFusionFallbackLogged = true;
	}

	let results: SiaSearchResult[] = await rerank(db, rrfScores, {
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
		vectorSearchUsed: useNlEmbedder || useCodeEmbedder ? true : false,
		totalCandidates: allCandidateIds.size,
	};
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Fetch community summaries for global-mode queries.
 * Returns communities that have a non-NULL summary, ordered by member_count DESC.
 */
async function fetchCommunitySummaries(db: SiaDb, limit: number): Promise<SiaSearchResult[]> {
	const result = await db.execute(
		"SELECT * FROM communities WHERE summary IS NOT NULL ORDER BY member_count DESC LIMIT ?",
		[limit],
	);

	return (result.rows as Record<string, unknown>[]).map((row) => ({
		id: row.id as string,
		type: "Community",
		name: row.id as string,
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

	// Expand each candidate via batched queries
	const candidateIds = results.map((r) => r.entityId);
	if (candidateIds.length > 0) {
		// Batch fetch all edges
		const placeholders = candidateIds.map(() => "?").join(", ");
		const edgeResult = await db.execute(
			`SELECT from_id, to_id FROM graph_edges
			 WHERE (from_id IN (${placeholders}) OR to_id IN (${placeholders}))
			   AND t_valid_until IS NULL`,
			[...candidateIds, ...candidateIds],
		);

		// Collect neighbor IDs (skip those already in scoreMap)
		const candidateSet = new Set(candidateIds);
		const neighborIds = new Set<string>();
		for (const row of edgeResult.rows) {
			const fromId = row.from_id as string;
			const toId = row.to_id as string;
			const neighborId = candidateSet.has(fromId) ? toId : fromId;
			if (!scoreMap.has(neighborId)) neighborIds.add(neighborId);
		}

		// Batch validate neighbors
		if (neighborIds.size > 0) {
			const nPlaceholders = [...neighborIds].map(() => "?").join(", ");
			const paranoidClause = paranoid ? " AND trust_tier < 4" : "";
			const validResult = await db.execute(
				`SELECT id FROM graph_nodes
				 WHERE id IN (${nPlaceholders})
				   AND t_valid_until IS NULL AND archived_at IS NULL${paranoidClause}`,
				[...neighborIds],
			);
			for (const row of validResult.rows) {
				scoreMap.set(row.id as string, 0.7);
			}
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
async function attachProvenance(db: SiaDb, results: SiaSearchResult[]): Promise<void> {
	const needsProvenance = results.filter((r) => r.extraction_method === undefined);
	if (needsProvenance.length === 0) return;

	const ids = needsProvenance.map((r) => r.id);
	const placeholders = ids.map(() => "?").join(", ");
	const { rows } = await db.execute(
		`SELECT id, extraction_method FROM graph_nodes WHERE id IN (${placeholders})`,
		ids,
	);

	const methodMap = new Map<string, string | null>();
	for (const row of rows) {
		methodMap.set(row.id as string, (row.extraction_method as string | null) ?? null);
	}

	for (const result of needsProvenance) {
		result.extraction_method = methodMap.get(result.id) ?? null;
	}
}
