// Module: session-end — SessionEnd hook handler
//
// Fires when a Claude Code session ends (exit, sigint, or error).
// Records session statistics and can update the session entity's
// ended_at timestamp in the graph.
//
// Returns { status: "processed", nodes_this_session: N } where N is
// the count of entities created during this session.

import type { SiaDb } from "@/graph/db-interface";
import type { HookEvent, HookResponse } from "@/hooks/types";

/**
 * Count the number of entities created during a given session.
 * Looks up all entities whose source_episode matches the session_id.
 */
async function countSessionEntities(db: SiaDb, sessionId: string): Promise<number> {
	const result = await db.execute(
		"SELECT COUNT(*) as count FROM entities WHERE source_episode = ?",
		[sessionId],
	);

	const row = result.rows[0];
	if (!row) return 0;

	const count = row.count as number | bigint;
	return typeof count === "bigint" ? Number(count) : (count ?? 0);
}

/**
 * Create a SessionEnd hook handler bound to the given graph database.
 *
 * On session end:
 * 1. Counts all entities created during this session (via source_episode).
 * 2. Returns session statistics for observability.
 */
export function createSessionEndHandler(db: SiaDb): (event: HookEvent) => Promise<HookResponse> {
	return async (event: HookEvent): Promise<HookResponse> => {
		const sessionId = event.session_id;
		const nodesThisSession = await countSessionEntities(db, sessionId);

		return {
			status: "processed",
			nodes_this_session: nodesThisSession,
		};
	};
}
