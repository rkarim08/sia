// Module: nous/working-memory — SQLite access layer for nous_sessions and nous_history
//
// Uses the raw bun:sqlite handle via SiaDb.rawSqlite() because these helpers are
// called from hot-path synchronous hook code. The underlying Database is synchronous,
// and the plan requires sync-style helpers. If a non-bun SiaDb backend is in use
// (e.g. LibSqlDb), rawSqlite() returns null and these helpers throw — which is fine
// because Nous hooks only run under the local bun-backed graph DB.

import type { SiaDb } from "@/graph/db-interface";
import type {
	HistoryEventType,
	NousHistoryEvent,
	NousSession,
	NousSessionState,
	SessionType,
} from "./types";

/** Retrieve the raw bun:sqlite Database handle, or throw if unavailable. */
function raw(db: SiaDb): NonNullable<ReturnType<SiaDb["rawSqlite"]>> {
	const r = db.rawSqlite();
	if (!r) {
		throw new Error("nous/working-memory requires a bun:sqlite-backed SiaDb");
	}
	return r;
}

export function upsertSession(db: SiaDb, session: NousSession): void {
	const now = Math.floor(Date.now() / 1000);
	raw(db)
		.prepare(
			`INSERT INTO nous_sessions (session_id, parent_session_id, session_type, state, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?)
			ON CONFLICT(session_id) DO UPDATE SET
				state = excluded.state,
				updated_at = excluded.updated_at`,
		)
		.run(
			session.session_id,
			session.parent_session_id,
			session.session_type,
			JSON.stringify(session.state),
			session.created_at || now,
			now,
		);
}

export function getSession(db: SiaDb, sessionId: string): NousSession | null {
	const row = raw(db).prepare("SELECT * FROM nous_sessions WHERE session_id = ?").get(sessionId) as
		| Record<string, unknown>
		| undefined;
	if (!row) return null;
	return {
		session_id: row.session_id as string,
		parent_session_id: (row.parent_session_id as string | null) ?? null,
		session_type: row.session_type as SessionType,
		state: JSON.parse(row.state as string) as NousSessionState,
		created_at: row.created_at as number,
		updated_at: row.updated_at as number,
	};
}

export function updateSessionState(db: SiaDb, sessionId: string, state: NousSessionState): void {
	const now = Math.floor(Date.now() / 1000);
	raw(db)
		.prepare("UPDATE nous_sessions SET state = ?, updated_at = ? WHERE session_id = ?")
		.run(JSON.stringify(state), now, sessionId);
}

export function deleteSession(db: SiaDb, sessionId: string): void {
	raw(db).prepare("DELETE FROM nous_sessions WHERE session_id = ?").run(sessionId);
}

/**
 * Mark a session as ended by setting `nous_sessions.ended_at = now`.
 *
 * Returns `true` when the row existed and was updated, `false` when no row
 * matched `session_id` (safe no-op — the row may have already been pruned
 * by `cleanStaleSessions`, deleted by the Stop hook's `writeEpisode`, or
 * never written if Nous was disabled).
 *
 * Stored as unix-seconds to match `created_at` / `updated_at`. The column
 * is added by migration `013_nous_session_ended_at.sql`.
 */
export function markSessionEnded(
	db: SiaDb,
	sessionId: string,
	now: number = Math.floor(Date.now() / 1000),
): boolean {
	const result = raw(db)
		.prepare("UPDATE nous_sessions SET ended_at = ?, updated_at = ? WHERE session_id = ?")
		.run(now, now, sessionId);
	return (result.changes ?? 0) > 0;
}

/** Remove sessions whose last update is older than one hour. */
export function cleanStaleSessions(db: SiaDb): void {
	const cutoff = Math.floor(Date.now() / 1000) - 3600;
	raw(db).prepare("DELETE FROM nous_sessions WHERE updated_at < ?").run(cutoff);
}

export function appendHistory(db: SiaDb, event: Omit<NousHistoryEvent, "id">): void {
	raw(db)
		.prepare(
			"INSERT INTO nous_history (session_id, event_type, score, created_at) VALUES (?, ?, ?, ?)",
		)
		.run(
			event.session_id,
			event.event_type,
			event.score,
			event.created_at || Math.floor(Date.now() / 1000),
		);
}

export function getRecentHistory(db: SiaDb, limit: number): NousHistoryEvent[] {
	const rows = raw(db)
		.prepare("SELECT * FROM nous_history ORDER BY created_at DESC LIMIT ?")
		.all(limit) as Array<Record<string, unknown>>;
	return rows.map((r) => ({
		id: r.id as number,
		session_id: r.session_id as string,
		event_type: r.event_type as HistoryEventType,
		score: r.score as number,
		created_at: r.created_at as number,
	}));
}
