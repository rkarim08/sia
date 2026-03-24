// Module: sia-search — Three-stage hybrid retrieval via BM25 + graph + vector
//
// Workspace routing is preserved from Phase 5.
// Local search delegates to the three-stage pipeline in @/retrieval/search.

import type { z } from "zod";
import type { Embedder } from "@/capture/embedder";
import type { SiaDb } from "@/graph/db-interface";
import { annotateFreshness } from "@/mcp/freshness-annotator";
import type { SiaSearchInput } from "@/mcp/server";
import { hybridSearch } from "@/retrieval/search";
import { workspaceSearch } from "@/retrieval/workspace-search";

/** Shape returned for each entity hit in sia_search results. */
export interface SiaSearchResult {
	id: string;
	type: string;
	name: string;
	summary: string;
	content: string;
	trust_tier: number;
	confidence: number;
	importance: number;
	tags: string;
	file_paths: string;
	conflict_group_id: string | null;
	t_valid_from: number | null;
	source_repo_name: string | null;
	extraction_method?: string | null;
}

/** Dependencies for workspace-scoped search. */
export interface WorkspaceDeps {
	metaDb: SiaDb;
	bridgeDb: SiaDb;
	workspaceId: string;
	primaryRepoId: string;
	siaHome?: string;
}

/** Maximum number of results sia_search will return regardless of input. */
const MAX_LIMIT = 15;

/** Default number of results when `limit` is not specified. */
const DEFAULT_LIMIT = 5;

/**
 * Execute a simplified search against the entities table.
 *
 * Filters:
 *  - Active only: t_valid_until IS NULL AND archived_at IS NULL
 *  - paranoid mode: additionally excludes trust_tier = 4
 *  - node_types: IN filter on type column
 *  - package_path: exact match on package_path column
 *
 * Results are ordered by importance DESC and capped at `limit` (default 5, max 15).
 * When `workspace: true` and workspaceDeps are provided, delegates to workspace search.
 */
export async function handleSiaSearch(
	db: SiaDb,
	input: z.infer<typeof SiaSearchInput>,
	_embedder?: Embedder,
	workspaceDeps?: WorkspaceDeps,
): Promise<SiaSearchResult[]> {
	// Workspace-scoped search
	if (input.workspace && workspaceDeps) {
		const result = await workspaceSearch({
			primaryDb: db,
			metaDb: workspaceDeps.metaDb,
			bridgeDb: workspaceDeps.bridgeDb,
			workspaceId: workspaceDeps.workspaceId,
			primaryRepoId: workspaceDeps.primaryRepoId,
			query: input.query,
			siaHome: workspaceDeps.siaHome,
			limit: input.limit,
			paranoid: input.paranoid,
			node_types: input.node_types,
			package_path: input.package_path,
		});
		return (await annotateFreshness(
			result.entities as unknown as Record<string, unknown>[],
			db,
		)) as unknown as SiaSearchResult[];
	}

	// Compute effective limit
	const rawLimit = input.limit ?? DEFAULT_LIMIT;
	const effectiveLimit = Math.min(Math.max(1, rawLimit), MAX_LIMIT);

	// Local search via three-stage pipeline
	const searchResult = await hybridSearch(db, _embedder ?? null, {
		query: input.query,
		taskType: input.task_type,
		nodeTypes: input.node_types,
		packagePath: input.package_path,
		paranoid: input.paranoid,
		limit: effectiveLimit,
		includeProvenance: input.include_provenance,
	});

	return (await annotateFreshness(
		searchResult.results as unknown as Record<string, unknown>[],
		db,
	)) as unknown as SiaSearchResult[];
}
