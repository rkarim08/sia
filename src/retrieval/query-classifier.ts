// Module: query-classifier — Local vs global query routing + task-type boosts

import type { SiaDb } from "@/graph/db-interface";

export type QueryMode = "local" | "global";

export interface ClassificationResult {
	mode: QueryMode;
	globalUnavailable: boolean;
}

const GLOBAL_KEYWORDS: string[] = [
	"architecture",
	"overview",
	"explain",
	"structure",
	"high-level",
	"design",
	"modules",
	"subsystems",
];

const LOCAL_KEYWORDS: string[] = [
	"function",
	"class",
	"method",
	"variable",
	"import",
	"error",
	"bug",
	"fix",
	"implement",
	"where is",
	"how does",
	"what does",
];

/**
 * Classify a query as local (three-stage pipeline) or global (community summaries).
 *
 * Keyword-based classification: count matches against global and local keyword
 * lists, default to local when tied. If the graph is too small for meaningful
 * community summaries (fewer than `config.communityMinGraphSize` active
 * entities), force local and set `globalUnavailable: true`.
 */
export async function classifyQuery(
	db: SiaDb,
	query: string,
	config: { communityMinGraphSize: number },
): Promise<ClassificationResult> {
	const lower = query.toLowerCase();

	let globalScore = 0;
	for (const kw of GLOBAL_KEYWORDS) {
		if (lower.includes(kw)) {
			globalScore++;
		}
	}

	let localScore = 0;
	for (const kw of LOCAL_KEYWORDS) {
		if (lower.includes(kw)) {
			localScore++;
		}
	}

	// Default to local when tied (localScore >= globalScore means local wins on tie)
	let mode: QueryMode = globalScore > localScore ? "global" : "local";
	let globalUnavailable = false;

	// Check graph size — force local if too few entities for community summaries
	if (mode === "global") {
		const result = await db.execute(
			"SELECT COUNT(*) AS cnt FROM entities WHERE t_valid_until IS NULL AND archived_at IS NULL",
		);
		const count = Number((result.rows[0] as { cnt: number }).cnt);
		if (count < config.communityMinGraphSize) {
			mode = "local";
			globalUnavailable = true;
		}
	}

	return { mode, globalUnavailable };
}

/**
 * Task-type boost vectors: maps task type strings to sets of entity types
 * that should receive a scoring boost during reranking.
 */
export const TASK_TYPE_BOOSTS: Record<string, Set<string>> = {
	"bug-fix": new Set(["Bug", "Solution"]),
	regression: new Set(["Bug", "Solution"]),
	feature: new Set(["Concept", "Decision"]),
	review: new Set(["Convention"]),
};

/**
 * Package-path boost: returns 0.15 when the entity's package matches the
 * active package, 0 otherwise.
 */
export function packagePathBoost(entityPkg: string | null, activePkg: string | null): number {
	if (entityPkg != null && activePkg != null && entityPkg === activePkg) {
		return 0.15;
	}
	return 0;
}
