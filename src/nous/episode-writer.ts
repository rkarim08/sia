// Module: nous/episode-writer — Stop hook: write Episode node, flush session state
//
// Fires at Stop. For primary sessions it writes a single Episode graph_node
// summarising the session (tool calls, drift, discomfort peak, Signal count).
// Subagent sessions are intentionally skipped — they belong to the parent's
// narrative and would otherwise pollute the graph with noise.
// In both cases the nous_sessions row is deleted to keep working memory bounded.

import { v4 as uuid } from "uuid";
import type { SiaDb } from "@/graph/db-interface";
import { DEFAULT_NOUS_CONFIG, type NousConfig } from "./types";
import { appendHistory, deleteSession, getSession } from "./working-memory";

export async function writeEpisode(
	db: SiaDb,
	sessionId: string,
	_config: NousConfig = DEFAULT_NOUS_CONFIG,
): Promise<void> {
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

	if (session.session_type === "primary") {
		const signalCountRow = raw
			.prepare(
				"SELECT COUNT(*) as cnt FROM graph_nodes WHERE kind = 'Signal' AND captured_by_session_id = ?",
			)
			.get(sessionId) as { cnt: number };
		const signalCount = signalCountRow.cnt;

		const name = `Episode:${sessionId}`;
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
				?, 'Episode', ?, ?, ?,
				'[]', '[]',
				2, 1.0, 1.0,
				0.5, 0.5,
				0, 0,
				?, ?, ?,
				'private', 'nous',
				?, 'Episode',
				?, ?
			)`,
			)
			.run(
				uuid(),
				name,
				description,
				summary,
				now,
				now,
				now,
				sessionId,
				sessionId,
				session.session_type,
			);

		appendHistory(db, {
			session_id: sessionId,
			event_type: "drift",
			score: session.state.driftScore,
			created_at: nowSec,
		});
	}

	deleteSession(db, sessionId);
}
