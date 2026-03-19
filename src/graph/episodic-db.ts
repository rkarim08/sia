// Module: episodic-db — Episode CRUD and session tracking

import { v4 as uuid } from "uuid";
import type { SiaDb } from "@/graph/db-interface";
import type { Episode, InsertEpisodeInput } from "@/graph/types";

// Re-export the opener (canonical source: semantic-db.ts)
export { openEpisodicDb } from "@/graph/semantic-db";

/**
 * Insert a new episode into the episodic database.
 * Generates a UUID and sets ts=Date.now().
 */
export async function insertEpisode(db: SiaDb, input: InsertEpisodeInput): Promise<Episode> {
	const id = uuid();
	const ts = Date.now();

	const episode: Episode = {
		id,
		session_id: input.session_id,
		ts,
		type: input.type,
		role: input.role ?? null,
		content: input.content,
		tool_name: input.tool_name ?? null,
		file_path: input.file_path ?? null,
		trust_tier: input.trust_tier ?? 3,
	};

	await db.execute(
		`INSERT INTO episodes (id, session_id, ts, type, role, content, tool_name, file_path, trust_tier)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			episode.id,
			episode.session_id,
			episode.ts,
			episode.type,
			episode.role,
			episode.content,
			episode.tool_name,
			episode.file_path,
			episode.trust_tier,
		],
	);

	return episode;
}

/**
 * Retrieve all episodes for a given session, ordered by ts ASC.
 */
export async function getEpisodesBySession(db: SiaDb, sessionId: string): Promise<Episode[]> {
	const result = await db.execute(
		"SELECT id, session_id, ts, type, role, content, tool_name, file_path, trust_tier FROM episodes WHERE session_id = ? ORDER BY ts ASC",
		[sessionId],
	);
	return result.rows as unknown as Episode[];
}

/**
 * Retrieve the most recent episodes across all sessions, ordered by ts DESC.
 * Defaults to a limit of 20.
 */
export async function getRecentEpisodes(db: SiaDb, limit = 20): Promise<Episode[]> {
	const result = await db.execute(
		"SELECT id, session_id, ts, type, role, content, tool_name, file_path, trust_tier FROM episodes ORDER BY ts DESC LIMIT ?",
		[limit],
	);
	return result.rows as unknown as Episode[];
}

/**
 * Mark a session as processed in sessions_processed.
 * Uses an UPSERT so calling this multiple times updates the record.
 * Defaults pipeline_version to "1.0.0" if not provided.
 */
export async function markSessionProcessed(
	db: SiaDb,
	sessionId: string,
	status: "complete" | "partial" | "failed",
	entityCount: number,
	pipelineVersion?: string,
): Promise<void> {
	const processedAt = Date.now();
	const version = pipelineVersion ?? "1.0.0";

	await db.execute(
		`INSERT INTO sessions_processed (session_id, processing_status, processed_at, entity_count, pipeline_version)
		 VALUES (?, ?, ?, ?, ?)
		 ON CONFLICT(session_id) DO UPDATE SET
		   processing_status = excluded.processing_status,
		   processed_at = excluded.processed_at,
		   entity_count = excluded.entity_count,
		   pipeline_version = excluded.pipeline_version`,
		[sessionId, status, processedAt, entityCount, version],
	);
}

/**
 * Return session IDs that have not been successfully processed.
 * Includes sessions that have never been processed (no entry in sessions_processed)
 * and sessions whose processing_status is 'failed'.
 */
export async function getUnprocessedSessions(db: SiaDb): Promise<string[]> {
	const result = await db.execute(
		`SELECT DISTINCT e.session_id
		 FROM episodes e
		 LEFT JOIN sessions_processed sp ON sp.session_id = e.session_id
		 WHERE sp.session_id IS NULL OR sp.processing_status = 'failed'`,
		[],
	);
	return (result.rows as Array<{ session_id: string }>).map((r) => r.session_id);
}
