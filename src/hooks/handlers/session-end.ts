// Module: session-end — SessionEnd hook handler
//
// Fires when a Claude Code session ends (exit, sigint, or error). Performs
// the final consolidation pass before session teardown:
//
//   1. `promoteStagedEntities()` — one last chance to drain the staging queue
//      so any provisional Tier-4 rows that gained confidence mid-session get
//      promoted before the session context is gone. Same helper the PreCompact
//      hook wires in (Phase A5), reused here.
//   2. `rollupSessionSignals()` — aggregate the session's Signal nodes into a
//      single `EpisodeSummary` audit node, but only when COUNT(signals) ≥ 3.
//      Orthogonal to the Stop hook's Episode node: narrative vs statistics.
//   3. `markSessionEnded()` — stamp `nous_sessions.ended_at = now` for the
//      session that is ending so stale-session queries can distinguish clean
//      exits from abandoned sessions.
//
// Fail-safe: every DB call is wrapped. Any failure is logged to stderr and the
// hook still returns `{ status: 'processed', … }` with whatever counts were
// collected before the failure. Session teardown must never throw.
//
// Legacy response field `nodes_this_session` is preserved for backwards
// compatibility; Phase A6 adds staging + rollup fields on top.

import type { SiaDb } from "@/graph/db-interface";
import { promoteStagedEntities } from "@/graph/staging";
import type { HookEvent, HookResponse } from "@/hooks/types";
import { rollupSessionSignals } from "@/nous/signal-rollup";
import { markSessionEnded } from "@/nous/working-memory";

/** Minimum signals before an EpisodeSummary is written (Phase A6 plan §N=3). */
const SIGNAL_ROLLUP_THRESHOLD = 3;

/**
 * Count the number of entities created during a given session.
 * Looks up all entities whose source_episode matches the session_id.
 */
async function countSessionEntities(db: SiaDb, sessionId: string): Promise<number> {
	const result = await db.execute(
		"SELECT COUNT(*) as count FROM graph_nodes WHERE source_episode = ?",
		[sessionId],
	);

	const row = result.rows[0];
	if (!row) return 0;

	const count = row.count as number | bigint;
	return typeof count === "bigint" ? Number(count) : (count ?? 0);
}

/**
 * Create a SessionEnd hook handler bound to the given graph database.
 *
 * On session end:
 * 1. Counts all entities created during this session (via source_episode) —
 *    legacy field `nodes_this_session` kept for backwards compatibility.
 * 2. Drains the staging queue via `promoteStagedEntities()`.
 * 3. Rolls up session Signals into an `EpisodeSummary` node when ≥ 3 fired.
 * 4. Stamps `nous_sessions.ended_at`.
 *
 * Each step is independently try/catch-wrapped so a failure in one does not
 * stop the others from running. The hook always returns a safe shape.
 */
export function createSessionEndHandler(db: SiaDb): (event: HookEvent) => Promise<HookResponse> {
	return async (event: HookEvent): Promise<HookResponse> => {
		const sessionId = event.session_id;

		// -------------------------------------------------------------------
		// Step 1 — legacy entity count (preserved for backwards compat).
		// -------------------------------------------------------------------
		let nodesThisSession = 0;
		try {
			nodesThisSession = await countSessionEntities(db, sessionId);
		} catch (err) {
			process.stderr.write(
				`[sia:session-end] countSessionEntities failed: ${err instanceof Error ? err.message : String(err)}\n`,
			);
		}

		// -------------------------------------------------------------------
		// Step 2 — final staging drain. Failures logged, counts zeroed.
		// -------------------------------------------------------------------
		let stagingPromoted = 0;
		let stagingKept = 0;
		let stagingRejected = 0;
		try {
			const staging = await promoteStagedEntities(db);
			stagingPromoted = staging.promoted;
			stagingKept = staging.kept;
			stagingRejected = staging.rejected;
		} catch (err) {
			process.stderr.write(
				`[sia:session-end] promoteStagedEntities failed: ${err instanceof Error ? err.message : String(err)}\n`,
			);
		}

		// -------------------------------------------------------------------
		// Step 3 — signal rollup. Only creates EpisodeSummary when ≥ threshold.
		// -------------------------------------------------------------------
		let signalRollupCreated = false;
		try {
			const rollup = rollupSessionSignals(db, sessionId, SIGNAL_ROLLUP_THRESHOLD);
			signalRollupCreated = rollup.created;
		} catch (err) {
			process.stderr.write(
				`[sia:session-end] rollupSessionSignals failed: ${err instanceof Error ? err.message : String(err)}\n`,
			);
		}

		// -------------------------------------------------------------------
		// Step 4 — mark session ended. Safe no-op when row already gone.
		// -------------------------------------------------------------------
		try {
			markSessionEnded(db, sessionId);
		} catch (err) {
			process.stderr.write(
				`[sia:session-end] markSessionEnded failed: ${err instanceof Error ? err.message : String(err)}\n`,
			);
		}

		return {
			status: "processed",
			nodes_this_session: nodesThisSession,
			staging_promoted: stagingPromoted,
			staging_kept: stagingKept,
			staging_rejected: stagingRejected,
			signal_rollup_created: signalRollupCreated,
		};
	};
}
