// Module: nous/significance-detector — PreToolUse significance weighting
//
// Runs synchronously at PreToolUse. Classifies the tool call by type and stores
// a significance score (0.0–1.0) on the current session. Downstream PostToolUse
// modules (discomfort-signal, surprise-router) read this score to decide
// whether to fire a signal.
//
// No-ops if the session row has not been created yet (e.g. SessionStart hook
// failed or was skipped) — hooks must never crash the CLI.

import type { SiaDb } from "@/graph/db-interface";
import { DEFAULT_NOUS_CONFIG, type NousConfig } from "./types";
import { getSession, updateSessionState } from "./working-memory";

const WRITE_TOOLS = new Set(["Write", "Edit", "NotebookEdit"]);
const READ_TOOLS = new Set(["Read", "NotebookRead"]);
const SEARCH_TOOLS = new Set(["Grep", "Glob", "WebSearch", "WebFetch"]);

export function runSignificanceDetector(
	db: SiaDb,
	sessionId: string,
	toolName: string,
	_toolInput: Record<string, unknown>,
	config: NousConfig = DEFAULT_NOUS_CONFIG,
): void {
	if (!config.enabled) return;

	const session = getSession(db, sessionId);
	if (!session) return;

	let significance: number;
	if (WRITE_TOOLS.has(toolName)) {
		significance = 1.0;
	} else if (toolName === "Bash") {
		significance = 0.5;
	} else if (READ_TOOLS.has(toolName)) {
		significance = 0.2;
	} else if (SEARCH_TOOLS.has(toolName)) {
		significance = 0.3;
	} else {
		significance = 0.4;
	}

	const newState = {
		...session.state,
		currentCallSignificance: significance,
		toolCallCount: session.state.toolCallCount + 1,
	};
	updateSessionState(db, sessionId, newState);
}
