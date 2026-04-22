// Module: nous/episode-writer — Stop hook: write Episode node, flush session state
//
// Fires at Stop. For primary sessions it writes a single Episode graph_node
// summarising the session (tool calls, drift, discomfort peak, Signal count).
// For subagent sessions it writes a SubagentEpisode node with the same schema
// but a distinct `kind` — subagent episodes do NOT participate in the primary
// Episode chain and are not counted in primary-session output. This gives every
// session an audit trail without polluting the Episode narrative.
// In both cases the nous_sessions row is deleted to keep working memory bounded.

import { v4 as uuid } from "uuid";
import type { SiaDb } from "@/graph/db-interface";
import { DEFAULT_NOUS_CONFIG, type NousConfig } from "./types";
import { appendHistory, deleteSession, getSession } from "./working-memory";

export async function writeEpisode(
	db: SiaDb,
	sessionId: string,
	config: NousConfig = DEFAULT_NOUS_CONFIG,
): Promise<void> {
	if (!config.enabled) return;

	const session = getSession(db, sessionId);
	if (!session) return;

	const raw = db.rawSqlite();
	if (!raw) {
		// Non-bun-backed DB: drop the session row and bail.
		deleteSession(db, sessionId);
		return;
	}

	const now = Date.now();
	const nowSec = Math.floor(now / 1000);

	// Both `primary` and `subagent` sessions get an audit-trail node. The
	// `kind` column differentiates them so downstream retrieval can include
	// or exclude subagent noise as appropriate. `worktree`-typed sessions
	// are still skipped — their narrative belongs to the parent worktree.
	const isPrimary = session.session_type === "primary";
	const isSubagent = session.session_type === "subagent";

	if (isPrimary || isSubagent) {
		const nodeKind = isPrimary ? "Episode" : "SubagentEpisode";

		const signalCountRow = raw
			.prepare(
				"SELECT COUNT(*) as cnt FROM graph_nodes WHERE kind = 'Signal' AND captured_by_session_id = ?",
			)
			.get(sessionId) as { cnt: number };
		const signalCount = signalCountRow.cnt;

		const name = `${nodeKind}:${sessionId}`;
		const description = [
			`Session: ${sessionId}`,
			`Type: ${session.session_type}`,
			`Tool calls: ${session.state.toolCallCount}`,
			`Signal nodes written: ${signalCount}`,
			`Final drift score: ${session.state.driftScore.toFixed(3)}`,
			`Surprise count: ${session.state.surpriseCount}`,
			`Discomfort peak: ${session.state.discomfortRunningScore.toFixed(3)}`,
		].join("\n");

		const summary = `Session ${sessionId}: ${session.state.toolCallCount} tool calls, ${signalCount} signals, drift=${session.state.driftScore.toFixed(2)}`;

		// `type` column mirrors `kind` so sqlite filters on either column
		// agree (same contract as the existing Episode write).
		raw
			.prepare(
				`INSERT INTO graph_nodes (
				id, type, name, content, summary,
				tags, file_paths,
				trust_tier, confidence, base_confidence,
				importance, base_importance,
				access_count, edge_count,
				last_accessed, created_at, t_created,
				visibility, created_by,
				session_id, kind,
				captured_by_session_id, captured_by_session_type
			) VALUES (
				?, ?, ?, ?, ?,
				'[]', '[]',
				2, 1.0, 1.0,
				0.5, 0.5,
				0, 0,
				?, ?, ?,
				'private', 'nous',
				?, ?,
				?, ?
			)`,
			)
			.run(
				uuid(),
				nodeKind,
				name,
				description,
				summary,
				now,
				now,
				now,
				sessionId,
				nodeKind,
				sessionId,
				session.session_type,
			);

		// Only primary sessions contribute to the drift history chain —
		// subagent drift is local to the subagent and shouldn't affect the
		// primary session's running baseline.
		if (isPrimary) {
			appendHistory(db, {
				session_id: sessionId,
				event_type: "drift",
				score: session.state.driftScore,
				created_at: nowSec,
			});
		}
	}

	deleteSession(db, sessionId);
}
