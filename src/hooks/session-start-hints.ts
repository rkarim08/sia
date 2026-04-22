// SessionStart first-run hints.
//
// Small pure helpers that decide whether to emit a one-line nudge
// (empty graph, missing model, etc.) when the user opens a session.
// Kept in a separate module so they are importable by tests without
// triggering the hook's main() side-effects.

export interface HintDb {
	execute: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
}

/**
 * First-run hint: if the graph has zero active entities, nudge the user to
 * run /sia-setup. Returns an empty string silently if the `graph_nodes`
 * table doesn't exist yet (brand-new session predating schema) or any
 * error occurs — this hint must never break SessionStart.
 */
export async function getEmptyGraphHint(db: HintDb): Promise<string> {
	try {
		const tableCheck = await db.execute(
			"SELECT name FROM sqlite_master WHERE type='table' AND name='graph_nodes'",
		);
		if (tableCheck.rows.length === 0) return "";
		const countResult = await db.execute(
			"SELECT COUNT(*) AS c FROM graph_nodes WHERE archived_at IS NULL",
		);
		const row = countResult.rows[0] as { c?: number } | undefined;
		const count = Number(row?.c ?? 0);
		if (count === 0) {
			return "\n[Sia] No graph detected for this project. Run /sia-setup to bootstrap (~2 min). See README for the 5-step wizard.\n";
		}
		return "";
	} catch {
		return "";
	}
}
