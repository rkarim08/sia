// Module: mcp/tools/nous-state — returns current Nous cognitive state snapshot
//
// Read-only: projects the session's current driftScore, active Preference nodes,
// recent Signal nodes, surprise count, session type, and the nous_modify gate bit.

import type { SiaDb } from "@/graph/db-interface";
import { getSession } from "@/nous/working-memory";

export interface NousStateResult {
	driftScore: number;
	preferences: Array<{ id: string; name: string; description: string }>;
	recentSignals: Array<{ signal_type: string; score: number; description: string }>;
	surpriseCount: number;
	sessionType: string;
	parentSessionId: string | null;
	nousModifyBlocked: boolean;
}

export async function handleNousState(
	db: SiaDb,
	sessionId: string,
): Promise<NousStateResult> {
	const session = getSession(db, sessionId);

	if (!session) {
		return {
			driftScore: 0,
			preferences: [],
			recentSignals: [],
			surpriseCount: 0,
			sessionType: "unknown",
			parentSessionId: null,
			nousModifyBlocked: false,
		};
	}

	const { state } = session;
	const raw = db.rawSqlite();
	if (!raw) {
		// No bun:sqlite handle — return the in-memory state without enrichment.
		return {
			driftScore: state.driftScore,
			preferences: [],
			recentSignals: [],
			surpriseCount: state.surpriseCount,
			sessionType: session.session_type,
			parentSessionId: session.parent_session_id,
			nousModifyBlocked: state.nousModifyBlocked,
		};
	}

	// Load Preference node details (only active nodes).
	let preferences: Array<{ id: string; name: string; description: string }> = [];
	if (state.preferenceNodeIds.length > 0) {
		const placeholders = state.preferenceNodeIds.map(() => "?").join(",");
		preferences = raw
			.prepare(
				`SELECT id, name, summary as description FROM graph_nodes WHERE id IN (${placeholders}) AND t_valid_until IS NULL AND archived_at IS NULL`,
			)
			.all(...state.preferenceNodeIds) as Array<{ id: string; name: string; description: string }>;
	}

	// Load recent Signal nodes for this session.
	const recentSignals = raw
		.prepare(
			"SELECT name as signal_type, confidence as score, summary as description FROM graph_nodes WHERE kind = 'Signal' AND captured_by_session_id = ? ORDER BY created_at DESC LIMIT 5",
		)
		.all(sessionId) as Array<{ signal_type: string; score: number; description: string }>;

	return {
		driftScore: state.driftScore,
		preferences,
		recentSignals,
		surpriseCount: state.surpriseCount,
		sessionType: session.session_type,
		parentSessionId: session.parent_session_id,
		nousModifyBlocked: state.nousModifyBlocked,
	};
}
