// Module: compare — Compare knowledge graph state between two time points
//
// Usage:
//   sia compare --since 2026-03-01 --until 2026-03-15
//   sia compare --since "last week"

import type { SiaDb } from "@/graph/db-interface";

export interface CompareResult {
	added: Array<{ id: string; type: string; name: string; created_at: number }>;
	invalidated: Array<{ id: string; type: string; name: string; t_valid_until: number }>;
	archived: Array<{ id: string; type: string; name: string; archived_at: number }>;
	summary: { added: number; invalidated: number; archived: number };
}

export async function compareGraphState(
	db: SiaDb,
	since: number,
	until: number,
): Promise<CompareResult> {
	// Entities created in the time range
	const addedResult = await db.execute(
		`SELECT id, type, name, created_at FROM graph_nodes
		 WHERE created_at >= ? AND created_at <= ?
		 ORDER BY created_at DESC`,
		[since, until],
	);

	// Entities invalidated in the time range
	const invalidatedResult = await db.execute(
		`SELECT id, type, name, t_valid_until FROM graph_nodes
		 WHERE t_valid_until >= ? AND t_valid_until <= ?
		 ORDER BY t_valid_until DESC`,
		[since, until],
	);

	// Entities archived in the time range
	const archivedResult = await db.execute(
		`SELECT id, type, name, archived_at FROM graph_nodes
		 WHERE archived_at >= ? AND archived_at <= ?
		 ORDER BY archived_at DESC`,
		[since, until],
	);

	const added = addedResult.rows as CompareResult["added"];
	const invalidated = invalidatedResult.rows as CompareResult["invalidated"];
	const archived = archivedResult.rows as CompareResult["archived"];

	return {
		added,
		invalidated,
		archived,
		summary: {
			added: added.length,
			invalidated: invalidated.length,
			archived: archived.length,
		},
	};
}

export function formatComparison(result: CompareResult, since: number, until: number): string {
	const lines: string[] = [];
	const sinceDate = new Date(since).toISOString().split("T")[0];
	const untilDate = new Date(until).toISOString().split("T")[0];

	lines.push(`=== SIA Graph Comparison (${sinceDate} to ${untilDate}) ===\n`);
	lines.push(`Added:       ${result.summary.added}`);
	lines.push(`Invalidated: ${result.summary.invalidated}`);
	lines.push(`Archived:    ${result.summary.archived}`);

	if (result.added.length > 0) {
		lines.push("\n--- Added ---");
		for (const e of result.added.slice(0, 20)) {
			lines.push(`  + [${e.type}] ${e.name}`);
		}
		if (result.added.length > 20) lines.push(`  ... and ${result.added.length - 20} more`);
	}

	if (result.invalidated.length > 0) {
		lines.push("\n--- Invalidated (superseded) ---");
		for (const e of result.invalidated.slice(0, 10)) {
			lines.push(`  ~ [${e.type}] ${e.name}`);
		}
	}

	if (result.archived.length > 0) {
		lines.push("\n--- Archived (decayed) ---");
		for (const e of result.archived.slice(0, 10)) {
			lines.push(`  - [${e.type}] ${e.name}`);
		}
	}

	return lines.join("\n");
}

export async function runCompare(args: string[]): Promise<void> {
	const { resolveRepoHash } = await import("@/capture/hook");
	const { openGraphDb } = await import("@/graph/semantic-db");
	const { resolveSiaHome } = await import("@/shared/config");

	let since = Date.now() - 7 * 86400000; // default: last 7 days
	let until = Date.now();

	for (let i = 0; i < args.length; i++) {
		if (args[i] === "--since" && args[i + 1]) {
			since = new Date(args[++i]).getTime();
		} else if (args[i] === "--until" && args[i + 1]) {
			until = new Date(args[++i]).getTime();
		}
	}

	const cwd = process.cwd();
	const repoHash = resolveRepoHash(cwd);
	const siaHome = resolveSiaHome();
	const db = openGraphDb(repoHash, siaHome);

	try {
		const result = await compareGraphState(db, since, until);
		console.log(formatComparison(result, since, until));
	} finally {
		await db.close();
	}
}
