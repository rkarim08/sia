// Module: freshness-annotator — Adds freshness state to MCP tool results.
//
// Wraps entity results with a freshness annotation so Claude knows
// whether the source file has changed since the knowledge was captured.

import type { SiaDb } from "@/graph/db-interface";

export interface FreshnessAnnotatedEntity {
	[key: string]: unknown;
	freshness: "fresh" | "stale" | "rotten" | "unknown";
	freshness_note?: string;
}

/**
 * Annotate an array of entity results with freshness state.
 *
 * For each entity with file_paths, checks if the source file's mtime
 * is newer than the entity's updated_at timestamp. This is a lightweight
 * check — not the full DirtyTracker pipeline.
 */
export async function annotateFreshness(
	entities: Array<Record<string, unknown>>,
	db: SiaDb | null,
): Promise<FreshnessAnnotatedEntity[]> {
	if (!db) {
		return entities.map((e) => ({ ...e, freshness: "unknown" as const }));
	}

	const { statSync } = await import("node:fs");
	const { resolve } = await import("node:path");

	return entities.map((entity) => {
		const filePaths = entity.file_paths as string | null;
		if (!filePaths) {
			return { ...entity, freshness: "unknown" as const };
		}

		try {
			const paths = JSON.parse(filePaths) as string[];
			if (paths.length === 0) {
				return { ...entity, freshness: "unknown" as const };
			}

			const absPath = resolve(process.cwd(), paths[0]);
			const fileMtime = statSync(absPath).mtimeMs;
			const entityUpdated = (entity.updated_at as number) ?? (entity.created_at as number) ?? 0;

			if (fileMtime <= entityUpdated) {
				return { ...entity, freshness: "fresh" as const };
			}

			const staleDays = (fileMtime - entityUpdated) / (1000 * 60 * 60 * 24);
			if (staleDays > 30) {
				return {
					...entity,
					freshness: "rotten" as const,
					freshness_note: `Source file changed ${Math.round(staleDays)} days after capture — verify before using`,
				};
			}
			return {
				...entity,
				freshness: "stale" as const,
				freshness_note: "Source file changed since capture — may need verification",
			};
		} catch {
			return { ...entity, freshness: "unknown" as const };
		}
	});
}
