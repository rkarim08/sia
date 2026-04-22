// Module: nous/signal-rollup — SessionEnd: aggregate session Signals → EpisodeSummary
//
// Phase A6 helper. At SessionEnd the primary Episode/SubagentEpisode node has
// already been written by the Stop hook's `writeEpisode()`. This helper adds a
// second, statistics-focused audit node — an `EpisodeSummary` — that aggregates
// the Signal nodes produced during the session:
//
//   • total signal count, split into discomfort / surprise buckets
//   • max intensity observed (Signal.confidence is the raw signal score)
//   • the wall-clock timestamp of the peak signal
//
// Only written when COUNT(signals) >= threshold (default 3 per Phase A6 plan).
// Below threshold the function is a no-op — small sessions have too little
// statistical weight to warrant a summary node.
//
// `EpisodeSummary` is a new `kind` on `graph_nodes`, registered as a
// bookkeeping kind in `src/nous/types.ts::NOUS_BOOKKEEPING_KINDS` so it is
// excluded from curiosity-style retrieval alongside `Episode` / `SubagentEpisode`.
// Separate from `Episode` so downstream consumers can reason about narrative vs
// statistical audit trails independently.

import { v4 as uuid } from "uuid";
import type { SiaDb } from "@/graph/db-interface";

/** Default minimum signal count for an EpisodeSummary to be written. */
export const DEFAULT_ROLLUP_THRESHOLD = 3;

/** Outcome of a rollup pass. */
export interface RollupResult {
	/** True iff an EpisodeSummary node was inserted this call. */
	created: boolean;
	/** Total Signal nodes observed for the session (captured_by_session_id match). */
	totalSignals: number;
	/** Signals whose name starts with `discomfort:` — approval-seeking bucket. */
	discomfortCount: number;
	/** Signals whose name starts with `surprise:` — prediction-error bucket. */
	surpriseCount: number;
	/** EpisodeSummary node id when created, else null. */
	summaryNodeId: string | null;
}

/** Row shape returned by the per-signal SELECT. */
interface SignalRow {
	name: string | null;
	confidence: number | null;
	created_at: number | null;
}

/**
 * Write an `EpisodeSummary` node aggregating Signal statistics for `sessionId`.
 *
 * Gated on `COUNT(signals) >= threshold` (default 3). Under threshold the
 * function returns `{ created: false, … }` without writing. Safe no-op when
 * the backing DB is not bun-backed (no raw handle available).
 *
 * Signal subtype (discomfort vs surprise) is inferred from the `name`
 * prefix — the existing Signal writers use names like `discomfort:<sid>` and
 * would write `surprise:<sid>` once the surprise-router lands in Phase 2.
 *
 * Body format (pipe-separated, machine-parseable for downstream consumers):
 *
 *   Session: <sid>
 *   Signals: <total> (discomfort: <d>, surprise: <s>)
 *   Max intensity: <peak>
 *   Peak at: <unix-ms>
 */
export function rollupSessionSignals(
	db: SiaDb,
	sessionId: string,
	threshold: number = DEFAULT_ROLLUP_THRESHOLD,
): RollupResult {
	const empty: RollupResult = {
		created: false,
		totalSignals: 0,
		discomfortCount: 0,
		surpriseCount: 0,
		summaryNodeId: null,
	};

	const raw = db.rawSqlite();
	if (!raw) return empty;

	// Pull the Signal rows captured during this session. `captured_by_session_id`
	// is the canonical linkage — same column used by the Episode writer.
	let rows: SignalRow[];
	try {
		rows = raw
			.prepare(
				`SELECT name, confidence, created_at
				 FROM graph_nodes
				 WHERE kind = 'Signal' AND captured_by_session_id = ?`,
			)
			.all(sessionId) as SignalRow[];
	} catch (err) {
		// Missing table or unexpected error — never break the hook.
		process.stderr.write(
			`[sia:signal-rollup] query failed: ${err instanceof Error ? err.message : String(err)}\n`,
		);
		return empty;
	}

	const totalSignals = rows.length;
	if (totalSignals < threshold) {
		return { ...empty, totalSignals };
	}

	let discomfortCount = 0;
	let surpriseCount = 0;
	let maxIntensity = 0;
	let peakAt = 0;

	for (const row of rows) {
		const name = row.name ?? "";
		if (name.startsWith("discomfort:")) {
			discomfortCount++;
		} else if (name.startsWith("surprise:")) {
			surpriseCount++;
		}

		const intensity = typeof row.confidence === "number" ? row.confidence : 0;
		if (intensity > maxIntensity) {
			maxIntensity = intensity;
			peakAt = row.created_at ?? 0;
		}
	}

	const now = Date.now();
	const id = uuid();
	const name = `EpisodeSummary:${sessionId}`;
	const content = [
		`Session: ${sessionId}`,
		`Signals: ${totalSignals} (discomfort: ${discomfortCount}, surprise: ${surpriseCount})`,
		`Max intensity: ${maxIntensity.toFixed(3)}`,
		`Peak at: ${peakAt}`,
	].join("\n");
	const summary = `Session ${sessionId}: ${totalSignals} signals (d:${discomfortCount}/s:${surpriseCount}), peak ${maxIntensity.toFixed(2)}`;

	try {
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
					?, 'EpisodeSummary', ?, ?, ?,
					'[]', '[]',
					2, 1.0, 1.0,
					0.5, 0.5,
					0, 0,
					?, ?, ?,
					'private', 'nous',
					?, 'EpisodeSummary',
					?, ?
				)`,
			)
			.run(id, name, content, summary, now, now, now, sessionId, sessionId, "primary");
	} catch (err) {
		process.stderr.write(
			`[sia:signal-rollup] insert failed: ${err instanceof Error ? err.message : String(err)}\n`,
		);
		return { ...empty, totalSignals };
	}

	return {
		created: true,
		totalSignals,
		discomfortCount,
		surpriseCount,
		summaryNodeId: id,
	};
}
