// Module: mcp/tools/nous-reflect — full SELF-MONITOR pass on demand
//
// Read-only: recomputes drift from the fresh history window (not the cached
// session state), enumerates driving Signal nodes, and returns a recommended
// action (continue | pause | escalate) based on the drift thresholds.

import type { SiaDb } from "@/graph/db-interface";
import { DEFAULT_NOUS_CONFIG } from "@/nous/types";
import { getRecentHistory, getSession } from "@/nous/working-memory";

export interface ReflectInput {
	context?: string;
}

export interface ReflectResult {
	overallDrift: number;
	drivingSignals: Array<{ signal_type: string; score: number; description: string }>;
	recommendedAction: "continue" | "pause" | "escalate";
	sessionType: string;
	nousModifyBlocked: boolean;
}

export async function handleNousReflect(
	db: SiaDb,
	sessionId: string,
	_input: ReflectInput,
): Promise<ReflectResult> {
	const config = DEFAULT_NOUS_CONFIG;
	const session = getSession(db, sessionId);

	if (!session) {
		return {
			overallDrift: 0,
			drivingSignals: [],
			recommendedAction: "continue",
			sessionType: "unknown",
			nousModifyBlocked: false,
		};
	}

	// Recompute drift from history (fresh read, not cached state).
	const history = getRecentHistory(db, config.historyWindowSize);
	const discomfortEvents = history.filter(
		(e) => e.session_id === sessionId && e.event_type === "discomfort",
	);
	const overallDrift =
		discomfortEvents.length > 0
			? Math.min(1.0, discomfortEvents.reduce((s, e) => s + e.score, 0) / discomfortEvents.length)
			: 0.0;

	// Load Signal nodes as driving signals.
	const raw = db.rawSqlite();
	const drivingSignals = raw
		? (raw
				.prepare(
					"SELECT name as signal_type, confidence as score, summary as description FROM graph_nodes WHERE kind = 'Signal' AND captured_by_session_id = ? ORDER BY created_at DESC LIMIT 10",
				)
				.all(sessionId) as Array<{ signal_type: string; score: number; description: string }>)
		: [];

	let recommendedAction: "continue" | "pause" | "escalate" = "continue";
	if (overallDrift > config.selfModifyBlockThreshold) {
		recommendedAction = "escalate";
	} else if (overallDrift > config.driftWarningThreshold) {
		recommendedAction = "pause";
	}

	return {
		overallDrift,
		drivingSignals,
		recommendedAction,
		sessionType: session.session_type,
		nousModifyBlocked: session.state.nousModifyBlocked,
	};
}
