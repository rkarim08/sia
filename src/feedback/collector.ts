// Module: feedback/collector — persist and retrieve feedback events for attention head training

import { v4 as uuid } from "uuid";
import type { SiaDb } from "@/graph/db-interface";
import { createFeedbackEvent, SIGNAL_STRENGTHS, type FeedbackEvent, type FeedbackSource, type SignalType } from "@/feedback/types";

/** Input for recording a feedback event (id and timestamp are auto-generated). */
export interface RecordFeedbackInput {
	queryText: string;
	entityId: string;
	signalType: SignalType;
	source: FeedbackSource;
	sessionId: string;
	rankPosition: number;
	candidatesShown: number;
}

/** Feedback collector interface. */
export interface FeedbackCollector {
	record(input: RecordFeedbackInput): Promise<void>;
	getEventCount(): Promise<number>;
	getEvents(limit: number, offset?: number): Promise<FeedbackEvent[]>;
}

/**
 * Create a feedback collector that persists events to the graph database.
 * Events are stored in the `feedback_events` table created by migration 011.
 *
 * Supports four source types: 'visualizer', 'agent', 'cli', 'synthetic'.
 * Synthetic events (distillation labels from cross-encoder scoring) are stored
 * alongside organic events; the trainer weighs them at 0.5× once organic
 * signals accumulate.
 */
export function createFeedbackCollector(db: SiaDb): FeedbackCollector {
	return {
		async record(input: RecordFeedbackInput): Promise<void> {
			// Validation errors propagate — they indicate programmer bugs.
			// Only DB write errors are caught (feedback is best-effort).
			const event = createFeedbackEvent({
				id: uuid(),
				queryText: input.queryText,
				entityId: input.entityId,
				signalType: input.signalType,
				source: input.source,
				timestamp: Date.now(),
				sessionId: input.sessionId,
				rankPosition: input.rankPosition,
				candidatesShown: input.candidatesShown,
			});

			try {
				await db.execute(
					`INSERT INTO feedback_events
					 (id, query_text, entity_id, signal_strength, source, timestamp, session_id, rank_position, candidates_shown)
					 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
					[
						event.id,
						event.queryText,
						event.entityId,
						event.signalStrength,
						event.source,
						event.timestamp,
						event.sessionId,
						event.rankPosition,
						event.candidatesShown,
					],
				);
			} catch (err) {
				console.error(
					"[sia] feedback collector: failed to record event:",
					err instanceof Error ? err.message : String(err),
				);
			}
		},

		async getEventCount(): Promise<number> {
			try {
				const { rows } = await db.execute("SELECT COUNT(*) as cnt FROM feedback_events");
				return (rows[0]?.cnt as number) ?? 0;
			} catch (err) {
				console.error(
					"[sia] feedback collector: failed to get event count:",
					err instanceof Error ? err.message : String(err),
				);
				return 0;
			}
		},

		async getEvents(limit: number, offset = 0): Promise<FeedbackEvent[]> {
			try {
				const { rows } = await db.execute(
					"SELECT * FROM feedback_events ORDER BY timestamp DESC LIMIT ? OFFSET ?",
					[limit, offset],
				);
				return rows.map((row) => ({
					id: row.id as string,
					queryText: row.query_text as string,
					entityId: row.entity_id as string,
					signalStrength: row.signal_strength as number,
					source: row.source as FeedbackSource,
					timestamp: row.timestamp as number,
					sessionId: row.session_id as string,
					rankPosition: row.rank_position as number,
					candidatesShown: row.candidates_shown as number,
				}));
			} catch (err) {
				console.error(
					"[sia] feedback collector: failed to get events:",
					err instanceof Error ? err.message : String(err),
				);
				return [];
			}
		},
	};
}
