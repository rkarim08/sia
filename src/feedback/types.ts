// Module: feedback/types — shared feedback event types for attention head training

/** Source of a feedback event. */
export type FeedbackSource = "visualizer" | "agent" | "cli" | "synthetic";

/** A single feedback event recording implicit user signal. */
export interface FeedbackEvent {
	id: string;
	queryText: string;
	entityId: string;
	signalStrength: number;
	source: FeedbackSource;
	timestamp: number;
	sessionId: string;
	rankPosition: number;
	candidatesShown: number;
}

/** Signal strength constants for different event types. */
export const SIGNAL_STRENGTHS = {
	// Visualizer signals (Tier 1 — highest quality)
	visualizer_click: 1.0,
	visualizer_expand: 0.8,
	visualizer_dwell_5s: 0.6,
	visualizer_code_inspect: 0.9,
	visualizer_search_click: 0.8,
	visualizer_skip: -0.2,

	// Claude agent signals (Tier 2)
	agent_cite: 0.7,
	agent_expand: 0.5,
	agent_accepted: 0.3,
	agent_corrected: -0.3,
	agent_ignore: -0.1,

	// CLI signals (Tier 3)
	cli_file_opened: 0.6,
	cli_result_used: 0.5,
} as const;

export type SignalType = keyof typeof SIGNAL_STRENGTHS;

/**
 * Create a validated FeedbackEvent from a signal type.
 *
 * Enforces:
 * - `signalStrength` is looked up from `SIGNAL_STRENGTHS[signalType]`
 * - `rankPosition` is in `[0, candidatesShown)`
 * - `candidatesShown` is > 0
 */
export function createFeedbackEvent(
	fields: Omit<FeedbackEvent, "signalStrength"> & { signalType: SignalType },
): FeedbackEvent {
	if (fields.candidatesShown <= 0) {
		throw new Error(`candidatesShown must be > 0; got ${fields.candidatesShown}`);
	}
	if (fields.rankPosition < 0 || fields.rankPosition >= fields.candidatesShown) {
		throw new Error(
			`rankPosition ${fields.rankPosition} out of range [0, ${fields.candidatesShown})`,
		);
	}
	const { signalType, ...rest } = fields;
	return {
		...rest,
		signalStrength: SIGNAL_STRENGTHS[signalType],
	};
}
