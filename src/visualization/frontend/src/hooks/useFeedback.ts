// Module: useFeedback — implicit feedback collection from visualizer interactions
//
// Tracks: node clicks, expands, dwell time, code inspector opens,
// search result clicks, and skipped results.
// Events are batched in a ref and flushed to the SIA backend on demand.

import { useCallback, useRef } from "react";

/** A feedback event from the visualizer. */
export interface VisualizerFeedbackEvent {
	type: "click" | "expand" | "dwell" | "code_inspect" | "search_click" | "skip";
	entityId: string;
	queryText?: string;
	timestamp: number;
	dwellMs?: number;
}

/** Feedback hook options. */
export interface UseFeedbackOptions {
	/** API endpoint to send feedback events. */
	apiUrl?: string;
	/** Minimum dwell time (ms) to record as a dwell event. Default: 5000ms. */
	dwellThreshold?: number;
	/** Whether feedback collection is enabled. */
	enabled?: boolean;
}

/**
 * Hook for collecting implicit feedback from visualizer interactions.
 *
 * Signal strengths (from SIGNAL_STRENGTHS in feedback/types.ts):
 *   click → 1.0, expand → 0.8, dwell_5s → 0.6, skip → -0.2
 */
export function useFeedback(options: UseFeedbackOptions = {}) {
	const { dwellThreshold = 5000, enabled = true } = options;
	const eventsRef = useRef<VisualizerFeedbackEvent[]>([]);
	const dwellStartRef = useRef<{ entityId: string; startTime: number } | null>(null);

	/** Record a node click event. */
	const recordClick = useCallback(
		(entityId: string) => {
			if (!enabled) return;
			eventsRef.current.push({ type: "click", entityId, timestamp: Date.now() });
		},
		[enabled],
	);

	/** Record a node expand event. */
	const recordExpand = useCallback(
		(entityId: string) => {
			if (!enabled) return;
			eventsRef.current.push({ type: "expand", entityId, timestamp: Date.now() });
		},
		[enabled],
	);

	/** Start tracking dwell time for an entity. */
	const startDwell = useCallback(
		(entityId: string) => {
			if (!enabled) return;
			dwellStartRef.current = { entityId, startTime: Date.now() };
		},
		[enabled],
	);

	/** End dwell tracking. Records event only if dwell exceeded the threshold. */
	const endDwell = useCallback(() => {
		if (!enabled || !dwellStartRef.current) return;
		const { entityId, startTime } = dwellStartRef.current;
		const dwellMs = Date.now() - startTime;

		if (dwellMs >= dwellThreshold) {
			eventsRef.current.push({ type: "dwell", entityId, timestamp: Date.now(), dwellMs });
		}

		dwellStartRef.current = null;
	}, [enabled, dwellThreshold]);

	/** Record a code inspector open event. */
	const recordCodeInspect = useCallback(
		(entityId: string) => {
			if (!enabled) return;
			eventsRef.current.push({ type: "code_inspect", entityId, timestamp: Date.now() });
		},
		[enabled],
	);

	/** Record a search result click with the originating query. */
	const recordSearchClick = useCallback(
		(entityId: string, queryText: string) => {
			if (!enabled) return;
			eventsRef.current.push({ type: "search_click", entityId, queryText, timestamp: Date.now() });
		},
		[enabled],
	);

	/** Get all pending events and clear the buffer. */
	const flush = useCallback((): VisualizerFeedbackEvent[] => {
		const events = [...eventsRef.current];
		eventsRef.current = [];
		return events;
	}, []);

	/** Get current pending count. Use this instead of destructuring pendingCount. */
	const getPendingCount = useCallback(() => eventsRef.current.length, []);

	return {
		recordClick,
		recordExpand,
		startDwell,
		endDwell,
		recordCodeInspect,
		recordSearchClick,
		flush,
		/**
		 * Current pending count snapshot.
		 * WARNING: Do not destructure — `const { pendingCount } = useFeedback()`
		 * captures the value at call time. Use `getPendingCount()` for up-to-date reads.
		 */
		get pendingCount() {
			return eventsRef.current.length;
		},
		getPendingCount,
	};
}
