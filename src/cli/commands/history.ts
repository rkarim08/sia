// Module: history — Temporal exploration of the knowledge graph
//
// Usage:
//   sia history                          Show last 7 days of knowledge
//   sia history --since 2026-03-01      Since a specific date
//   sia history --types Decision,Bug    Filter by entity type
//   sia history --file src/auth/login.ts  Filter by file

import type { SiaDb } from "@/graph/db-interface";

export interface HistoryOptions {
	since?: number;
	until?: number;
	types?: string[];
	file?: string;
	limit?: number;
}

export interface HistoryResult {
	entities: Array<{
		id: string;
		type: string;
		name: string;
		summary: string | null;
		kind: string | null;
		created_at: number;
		trust_tier: number;
	}>;
	timeRange: { since: number; until: number };
}

export async function getHistory(db: SiaDb, opts: HistoryOptions = {}): Promise<HistoryResult> {
	const since = opts.since ?? Date.now() - 7 * 86400000; // default 7 days
	const until = opts.until ?? Date.now();
	const limit = opts.limit ?? 50;

	let query = `SELECT id, type, name, summary, kind, created_at, trust_tier, file_paths
		FROM graph_nodes
		WHERE created_at >= ? AND created_at <= ?
		AND t_valid_until IS NULL AND archived_at IS NULL`;
	const params: unknown[] = [since, until];

	if (opts.types && opts.types.length > 0) {
		const placeholders = opts.types.map(() => "?").join(", ");
		query += ` AND type IN (${placeholders})`;
		params.push(...opts.types);
	}

	if (opts.file) {
		query += " AND file_paths LIKE ?";
		params.push(`%${opts.file}%`);
	}

	query += " ORDER BY created_at DESC LIMIT ?";
	params.push(limit);

	const result = await db.execute(query, params);

	return {
		entities: result.rows as HistoryResult["entities"],
		timeRange: { since, until },
	};
}

export function formatHistory(history: HistoryResult): string {
	const lines: string[] = [];
	const sinceDate = new Date(history.timeRange.since).toISOString().split("T")[0];
	const untilDate = new Date(history.timeRange.until).toISOString().split("T")[0];

	lines.push(`=== SIA Knowledge History (${sinceDate} to ${untilDate}) ===\n`);

	if (history.entities.length === 0) {
		lines.push("No knowledge captured in this time range.");
		return lines.join("\n");
	}

	// Group by date
	const byDate = new Map<string, typeof history.entities>();
	for (const entity of history.entities) {
		const date = new Date(entity.created_at).toISOString().split("T")[0];
		if (!byDate.has(date)) byDate.set(date, []);
		byDate.get(date)!.push(entity);
	}

	for (const [date, entities] of byDate) {
		lines.push(`--- ${date} (${entities.length} entities) ---`);
		for (const e of entities) {
			const tierLabel = e.trust_tier === 1 ? "user" : e.trust_tier === 2 ? "code" : e.trust_tier === 3 ? "llm" : "ext";
			lines.push(`  [${e.type}] ${e.name} (tier:${tierLabel})`);
			if (e.summary) lines.push(`    ${e.summary.slice(0, 100)}`);
		}
		lines.push("");
	}

	lines.push(`Total: ${history.entities.length} entities`);
	return lines.join("\n");
}

export async function runHistory(args: string[]): Promise<void> {
	const { resolveRepoHash } = await import("@/capture/hook");
	const { openGraphDb } = await import("@/graph/semantic-db");
	const { resolveSiaHome } = await import("@/shared/config");

	const opts: HistoryOptions = {};

	// Parse args
	for (let i = 0; i < args.length; i++) {
		if (args[i] === "--since" && args[i + 1]) {
			opts.since = new Date(args[++i]).getTime();
		} else if (args[i] === "--until" && args[i + 1]) {
			opts.until = new Date(args[++i]).getTime();
		} else if (args[i] === "--types" && args[i + 1]) {
			opts.types = args[++i].split(",");
		} else if (args[i] === "--file" && args[i + 1]) {
			opts.file = args[++i];
		} else if (args[i] === "--limit" && args[i + 1]) {
			opts.limit = parseInt(args[++i], 10);
		}
	}

	const cwd = process.cwd();
	const repoHash = resolveRepoHash(cwd);
	const siaHome = resolveSiaHome();
	const db = openGraphDb(repoHash, siaHome);

	try {
		const history = await getHistory(db, opts);
		console.log(formatHistory(history));
	} finally {
		await db.close();
	}
}
