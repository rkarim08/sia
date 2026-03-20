// Module: session-resume — Session resume CRUD operations

import type { SiaDb } from "@/graph/db-interface";

/** A session resume row returned by loadSubgraph. */
export interface SessionResumeRow {
	subgraph_json: string;
	last_prompt: string | null;
	budget_used: number;
}

/**
 * Persist (upsert) a session resume record for the given session.
 * If a row already exists for the session_id, it is updated in place.
 */
export async function saveSubgraph(
	db: SiaDb,
	sessionId: string,
	subgraphJson: string,
	lastPrompt: string | null,
	budgetUsed: number,
): Promise<void> {
	const now = Date.now();
	await db.execute(
		`INSERT INTO session_resume (session_id, subgraph_json, last_prompt, budget_used, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?)
		 ON CONFLICT(session_id) DO UPDATE SET
		   subgraph_json = excluded.subgraph_json,
		   last_prompt   = excluded.last_prompt,
		   budget_used   = excluded.budget_used,
		   updated_at    = excluded.updated_at`,
		[sessionId, subgraphJson, lastPrompt, budgetUsed, now, now],
	);
}

/**
 * Load the session resume record for the given session.
 * Returns null if no record exists.
 */
export async function loadSubgraph(db: SiaDb, sessionId: string): Promise<SessionResumeRow | null> {
	const result = await db.execute(
		"SELECT subgraph_json, last_prompt, budget_used FROM session_resume WHERE session_id = ?",
		[sessionId],
	);
	if (result.rows.length === 0) {
		return null;
	}
	return result.rows[0] as unknown as SessionResumeRow;
}

/**
 * Delete the session resume record for the given session.
 */
export async function deleteResume(db: SiaDb, sessionId: string): Promise<void> {
	await db.execute("DELETE FROM session_resume WHERE session_id = ?", [sessionId]);
}
