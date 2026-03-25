// Module: episodic-promoter — re-process failed/incomplete sessions

import type { CandidateFact } from "@/capture/types";
import type { BatchResult } from "@/decay/types";
import type { SiaDb } from "@/graph/db-interface";

/**
 * Gather session IDs that need (re-)processing:
 * 1. Explicitly failed sessions (processing_status = 'failed')
 * 2. Orphaned sessions (episodes exist but no sessions_processed row)
 */
async function findUnprocessedSessions(episodicDb: SiaDb): Promise<string[]> {
	const failed = await episodicDb.execute(
		"SELECT session_id FROM sessions_processed WHERE processing_status = 'failed'",
	);

	const orphaned = await episodicDb.execute(
		"SELECT DISTINCT session_id FROM episodes WHERE session_id NOT IN (SELECT session_id FROM sessions_processed)",
	);

	const ids = new Set<string>();
	for (const row of failed.rows) {
		ids.add(row.session_id as string);
	}
	for (const row of orphaned.rows) {
		ids.add(row.session_id as string);
	}

	return [...ids];
}

/**
 * Convert raw episode rows into CandidateFact instances.
 *
 * Uses a simplified extraction approach: each episode becomes a single
 * Concept candidate. Full Track A + Track B extraction is not invoked here
 * because this is a maintenance sweep, not a real-time pipeline.
 */
function episodesToCandidates(episodes: Record<string, unknown>[]): CandidateFact[] {
	const candidates: CandidateFact[] = [];

	for (const ep of episodes) {
		const content = (ep.content as string) ?? "";
		if (content.trim().length === 0) continue;

		const filePaths: string[] = [];
		if (ep.file_path && typeof ep.file_path === "string") {
			filePaths.push(ep.file_path);
		}

		const trustTier = (ep.trust_tier as 1 | 2 | 3 | 4) ?? 2;

		candidates.push({
			type: "Concept",
			name: content.slice(0, 50),
			content,
			summary: content.slice(0, 80),
			tags: [],
			file_paths: filePaths,
			trust_tier: trustTier,
			confidence: 0.5,
			extraction_method: "episodic-promoter",
		});
	}

	return candidates;
}

/**
 * Process up to `batchSize` failed or orphaned sessions, promoting their
 * episodic content into the semantic graph via consolidation.
 *
 * Returns `{ processed, remaining }` where `remaining` is true when the
 * batch was full (more work may exist).
 */
export async function promoteBatch(
	graphDb: SiaDb,
	episodicDb: SiaDb,
	batchSize: number,
): Promise<BatchResult> {
	const sessionIds = await findUnprocessedSessions(episodicDb);
	const toProcess = sessionIds.slice(0, batchSize);

	// Dynamic import so capture internals are only loaded when actually needed
	const { consolidate } = await import("@/capture/consolidate");

	let processed = 0;

	for (const sessionId of toProcess) {
		const { rows: episodes } = await episodicDb.execute(
			"SELECT content, trust_tier, tool_name, file_path FROM episodes WHERE session_id = ? ORDER BY ts ASC",
			[sessionId],
		);

		const candidates = episodesToCandidates(episodes);

		try {
			await consolidate(graphDb, candidates);

			await episodicDb.execute(
				"INSERT OR REPLACE INTO sessions_processed (session_id, processing_status, processed_at, entity_count, pipeline_version) VALUES (?, 'complete', ?, ?, 'maintenance-sweep')",
				[sessionId, Date.now(), candidates.length],
			);

			processed++;
		} catch (_err) {
			// Mark as failed so next sweep retries
			await episodicDb.execute(
				"INSERT OR REPLACE INTO sessions_processed (session_id, processing_status, processed_at, entity_count, pipeline_version) VALUES (?, 'failed', ?, 0, 'maintenance-sweep')",
				[sessionId, Date.now()],
			);
		}
	}

	return { processed, remaining: processed === batchSize };
}

/**
 * Drain all failed and orphaned sessions, processing one at a time.
 * Returns the total number of sessions successfully promoted.
 */
export async function promoteFailedSessions(graphDb: SiaDb, episodicDb: SiaDb): Promise<number> {
	let total = 0;

	for (;;) {
		const { processed, remaining } = await promoteBatch(graphDb, episodicDb, 10);
		total += processed;
		if (!remaining) break;
	}

	return total;
}
