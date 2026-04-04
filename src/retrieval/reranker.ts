// Module: reranker — RRF combination + trust-weighted scoring

import type { SiaDb } from "@/graph/db-interface";
import type { Entity } from "@/graph/entities";
import type { SiaSearchResult } from "@/mcp/tools/sia-search";
import { packagePathBoost, TASK_TYPE_BOOSTS } from "@/retrieval/query-classifier";
import type { TaskType } from "@/shared/config";

/** A candidate with an entity ID and a score from a single retrieval signal. */
export interface RankedCandidate {
	entityId: string;
	score: number;
}

/** Options for the rerank function. */
export interface RerankOpts {
	/** Task type for task-type boosting (e.g. "bug-fix", "feature"). */
	taskType?: TaskType;
	/** Active package path for same-package boosting. */
	packagePath?: string;
	/** If true, exclude Tier 4 entities. */
	paranoid?: boolean;
	/** Maximum number of results to return. */
	limit?: number;
	/** If true, include extraction_method in results. */
	includeProvenance?: boolean;
}

/** Trust weights keyed by tier number (1-4). No index-0. */
export const TRUST_WEIGHTS: Record<number, number> = {
	1: 1.0,
	2: 0.9,
	3: 0.7,
	4: 0.5,
};

/**
 * Combine multiple ranked candidate lists via Reciprocal Rank Fusion (k=60).
 *
 * Each list is sorted by score DESC. For each entity in each list,
 * the contribution is `1 / (k + rank + 1)` where rank is 0-based.
 * Scores are summed across all lists.
 */
export function rrfCombine(...lists: RankedCandidate[][]): Map<string, number> {
	const k = 60;
	const scores = new Map<string, number>();

	for (const list of lists) {
		// Sort by score descending to establish rank order
		const sorted = [...list].sort((a, b) => b.score - a.score);

		for (let rank = 0; rank < sorted.length; rank++) {
			const candidate = sorted[rank];
			const rrfScore = 1 / (k + rank + 1);
			const current = scores.get(candidate.entityId) ?? 0;
			scores.set(candidate.entityId, current + rrfScore);
		}
	}

	return scores;
}

/** Batch size for fetching entities from the database. */
const ENTITY_BATCH_SIZE = 500;

/**
 * Rerank entities by combining RRF scores with trust weights, importance,
 * confidence, task-type boosts, and package-path boosts.
 *
 * Formula: rrf_score * importance * confidence * trust_weight[tier] * (1 + task_boost * 0.3) + package_boost
 */
export async function rerank(
	db: SiaDb,
	rrfScores: Map<string, number>,
	opts?: RerankOpts,
): Promise<SiaSearchResult[]> {
	if (rrfScores.size === 0) {
		return [];
	}

	const entityIds = Array.from(rrfScores.keys());

	// Fetch entities in batches of 500
	const entities = new Map<string, Entity>();
	for (let i = 0; i < entityIds.length; i += ENTITY_BATCH_SIZE) {
		const batch = entityIds.slice(i, i + ENTITY_BATCH_SIZE);
		const placeholders = batch.map(() => "?").join(", ");
		const sql = `SELECT * FROM graph_nodes WHERE id IN (${placeholders}) AND t_valid_until IS NULL AND archived_at IS NULL`;
		const result = await db.execute(sql, batch);
		for (const row of result.rows) {
			entities.set(row.id as string, row as unknown as Entity);
		}
	}

	// Determine task-type boosted entity types
	const boostedTypes: Set<string> | undefined = opts?.taskType
		? TASK_TYPE_BOOSTS[opts.taskType]
		: undefined;

	// Score and filter
	const scored: Array<{ entity: Entity; finalScore: number }> = [];

	for (const [entityId, rrfScore] of rrfScores) {
		const entity = entities.get(entityId);
		if (!entity) {
			// Entity was invalidated, archived, or doesn't exist
			continue;
		}

		// Paranoid filter: remove Tier 4
		if (opts?.paranoid && entity.trust_tier === 4) {
			continue;
		}

		const trustWeight = TRUST_WEIGHTS[entity.trust_tier] ?? 0.5;
		const taskBoost = boostedTypes?.has(entity.type) ? 1 : 0;
		const pkgBoost = packagePathBoost(entity.package_path, opts?.packagePath ?? null);

		const finalScore =
			rrfScore * entity.importance * entity.confidence * trustWeight * (1 + taskBoost * 0.3) +
			pkgBoost;

		scored.push({ entity, finalScore });
	}

	// Sort by finalScore DESC
	scored.sort((a, b) => b.finalScore - a.finalScore);

	// Apply limit
	const limit = opts?.limit ?? 15;
	const top = scored.slice(0, limit);

	// Map to SiaSearchResult
	return top.map(({ entity, finalScore: _finalScore }) => {
		const base: SiaSearchResult = {
			id: entity.id,
			type: entity.type,
			name: entity.name,
			summary: entity.summary,
			content: entity.content,
			trust_tier: entity.trust_tier,
			confidence: entity.confidence,
			importance: entity.importance,
			tags: entity.tags,
			file_paths: entity.file_paths,
			conflict_group_id: entity.conflict_group_id ?? null,
			t_valid_from: entity.t_valid_from ?? null,
			source_repo_name: null,
		};

		if (opts?.includeProvenance) {
			base.extraction_method = entity.extraction_method ?? null;
		}

		return base;
	});
}
