// Module: nous/self-monitor — SessionStart: load preferences, compute drift, inject warnings
//
// Invoked from the SessionStart hook. Writes a fresh nous_sessions row, reads
// the recent history window to compute a drift baseline, and returns the
// optional drift warning string for injection into the agent's context.

import type { SiaDb } from "@/graph/db-interface";
import { seedPreferences } from "./preference-seeder";
import {
	DEFAULT_NOUS_CONFIG,
	DEFAULT_SESSION_STATE,
	type NousConfig,
	type NousSession,
	type NousSessionState,
	type SessionType,
} from "./types";
import {
	appendHistory,
	cleanStaleSessions,
	getRecentHistory,
	upsertSession,
} from "./working-memory";

export interface SessionStartInput {
	session_id: string;
	cwd: string;
}

export interface SessionStartResult {
	session: NousSession;
	driftWarning: string | null;
	modifyBlocked: boolean;
}

export async function runSessionStart(
	db: SiaDb,
	input: SessionStartInput,
	config: NousConfig = DEFAULT_NOUS_CONFIG,
): Promise<SessionStartResult> {
	const now = Math.floor(Date.now() / 1000);

	if (!config.enabled) {
		const session: NousSession = {
			session_id: input.session_id,
			parent_session_id: null,
			session_type: "primary",
			state: { ...DEFAULT_SESSION_STATE, sessionStartedAt: now },
			created_at: now,
			updated_at: now,
		};
		return { session, driftWarning: null, modifyBlocked: false };
	}

	cleanStaleSessions(db);

	// First-run Preference seed — idempotent, no-op after first insert.
	seedPreferences(db);

	const sessionType = detectSessionType(db, input.session_id);
	const preferenceNodeIds = loadPreferenceNodeIds(db);

	const history = getRecentHistory(db, config.historyWindowSize);
	const driftScore = computeDriftScore(history);

	const state: NousSessionState = {
		...DEFAULT_SESSION_STATE,
		driftScore,
		preferenceNodeIds,
		nousModifyBlocked: driftScore > config.selfModifyBlockThreshold,
		sessionStartedAt: now,
	};

	const session: NousSession = {
		session_id: input.session_id,
		parent_session_id: null,
		session_type: sessionType,
		state,
		created_at: now,
		updated_at: now,
	};

	upsertSession(db, session);
	appendHistory(db, {
		session_id: input.session_id,
		event_type: "drift",
		score: driftScore,
		created_at: now,
	});

	return {
		session,
		driftWarning:
			driftScore > config.driftWarningThreshold
				? `[Nous] Drift warning: score ${driftScore.toFixed(2)} — behavioral deviation detected from baseline. Call nous_reflect before major decisions.`
				: null,
		modifyBlocked: state.nousModifyBlocked,
	};
}

/** Classify a session as primary or subagent based on concurrently active primary sessions. */
function detectSessionType(db: SiaDb, sessionId: string): SessionType {
	const raw = db.rawSqlite();
	if (!raw) return "primary";
	const cutoff = Math.floor(Date.now() / 1000) - 300;
	const row = raw
		.prepare(
			"SELECT COUNT(*) as cnt FROM nous_sessions WHERE session_type = 'primary' AND updated_at > ? AND session_id != ?",
		)
		.get(cutoff, sessionId) as { cnt: number };
	return row.cnt > 0 ? "subagent" : "primary";
}

function loadPreferenceNodeIds(db: SiaDb): string[] {
	const raw = db.rawSqlite();
	if (!raw) return [];
	// Graceful degradation if the Preference kind has not been seeded yet —
	// the query simply returns [].
	const rows = raw
		.prepare(
			"SELECT id FROM graph_nodes WHERE kind = 'Preference' AND t_valid_until IS NULL AND archived_at IS NULL LIMIT 50",
		)
		.all() as Array<{ id: string }>;
	return rows.map((r) => r.id);
}

function computeDriftScore(history: Array<{ score: number; event_type: string }>): number {
	const discomfortEvents = history.filter((e) => e.event_type === "discomfort");
	if (discomfortEvents.length === 0) return 0.0;
	const avg = discomfortEvents.reduce((sum, e) => sum + e.score, 0) / discomfortEvents.length;
	return Math.min(1.0, avg);
}
