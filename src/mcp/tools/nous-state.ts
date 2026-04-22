// Module: mcp/tools/nous-state — returns current Nous cognitive state snapshot
//
// Read-only: projects the session's current driftScore, active Preference nodes,
// recent Signal nodes, surprise count, session type, and the nous_modify gate bit.
// Also emits a `next_steps` hint that chains to nous_reflect (on drift warning)
// or nous_curiosity (when no open Concerns and untouched high-trust entities exist).

import type { SiaDb } from "@/graph/db-interface";
import { MAX_ACCESS_COUNT } from "@/mcp/tools/nous-curiosity";
import { DEFAULT_NOUS_CONFIG, NOUS_BOOKKEEPING_KINDS } from "@/nous/types";
import { getSession } from "@/nous/working-memory";

export interface NousStateNextStep {
	tool: "nous_reflect" | "nous_curiosity";
	reason: string;
}

export interface NousStateResult {
	driftScore: number;
	preferences: Array<{ id: string; name: string; description: string }>;
	recentSignals: Array<{ signal_type: string; score: number; description: string }>;
	surpriseCount: number;
	sessionType: string;
	parentSessionId: string | null;
	nousModifyBlocked: boolean;
	next_steps: NousStateNextStep[];
}

export async function handleNousState(db: SiaDb, sessionId: string): Promise<NousStateResult> {
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
			next_steps: [],
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
			next_steps: buildNextSteps({
				driftScore: state.driftScore,
				openConcernCount: 0,
				untouchedHighTrustCount: 0,
			}),
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

	// Count open Concerns (status:open tag) — used to decide whether to nudge toward nous_curiosity.
	const openConcernRow = raw
		.prepare(
			"SELECT COUNT(*) as cnt FROM graph_nodes WHERE kind = 'Concern' AND tags LIKE '%status:open%' AND t_valid_until IS NULL AND archived_at IS NULL",
		)
		.get() as { cnt: number } | undefined;
	const openConcernCount = openConcernRow?.cnt ?? 0;

	// Count untouched/rarely-retrieved high-trust entities (trust_tier <= 2,
	// access_count <= MAX_ACCESS_COUNT, live).
	// Threshold and bookkeeping-kind exclusion must match nous_curiosity exactly
	// so the hint fires on precisely the entities that tool would return.
	const bookkeepingPlaceholders = NOUS_BOOKKEEPING_KINDS.map(() => "?").join(", ");
	const untouchedRow = raw
		.prepare(
			`SELECT COUNT(*) as cnt FROM graph_nodes
			 WHERE trust_tier <= 2
			   AND access_count <= ?
			   AND t_valid_until IS NULL
			   AND archived_at IS NULL
			   AND (kind IS NULL OR kind NOT IN (${bookkeepingPlaceholders}))`,
		)
		.get(MAX_ACCESS_COUNT, ...NOUS_BOOKKEEPING_KINDS) as { cnt: number } | undefined;
	const untouchedHighTrustCount = untouchedRow?.cnt ?? 0;

	return {
		driftScore: state.driftScore,
		preferences,
		recentSignals,
		surpriseCount: state.surpriseCount,
		sessionType: session.session_type,
		parentSessionId: session.parent_session_id,
		nousModifyBlocked: state.nousModifyBlocked,
		next_steps: buildNextSteps({
			driftScore: state.driftScore,
			openConcernCount,
			untouchedHighTrustCount,
		}),
	};
}

function buildNextSteps(args: {
	driftScore: number;
	openConcernCount: number;
	untouchedHighTrustCount: number;
}): NousStateNextStep[] {
	const steps: NousStateNextStep[] = [];
	const threshold = DEFAULT_NOUS_CONFIG.driftWarningThreshold;

	if (args.driftScore > threshold) {
		steps.push({
			tool: "nous_reflect",
			reason: `drift score ${args.driftScore.toFixed(2)} exceeds warning threshold ${threshold.toFixed(2)} — reflect before continuing`,
		});
	}

	if (args.openConcernCount === 0 && args.untouchedHighTrustCount > 0) {
		steps.push({
			tool: "nous_curiosity",
			reason: `no open Concerns and ${args.untouchedHighTrustCount} unretrieved high-trust entit${args.untouchedHighTrustCount === 1 ? "y" : "ies"} — explore the graph for knowledge gaps`,
		});
	}

	return steps;
}
