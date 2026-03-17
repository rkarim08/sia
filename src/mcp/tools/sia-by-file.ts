// Module: sia-by-file — Retrieve knowledge graph entities associated with a file path

import type { z } from "zod";
import type { SiaDb } from "@/graph/db-interface";
import type { Entity } from "@/graph/entities";
import type { SiaByFileInput } from "@/mcp/server";

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
): Promise<SiaByFileResult> {
	const limit = input.limit ?? 10;
	const filePath = input.file_path;

	// --- Exact match ---
	const exactResult = await db.execute(
		`SELECT * FROM entities
		 WHERE EXISTS (SELECT 1 FROM json_each(file_paths) WHERE value = ?)
		   AND t_valid_until IS NULL
		   AND archived_at IS NULL
		 ORDER BY importance DESC
		 LIMIT ?`,
		[filePath, limit],
	);

	if (exactResult.rows.length > 0) {
		return { entities: exactResult.rows as unknown as Entity[] };
	}

	// --- Filename stem fallback ---
	// Extract filename from the path (last segment after '/')
	const parts = filePath.split("/");
	const filename = parts[parts.length - 1] ?? filePath;

	const stemResult = await db.execute(
		`SELECT * FROM entities
		 WHERE EXISTS (SELECT 1 FROM json_each(file_paths) WHERE value LIKE '%/' || ? || '%')
		   AND t_valid_until IS NULL
		   AND archived_at IS NULL
		 ORDER BY importance DESC
		 LIMIT ?`,
		[filename, limit],
	);

	return { entities: stemResult.rows as unknown as Entity[] };
}
