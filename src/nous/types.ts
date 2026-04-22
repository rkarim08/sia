// Module: nous/types — shared Nous types, constants, and defaults

export type SessionType = "primary" | "subagent" | "worktree";
export type SignalType = "discomfort" | "surprise" | "drift" | "parallel-agent-noise";
export type HistoryEventType = "discomfort" | "surprise" | "drift" | "modify";

export interface NousSessionState {
	driftScore: number;
	preferenceNodeIds: string[];
	currentCallSignificance: number;
	surpriseCount: number;
	nousModifyBlocked: boolean;
	discomfortRunningScore: number;
	toolCallCount: number;
	sessionStartedAt: number;
}

export interface NousSession {
	session_id: string;
	parent_session_id: string | null;
	session_type: SessionType;
	state: NousSessionState;
	created_at: number;
	updated_at: number;
}

export interface NousHistoryEvent {
	id?: number;
	session_id: string;
	event_type: HistoryEventType;
	score: number;
	created_at: number;
}

export interface NousConfig {
	enabled: boolean;
	discomfortThreshold: number;
	driftWarningThreshold: number;
	selfModifyBlockThreshold: number;
	historyWindowSize: number;
}

export const DEFAULT_NOUS_CONFIG: NousConfig = {
	enabled: true,
	discomfortThreshold: 0.6,
	driftWarningThreshold: 0.75,
	selfModifyBlockThreshold: 0.9,
	historyWindowSize: 20,
};

export const DEFAULT_SESSION_STATE: NousSessionState = {
	driftScore: 0.0,
	preferenceNodeIds: [],
	currentCallSignificance: 0.0,
	surpriseCount: 0,
	nousModifyBlocked: false,
	discomfortRunningScore: 0.0,
	toolCallCount: 0,
	sessionStartedAt: 0,
};

/**
 * Bookkeeping `kind` values that should never be surfaced by curiosity-style
 * retrieval. Shared between `nous_curiosity` (the retrieval tool) and
 * `nous_state` (the hint emitter) so both use identical exclusion sets.
 *
 * These kinds are pure session/meta bookkeeping: they record events, prompts,
 * flags, and per-session cognitive state rather than knowledge worth exploring.
 */
export const NOUS_BOOKKEEPING_KINDS = [
	"Episode",
	"Signal",
	"Concern",
	"Preference",
	"UserPrompt",
	"SessionFlag",
] as const;
