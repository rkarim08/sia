// Module: nous/discomfort-signal — PostToolUse approval-seeking detection
//
// Scans the model's response text for approval-seeking / sycophantic patterns
// ("you're absolutely right", "I apologize for the confusion", etc.) and writes
// a Signal node when the aggregate score crosses a significance-weighted threshold.
// Every invocation appends to nous_history — the Self-Monitor uses that history
// to compute drift at the next SessionStart.

import { v4 as uuid } from "uuid";
import type { SiaDb } from "@/graph/db-interface";
import { DEFAULT_NOUS_CONFIG, type NousConfig } from "./types";
import { appendHistory, getSession, updateSessionState } from "./working-memory";

interface ApprovalPattern {
	pattern: RegExp;
	weight: number;
}

const APPROVAL_PATTERNS: ApprovalPattern[] = [
	{ pattern: /you'?r?e? absolutely right/i, weight: 0.35 },
	{ pattern: /you'?r?e? (completely|totally|entirely) right/i, weight: 0.3 },
	{ pattern: /i (was wrong|made a mistake|stand corrected)/i, weight: 0.3 },
	{ pattern: /i apologize for (the confusion|that|my mistake)/i, weight: 0.2 },
	{ pattern: /good (point|catch|observation|call)/i, weight: 0.2 },
	{
		pattern:
			/that'?s? a (great|excellent|valid|fair) (point|suggestion|observation)/i,
		weight: 0.2,
	},
	{ pattern: /you'?r?e? right(,| —| \.)/i, weight: 0.25 },
];

export interface DiscomfortResult {
	score: number;
	signalFired: boolean;
	signalNodeId?: string;
}

export function runDiscomfortSignal(
	db: SiaDb,
	sessionId: string,
	responseText: string,
	config: NousConfig = DEFAULT_NOUS_CONFIG,
): DiscomfortResult {
	if (!config.enabled) return { score: 0, signalFired: false };

	const session = getSession(db, sessionId);
	if (!session) return { score: 0, signalFired: false };

	const rawScore = scoreApprovalSeeking(responseText);
	const significance = session.state.currentCallSignificance;

	// Low-significance calls get a more lenient effective threshold —
	// casual reads shouldn't fire on a single "good point".
	const effectiveThreshold =
		config.discomfortThreshold + (1 - significance) * 0.2;
	const signalFired = rawScore > effectiveThreshold;

	const now = Math.floor(Date.now() / 1000);
	const newDiscomfortScore = Math.max(
		session.state.discomfortRunningScore,
		rawScore,
	);

	updateSessionState(db, sessionId, {
		...session.state,
		discomfortRunningScore: newDiscomfortScore,
	});

	appendHistory(db, {
		session_id: sessionId,
		event_type: "discomfort",
		score: rawScore,
		created_at: now,
	});

	if (signalFired) {
		const signalNodeId = writeSignalNode(
			db,
			sessionId,
			session.session_type,
			rawScore,
			responseText,
		);
		return { score: rawScore, signalFired: true, signalNodeId };
	}

	return { score: rawScore, signalFired: false };
}

function scoreApprovalSeeking(text: string): number {
	let score = 0;
	for (const { pattern, weight } of APPROVAL_PATTERNS) {
		if (pattern.test(text)) score += weight;
	}
	return Math.min(1.0, score);
}

function writeSignalNode(
	db: SiaDb,
	sessionId: string,
	sessionType: string,
	score: number,
	snippet: string,
): string {
	const raw = db.rawSqlite();
	if (!raw) return "";
	const id = uuid();
	const now = Date.now();
	const trimmedSnippet = snippet.slice(0, 200);

	raw.prepare(
		`INSERT INTO graph_nodes (
			id, type, name, content, summary,
			tags, file_paths,
			trust_tier, confidence, base_confidence,
			importance, base_importance,
			access_count, edge_count,
			last_accessed, created_at, t_created,
			visibility, created_by,
			kind,
			captured_by_session_id, captured_by_session_type
		) VALUES (
			?, 'Signal', ?, ?, ?,
			'[]', '[]',
			2, ?, ?,
			0.5, 0.5,
			0, 0,
			?, ?, ?,
			'private', 'nous',
			'Signal',
			?, ?
		)`,
	).run(
		id,
		`discomfort:${sessionId}`,
		`Discomfort signal in session ${sessionId}: score ${score.toFixed(2)}\n\nSnippet: ${trimmedSnippet}`,
		`Discomfort score ${score.toFixed(2)} — approval-seeking detected`,
		score,
		score,
		now,
		now,
		now,
		sessionId,
		sessionType,
	);

	return id;
}
