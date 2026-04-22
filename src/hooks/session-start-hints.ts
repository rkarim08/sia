// SessionStart first-run hints.
//
// Small pure helpers that decide whether to emit a one-line nudge
// (empty graph, missing model, etc.) when the user opens a session.
// Kept in a separate module so they are importable by tests without
// triggering the hook's main() side-effects.

export interface HintDb {
	execute: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
}

export const EMPTY_GRAPH_HINT =
	"\n[Sia] No graph detected for this project. Run /sia-setup to bootstrap (~2 min). See README for the 5-step wizard.\n";

/**
 * First-run hint: if the graph has zero active entities, nudge the user to
 * run /sia-setup. Returns an empty string when:
 *  - the `graph_nodes` table doesn't exist yet (brand-new session, no migrations)
 *  - the table exists but has at least one active entity
 *  - an unexpected error occurred (logged to stderr; hint must never break SessionStart)
 *
 * "Active" uses the canonical Sia filter: `t_valid_until IS NULL AND archived_at IS NULL`
 * — the same predicate `src/graph/entities.ts` uses so a bi-temporally invalidated
 * graph is still treated as empty here.
 */
export async function getEmptyGraphHint(db: HintDb): Promise<string> {
	try {
		const tableCheck = await db.execute(
			"SELECT name FROM sqlite_master WHERE type='table' AND name='graph_nodes'",
		);
		if (tableCheck.rows.length === 0) return "";
		const countResult = await db.execute(
			"SELECT COUNT(*) AS c FROM graph_nodes WHERE t_valid_until IS NULL AND archived_at IS NULL",
		);
		const row = countResult.rows[0] as { c?: number } | undefined;
		const count = Number(row?.c ?? 0);
		return count === 0 ? EMPTY_GRAPH_HINT : "";
	} catch (err) {
		process.stderr.write(
			`[sia] empty-graph hint failed (non-fatal): ${err instanceof Error ? err.message : String(err)}\n`,
		);
		return "";
	}
}
