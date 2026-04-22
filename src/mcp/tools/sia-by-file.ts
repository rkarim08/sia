// Module: sia-by-file — Retrieve knowledge graph entities associated with a file path

import type { z } from "zod";
import type { FeedbackCollector } from "@/feedback/collector";
import type { SiaDb } from "@/graph/db-interface";
import type { Entity } from "@/graph/entities";
import { annotateFreshness } from "@/mcp/freshness-annotator";
import { buildNextSteps, type NextStep } from "@/mcp/next-steps";
import type { SiaByFileInput } from "@/mcp/server";
import type { WorkspaceDeps } from "@/mcp/tools/sia-search";
import { workspaceSearch } from "@/retrieval/workspace-search";

/** Optional dependencies for recording agent feedback signals. */
export interface FeedbackDeps {
	feedbackCollector?: FeedbackCollector | null;
	sessionId?: string;
}

/** Result shape — same as SiaSearchResult (array of entities). */
export interface SiaByFileResult {
	entities: Entity[];
	next_steps?: NextStep[];
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
	feedbackDeps?: FeedbackDeps,
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
		const annotated = await annotateFreshness(
			result.entities as unknown as Record<string, unknown>[],
			db,
		);
		const entities = annotated as unknown as Entity[];
		await recordByFileFeedback(feedbackDeps, filePath, entities);
		return withNextSteps(entities);
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
		const annotated = await annotateFreshness(
			exactResult.rows as unknown as Record<string, unknown>[],
			db,
		);
		const entities = annotated as unknown as Entity[];
		await recordByFileFeedback(feedbackDeps, filePath, entities);
		return withNextSteps(entities);
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

	const annotated = await annotateFreshness(
		stemResult.rows as unknown as Record<string, unknown>[],
		db,
	);
	const entities = annotated as unknown as Entity[];
	await recordByFileFeedback(feedbackDeps, filePath, entities);
	return withNextSteps(entities);
}

/** Build a {@link SiaByFileResult} with `next_steps` populated. */
function withNextSteps(entities: Entity[]): SiaByFileResult {
	const nextSteps = buildNextSteps("sia_by_file", {
		resultCount: entities.length,
		topEntityId: entities[0]?.id,
	});
	return nextSteps.length > 0 ? { entities, next_steps: nextSteps } : { entities };
}

/**
 * Record per-entity agent feedback with the agent_cite signal (0.7).
 * Best-effort: any per-event failure is logged but never propagated.
 */
async function recordByFileFeedback(
	feedbackDeps: FeedbackDeps | undefined,
	filePath: string,
	entities: Entity[],
): Promise<void> {
	if (!feedbackDeps?.feedbackCollector || entities.length === 0) return;
	const sessionId = feedbackDeps.sessionId ?? "unknown";
	for (let i = 0; i < entities.length; i++) {
		try {
			await feedbackDeps.feedbackCollector.record({
				queryText: `file:${filePath}`,
				entityId: entities[i].id,
				signalType: "agent_cite",
				source: "agent",
				sessionId,
				rankPosition: i,
				candidatesShown: entities.length,
			});
		} catch (err) {
			console.error(`[sia] sia_by_file: failed to record feedback for ${entities[i].id}:`, err);
		}
	}
}
