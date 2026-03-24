// Module: session-start — SessionStart command hook handler
//
// Fires when Claude Code starts a new session (or resumes an existing one).
// This handler runs as a command hook — it writes context to stdout, which
// Claude Code injects into the initial system prompt.
//
// Queries the graph for:
//   - Recent Decisions (limit 5) — architectural choices made in prior sessions
//   - All active Conventions — coding patterns the team follows
//   - Unresolved Bugs/ErrorEvents (limit 3) — known issues to watch out for

import type { SiaDb } from "@/graph/db-interface";
import type { HookEvent } from "@/hooks/types";

/** A single item summarised for session context injection. */
export interface ContextItem {
	name: string;
	summary: string;
}

/** The structured context gathered at session start. */
export interface SessionContext {
	decisions: Array<ContextItem>;
	conventions: Array<ContextItem>;
	errors: Array<ContextItem>;
	resuming: boolean;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Query active entities of a given type from the graph database.
 * Returns rows mapped to { name, summary } pairs.
 */
async function queryByType(db: SiaDb, type: string, limit?: number): Promise<Array<ContextItem>> {
	const sql = limit
		? "SELECT name, summary FROM graph_nodes WHERE type = ? AND t_valid_until IS NULL AND archived_at IS NULL ORDER BY created_at DESC LIMIT ?"
		: "SELECT name, summary FROM graph_nodes WHERE type = ? AND t_valid_until IS NULL AND archived_at IS NULL ORDER BY created_at DESC";

	const params: unknown[] = limit ? [type, limit] : [type];
	const result = await db.execute(sql, params);

	return result.rows.map((row) => ({
		name: (row.name as string) ?? "",
		summary: (row.summary as string) ?? "",
	}));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Query the graph for relevant context and format for injection.
 *
 * - Decisions: most recent 5 (architectural choices)
 * - Conventions: all active (coding patterns)
 * - Errors: most recent 3 unresolved Bugs / ErrorEvents
 */
export async function buildSessionContext(
	db: SiaDb,
	_cwd: string,
	isResume: boolean,
): Promise<SessionContext> {
	const [decisions, conventions, bugs, errorEvents] = await Promise.all([
		queryByType(db, "Decision", 5),
		queryByType(db, "Convention"),
		queryByType(db, "Bug", 3),
		queryByType(db, "ErrorEvent", 3),
	]);

	// Merge bugs and error events, keeping only 3 total
	const errors = [...bugs, ...errorEvents].slice(0, 3);

	return {
		decisions,
		conventions,
		errors,
		resuming: isResume,
	};
}

/**
 * Format the context as a concise markdown block for stdout output.
 * Claude Code injects this as context at the top of the session.
 */
export function formatSessionContext(context: SessionContext): string {
	const lines: string[] = [];

	const header = context.resuming
		? "## Sia — Resuming Session Context"
		: "## Sia — Session Knowledge Context";

	lines.push(header);
	lines.push("");

	if (context.decisions.length > 0) {
		lines.push("### Recent Decisions");
		for (const d of context.decisions) {
			lines.push(`- **${d.name}**: ${d.summary}`);
		}
		lines.push("");
	}

	if (context.conventions.length > 0) {
		lines.push("### Active Conventions");
		for (const c of context.conventions) {
			lines.push(`- **${c.name}**: ${c.summary}`);
		}
		lines.push("");
	}

	if (context.errors.length > 0) {
		lines.push("### Known Issues");
		for (const e of context.errors) {
			lines.push(`- **${e.name}**: ${e.summary}`);
		}
		lines.push("");
	}

	if (
		context.decisions.length === 0 &&
		context.conventions.length === 0 &&
		context.errors.length === 0
	) {
		lines.push("_No prior session knowledge found for this repository._");
		lines.push("");
	}

	// Lightweight nudge — CLAUDE.md has the full behavioral spec
	lines.push("---");
	lines.push("Sia memory tools are active. See CLAUDE.md for tool selection guidance.");
	lines.push("");

	return lines.join("\n");
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

/**
 * Main entry point for the `sia hook session-start` command.
 * Reads hook event JSON from stdin, builds context, and writes to stdout.
 * Claude Code reads the stdout output and injects it into the session.
 */
export async function runSessionStartHook(db: SiaDb, event: HookEvent): Promise<void> {
	const isResume = event.source === "resume";
	const context = await buildSessionContext(db, event.cwd, isResume);
	const formatted = formatSessionContext(context);
	process.stdout.write(formatted);
}
