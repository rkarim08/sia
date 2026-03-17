// Module: flags — Session flag CRUD operations

import type { SiaDb } from "@/graph/db-interface";

/** A session flag row from the session_flags table. */
export interface SessionFlag {
	id: string;
	session_id: string;
	reason: string;
	transcript_position: number | null;
	created_at: number;
	consumed: number;
}

/**
 * Retrieve all unconsumed flags for a given session, ordered by creation time.
 */
export async function getUnconsumedFlags(db: SiaDb, sessionId: string): Promise<SessionFlag[]> {
	const result = await db.execute(
		"SELECT id, session_id, reason, transcript_position, created_at, consumed FROM session_flags WHERE session_id = ? AND consumed = 0 ORDER BY created_at",
		[sessionId],
	);
	return result.rows as unknown as SessionFlag[];
}

/**
 * Mark a single flag as consumed so it is not returned by getUnconsumedFlags.
 */
export async function markFlagConsumed(db: SiaDb, flagId: string): Promise<void> {
	await db.execute("UPDATE session_flags SET consumed = 1 WHERE id = ?", [flagId]);
}
