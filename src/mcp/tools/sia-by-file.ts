// Module: sia-by-file — Retrieve knowledge graph entities associated with a file path

import type { z } from "zod";
import type { SiaDb } from "@/graph/db-interface";
import type { Entity } from "@/graph/entities";
import { annotateFreshness } from "@/mcp/freshness-annotator";
import type { SiaByFileInput } from "@/mcp/server";
import type { WorkspaceDeps } from "@/mcp/tools/sia-search";
import { workspaceSearch } from "@/retrieval/workspace-search";

/** Result shape — same as SiaSearchResult (array of entities). */
export interface SiaByFileResult {
	entities: Entity[];
}

/**
 * Find active entities whose `file_paths` JSON array contains the given file path.
 *
 * 1. Exact match on `file_path` using json_each.
 * 2. If no exact match, fall back to filename stem match (LIKE '%/<stem>%').
 * 3. Results ordered by importance DESC, capped at `limit` (default 10).
 */
export async function handleSiaByFile(
	db: SiaDb,
	input: z.infer<typeof SiaByFileInput>,
	workspaceDeps?: WorkspaceDeps,
): Promise<SiaByFileResult> {
	const limit = input.limit ?? 10;
	const filePath = input.file_path;

	// Workspace-scoped search
	if (input.workspace && workspaceDeps) {
		const result = await workspaceSearch({
			primaryDb: db,
			metaDb: workspaceDeps.metaDb,
			bridgeDb: workspaceDeps.bridgeDb,
			workspaceId: workspaceDeps.workspaceId,
			primaryRepoId: workspaceDeps.primaryRepoId,
			query: filePath,
			siaHome: workspaceDeps.siaHome,
			limit,
		});
		const annotated = await annotateFreshness(result.entities as unknown as Record<string, unknown>[], db);
		return { entities: annotated as unknown as Entity[] };
	}

	// --- Exact match ---
	const exactResult = await db.execute(
		`SELECT * FROM graph_nodes
		 WHERE EXISTS (SELECT 1 FROM json_each(file_paths) WHERE value = ?)
		   AND t_valid_until IS NULL
		   AND archived_at IS NULL
		 ORDER BY importance DESC
		 LIMIT ?`,
		[filePath, limit],
	);

	if (exactResult.rows.length > 0) {
		const annotated = await annotateFreshness(exactResult.rows as unknown as Record<string, unknown>[], db);
		return { entities: annotated as unknown as Entity[] };
	}

	// --- Filename stem fallback ---
	// Extract filename from the path (last segment after '/')
	const parts = filePath.split("/");
	const filename = parts[parts.length - 1] ?? filePath;

	const stemResult = await db.execute(
		`SELECT * FROM graph_nodes
		 WHERE EXISTS (SELECT 1 FROM json_each(file_paths) WHERE value LIKE '%/' || ? || '%')
		   AND t_valid_until IS NULL
		   AND archived_at IS NULL
		 ORDER BY importance DESC
		 LIMIT ?`,
		[filename, limit],
	);

	const annotated = await annotateFreshness(stemResult.rows as unknown as Record<string, unknown>[], db);
	return { entities: annotated as unknown as Entity[] };
}
