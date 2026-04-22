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

/**
 * Staleness threshold in seconds. If the most recent `drift` event for a
 * session is older than this (or no drift event exists for the session at
 * all), `recomputeDriftIfStale` will re-run the drift calculation at Stop.
 *
 * Chosen as 120s: short enough that a multi-minute mid-session divergence
 * gets caught before the Stop hook closes the session, long enough that
 * sessions shorter than two minutes incur no extra work.
 */
export const DRIFT_STALENESS_SECONDS = 120;

export interface RecomputeDriftResult {
	/** True when the drift score was actually re-calculated and persisted. */
	recomputed: boolean;
	/** The session's current drift score after the (optional) recompute. */
	driftScore: number;
	/**
	 * Human-readable reason the recompute ran or was skipped. Useful for
	 * Stop-hook stderr logging and for tests to assert behaviour.
	 */
	reason:
		| "stale"
		| "signals-since-last-drift"
		| "no-prior-drift"
		| "session-not-found"
		| "disabled"
		| "fresh";
}

/**
 * Lightweight drift recompute called from the Stop hook. Only re-runs the
 * drift calculation (against the shared `nous_history` window) if the last
 * drift event for this session is stale or new discomfort/surprise signals
 * have been written since. Does NOT re-run the full SessionStart pipeline.
 *
 * Never throws — callers can assume a resolved Promise. On internal failure
 * the error is swallowed and returned as `{ recomputed: false, reason: 'session-not-found' }`
 * so the Stop hook can continue to `writeEpisode` unaffected.
 */
export async function recomputeDriftIfStale(
	db: SiaDb,
	sessionId: string,
	config: NousConfig = DEFAULT_NOUS_CONFIG,
	now: number = Math.floor(Date.now() / 1000),
): Promise<RecomputeDriftResult> {
	try {
		if (!config.enabled) {
			return { recomputed: false, driftScore: 0, reason: "disabled" };
		}

		const raw = db.rawSqlite();
		if (!raw) {
			return { recomputed: false, driftScore: 0, reason: "session-not-found" };
		}

		const sessionRow = raw
			.prepare("SELECT state FROM nous_sessions WHERE session_id = ?")
			.get(sessionId) as { state: string } | undefined;
		if (!sessionRow) {
			return { recomputed: false, driftScore: 0, reason: "session-not-found" };
		}

		const state = JSON.parse(sessionRow.state) as NousSessionState;

		// Last drift event for THIS session (the staleness anchor).
		const lastDriftRow = raw
			.prepare(
				"SELECT created_at FROM nous_history WHERE session_id = ? AND event_type = 'drift' ORDER BY created_at DESC LIMIT 1",
			)
			.get(sessionId) as { created_at: number } | undefined;

		let reason: RecomputeDriftResult["reason"];
		if (!lastDriftRow) {
			reason = "no-prior-drift";
		} else if (now - lastDriftRow.created_at >= DRIFT_STALENESS_SECONDS) {
			reason = "stale";
		} else {
			// Not yet stale by wall-clock — check whether any signal rows were
			// written since the last drift anchor. Scope to THIS session so
			// multi-agent concurrent sessions don't leak signals across each
			// other's staleness checks.
			const signalRow = raw
				.prepare(
					"SELECT COUNT(*) as cnt FROM nous_history WHERE event_type IN ('discomfort', 'surprise') AND created_at > ? AND session_id = ?",
				)
				.get(lastDriftRow.created_at, sessionId) as { cnt: number };
			if (signalRow.cnt > 0) {
				reason = "signals-since-last-drift";
			} else {
				return { recomputed: false, driftScore: state.driftScore, reason: "fresh" };
			}
		}

		const history = getRecentHistory(db, config.historyWindowSize);
		const driftScore = computeDriftScore(history);

		const newState: NousSessionState = {
			...state,
			driftScore,
			nousModifyBlocked: driftScore > config.selfModifyBlockThreshold,
		};

		raw
			.prepare("UPDATE nous_sessions SET state = ?, updated_at = ? WHERE session_id = ?")
			.run(JSON.stringify(newState), now, sessionId);

		appendHistory(db, {
			session_id: sessionId,
			event_type: "drift",
			score: driftScore,
			created_at: now,
		});

		return { recomputed: true, driftScore, reason };
	} catch (err) {
		// Contract: never throws. The Stop hook must be able to continue to
		// writeEpisode unaffected on any internal failure (DB closed, JSON
		// parse error, prepared-statement failure, etc.).
		process.stderr.write(
			`[Nous] recomputeDriftIfStale failed (non-fatal): ${err instanceof Error ? err.message : String(err)}\n`,
		);
		return { recomputed: false, driftScore: 0, reason: "session-not-found" };
	}
}
