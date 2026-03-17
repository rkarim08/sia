// Module: sia-search — Simplified vector-only search for Phase 3
//
// Queries the entities table with active-only, paranoid, node_types,
// and package_path filters. Orders by importance DESC with a capped limit.
// The full 3-stage retrieval pipeline comes in Phase 7.

import type { z } from "zod";
import type { Embedder } from "@/capture/embedder";
import type { SiaDb } from "@/graph/db-interface";
import type { SiaSearchInput } from "@/mcp/server";
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
		return result.entities;
	}

	const clauses: string[] = ["t_valid_until IS NULL", "archived_at IS NULL"];
	const params: unknown[] = [];

	// Paranoid mode: exclude Tier 4 (External / untrusted) entities
	if (input.paranoid) {
		clauses.push("trust_tier != 4");
	}

	// Filter by node types
	if (input.node_types && input.node_types.length > 0) {
		const placeholders = input.node_types.map(() => "?").join(", ");
		clauses.push(`type IN (${placeholders})`);
		params.push(...input.node_types);
	}

	// Filter by package path
	if (input.package_path) {
		clauses.push("package_path = ?");
		params.push(input.package_path);
	}

	// Compute effective limit
	const rawLimit = input.limit ?? DEFAULT_LIMIT;
	const effectiveLimit = Math.min(Math.max(1, rawLimit), MAX_LIMIT);
	params.push(effectiveLimit);

	const whereClause = clauses.join(" AND ");
	const sql = `SELECT * FROM entities WHERE ${whereClause} ORDER BY importance DESC LIMIT ?`;

	const result = await db.execute(sql, params);

	return (result.rows as Record<string, unknown>[]).map((row) => {
		const base: SiaSearchResult = {
			id: row.id as string,
			type: row.type as string,
			name: row.name as string,
			summary: row.summary as string,
			content: row.content as string,
			trust_tier: row.trust_tier as number,
			confidence: row.confidence as number,
			importance: row.importance as number,
			tags: row.tags as string,
			file_paths: row.file_paths as string,
			conflict_group_id: (row.conflict_group_id as string | null) ?? null,
			t_valid_from: (row.t_valid_from as number | null) ?? null,
			// source_repo_name is not a column in the local schema — always null for local graphs
			source_repo_name: null,
		};

		if (input.include_provenance) {
			base.extraction_method = (row.extraction_method as string | null) ?? null;
		}

		return base;
	});
}
