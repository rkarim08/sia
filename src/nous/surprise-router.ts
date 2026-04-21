// Module: nous/surprise-router — PostToolUse prediction-error routing
// Phase 1: stub implementation. Full transformer-stack integration is deferred
// to Phase 2, which will read cross-encoder / ranker feedback to decide when a
// surprise has occurred. For now this function is a no-op placeholder so the
// PostToolUse handler can wire it in without behavioral changes.

import type { SiaDb } from "@/graph/db-interface";
import { DEFAULT_NOUS_CONFIG, type NousConfig } from "./types";
import { getSession } from "./working-memory";

export interface SurpriseResult {
	surpriseDetected: boolean;
	signalNodeId?: string;
}

export function runSurpriseRouter(
	db: SiaDb,
	sessionId: string,
	_toolResponse: unknown,
	config: NousConfig = DEFAULT_NOUS_CONFIG,
): SurpriseResult {
	if (!config.enabled) return { surpriseDetected: false };

	const session = getSession(db, sessionId);
	if (!session) return { surpriseDetected: false };

	// Phase 1 stub: no transformer-stack feedback available yet.
	// Returns false until the transformer stack integration lands in Phase 2.
	return { surpriseDetected: false };
}
