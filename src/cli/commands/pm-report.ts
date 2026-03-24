// Module: pm-report — Project management intelligence reports
//
// Generates sprint summaries, decision logs, and risk dashboards from the
// knowledge graph in PM-friendly language.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SiaDb } from "@/graph/db-interface";

export type PmReportType = "sprint" | "decisions" | "risks";

export interface PmReportOptions {
	type: PmReportType;
	since?: number;
	until?: number;
	outputPath?: string;
}

interface EntityRow {
	id: string;
	type: string;
	name: string;
	content: string;
	summary: string | null;
	trust_tier: number;
	importance: number;
	created_at: number;
	file_paths: string | null;
	kind: string | null;
	conflict_group_id: string | null;
}

function formatDate(ms: number): string {
	return new Date(ms).toISOString().split("T")[0];
}

async function queryEntities(
	db: SiaDb,
	types: string[],
	since?: number,
	until?: number,
): Promise<EntityRow[]> {
	const placeholders = types.map(() => "?").join(", ");
	let sql = `SELECT id, type, name, content, summary, trust_tier, importance, created_at, file_paths, kind, conflict_group_id
		FROM graph_nodes
		WHERE type IN (${placeholders}) AND t_valid_until IS NULL AND archived_at IS NULL`;
	const params: unknown[] = [...types];

	if (since != null) {
		sql += " AND created_at >= ?";
		params.push(since);
	}
	if (until != null) {
		sql += " AND created_at <= ?";
		params.push(until);
	}
	sql += " ORDER BY created_at ASC";

	const result = await db.execute(sql, params);
	return result.rows as unknown as EntityRow[];
}

function groupBy<T>(items: T[], key: (item: T) => string): Record<string, T[]> {
	const groups: Record<string, T[]> = {};
	for (const item of items) {
		const k = key(item);
		if (!groups[k]) groups[k] = [];
		groups[k].push(item);
	}
	return groups;
}

// ---------------------------------------------------------------------------
// Sprint Summary
// ---------------------------------------------------------------------------

async function generateSprintSummary(db: SiaDb, since: number, until: number): Promise<string> {
	const entities = await queryEntities(
		db,
		["Decision", "Bug", "Solution", "Convention", "Concept"],
		since,
		until,
	);

	if (entities.length === 0) {
		return `# Sprint Summary (${formatDate(since)} — ${formatDate(until)})\n\nNo activity captured in this time range.\n`;
	}

	const byType = groupBy(entities, (e) => e.type);
	const decisions = byType.Decision ?? [];
	const bugs = byType.Bug ?? [];
	const solutions = byType.Solution ?? [];
	const conventions = byType.Convention ?? [];
	const concepts = byType.Concept ?? [];

	const sections: string[] = [];

	// Header
	sections.push(`# Sprint Summary (${formatDate(since)} — ${formatDate(until)})`);
	sections.push("");

	// Executive summary
	const parts: string[] = [];
	if (decisions.length > 0)
		parts.push(`${decisions.length} decision${decisions.length === 1 ? "" : "s"} made`);
	if (bugs.length > 0) parts.push(`${bugs.length} bug${bugs.length === 1 ? "" : "s"} found`);
	if (solutions.length > 0)
		parts.push(`${solutions.length} fix${solutions.length === 1 ? "" : "es"} applied`);
	if (conventions.length > 0)
		parts.push(
			`${conventions.length} convention${conventions.length === 1 ? "" : "s"} established`,
		);
	sections.push(`**Overview:** ${parts.join(", ")}.`);
	sections.push("");

	// Key Decisions
	if (decisions.length > 0) {
		sections.push("## Key Decisions");
		sections.push("");
		for (const d of decisions) {
			sections.push(
				`- **${d.name}** (${formatDate(d.created_at)}) — ${d.summary ?? d.content.slice(0, 120)}`,
			);
		}
		sections.push("");
	}

	// Bugs
	if (bugs.length > 0) {
		sections.push("## Bugs Found");
		sections.push("");
		for (const b of bugs) {
			sections.push(
				`- **${b.name}** (${formatDate(b.created_at)}) — ${b.summary ?? b.content.slice(0, 120)}`,
			);
		}
		sections.push("");
	}

	// Solutions
	if (solutions.length > 0) {
		sections.push("## Solutions Applied");
		sections.push("");
		for (const s of solutions) {
			sections.push(
				`- **${s.name}** (${formatDate(s.created_at)}) — ${s.summary ?? s.content.slice(0, 120)}`,
			);
		}
		sections.push("");
	}

	// Conventions
	if (conventions.length > 0) {
		sections.push("## Conventions Established");
		sections.push("");
		for (const c of conventions) {
			sections.push(`- **${c.name}** — ${c.summary ?? c.content.slice(0, 120)}`);
		}
		sections.push("");
	}

	// Concepts
	if (concepts.length > 0) {
		sections.push("## Key Concepts");
		sections.push("");
		for (const c of concepts) {
			sections.push(`- **${c.name}** — ${c.summary ?? c.content.slice(0, 120)}`);
		}
		sections.push("");
	}

	// Metrics
	sections.push("## Metrics");
	sections.push("");
	sections.push(`| Category | Count |`);
	sections.push(`|---|---|`);
	sections.push(`| Decisions | ${decisions.length} |`);
	sections.push(`| Bugs found | ${bugs.length} |`);
	sections.push(`| Solutions applied | ${solutions.length} |`);
	sections.push(`| Conventions | ${conventions.length} |`);
	sections.push(`| Total entities | ${entities.length} |`);
	sections.push("");

	return sections.join("\n");
}

// ---------------------------------------------------------------------------
// Decision Log
// ---------------------------------------------------------------------------

async function generateDecisionLog(db: SiaDb, since?: number): Promise<string> {
	const decisions = await queryEntities(db, ["Decision"], since);

	if (decisions.length === 0) {
		const sinceStr = since ? ` since ${formatDate(since)}` : "";
		return `# Decision Log\n\nNo decisions captured${sinceStr}.\n`;
	}

	const sections: string[] = [];
	sections.push("# Decision Log");
	sections.push("");
	sections.push(
		`*${decisions.length} decision${decisions.length === 1 ? "" : "s"} captured${since ? ` since ${formatDate(since)}` : ""}*`,
	);
	sections.push("");

	for (let i = 0; i < decisions.length; i++) {
		const d = decisions[i];
		sections.push(`## ${i + 1}. ${d.name}`);
		sections.push("");
		sections.push(`- **Date:** ${formatDate(d.created_at)}`);
		sections.push(
			`- **Trust:** ${d.trust_tier === 1 ? "Verified" : d.trust_tier === 2 ? "Code-derived" : "Inferred"}`,
		);
		if (d.file_paths && d.file_paths !== "[]") {
			sections.push(`- **Files:** ${d.file_paths}`);
		}
		sections.push("");
		sections.push(d.content.slice(0, 500));
		sections.push("");
	}

	return sections.join("\n");
}

// ---------------------------------------------------------------------------
// Risk Dashboard
// ---------------------------------------------------------------------------

async function generateRiskDashboard(db: SiaDb): Promise<string> {
	const bugs = await queryEntities(db, ["Bug"]);
	const conflicts = await queryEntities(db, ["Decision", "Convention"]);
	const conflictsWithGroup = conflicts.filter((e) => e.conflict_group_id != null);
	const conventions = await queryEntities(db, ["Convention"]);

	if (bugs.length === 0 && conflictsWithGroup.length === 0 && conventions.length === 0) {
		return "# Risk Dashboard\n\nNo risks identified. The knowledge graph has no bugs, conflicts, or stale conventions.\n";
	}

	const sections: string[] = [];
	sections.push("# Risk Dashboard");
	sections.push("");
	sections.push(`*Generated ${formatDate(Date.now())}*`);
	sections.push("");

	// Group bugs by file path to find recurring areas
	const bugsByFile: Record<string, EntityRow[]> = {};
	for (const bug of bugs) {
		let filePaths: string[] = [];
		try {
			filePaths = JSON.parse(bug.file_paths ?? "[]");
		} catch {
			filePaths = [];
		}
		if (filePaths.length === 0) filePaths = ["unknown"];
		for (const fp of filePaths) {
			if (!bugsByFile[fp]) bugsByFile[fp] = [];
			bugsByFile[fp].push(bug);
		}
	}

	// Critical: areas with multiple bugs or unresolved conflicts
	const criticalAreas = Object.entries(bugsByFile).filter(([, b]) => b.length >= 2);
	const hasCritical = criticalAreas.length > 0 || conflictsWithGroup.length > 0;

	if (hasCritical) {
		sections.push("## Critical Risks");
		sections.push("");
		for (const [filePath, fileBugs] of criticalAreas) {
			sections.push(`### Recurring bugs: ${filePath}`);
			sections.push(`${fileBugs.length} bugs in the same area:`);
			for (const b of fileBugs) {
				sections.push(
					`- **${b.name}** (${formatDate(b.created_at)}) — ${b.summary ?? b.content.slice(0, 100)}`,
				);
			}
			sections.push("");
		}
		if (conflictsWithGroup.length > 0) {
			sections.push("### Unresolved conflicts");
			sections.push(`${conflictsWithGroup.length} entities have unresolved conflicts:`);
			for (const c of conflictsWithGroup) {
				sections.push(`- **${c.name}** (${c.type}) — conflict group: ${c.conflict_group_id}`);
			}
			sections.push("");
		}
	}

	// Moderate: stale conventions (older than 30 days)
	const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
	const staleConventions = conventions.filter((c) => c.created_at < thirtyDaysAgo);

	if (staleConventions.length > 0) {
		sections.push("## Moderate Risks");
		sections.push("");
		sections.push(`### Stale conventions (${staleConventions.length})`);
		sections.push("Conventions older than 30 days that may need review:");
		for (const c of staleConventions) {
			sections.push(
				`- **${c.name}** (${formatDate(c.created_at)}) — ${c.summary ?? c.content.slice(0, 100)}`,
			);
		}
		sections.push("");
	}

	// Individual bugs (not in recurring areas)
	const nonRecurringBugs = bugs.filter((b) => {
		let filePaths: string[] = [];
		try {
			filePaths = JSON.parse(b.file_paths ?? "[]");
		} catch {
			filePaths = [];
		}
		if (filePaths.length === 0) filePaths = ["unknown"];
		return filePaths.every((fp) => (bugsByFile[fp]?.length ?? 0) < 2);
	});

	if (nonRecurringBugs.length > 0) {
		sections.push("## All Bugs");
		sections.push("");
		for (const b of nonRecurringBugs) {
			sections.push(
				`- **${b.name}** (${formatDate(b.created_at)}) — ${b.summary ?? b.content.slice(0, 100)}`,
			);
		}
		sections.push("");
	}

	// Summary metrics
	sections.push("## Summary");
	sections.push("");
	sections.push(`| Metric | Count |`);
	sections.push(`|---|---|`);
	sections.push(`| Total bugs | ${bugs.length} |`);
	sections.push(`| Recurring bug areas | ${criticalAreas.length} |`);
	sections.push(`| Unresolved conflicts | ${conflictsWithGroup.length} |`);
	sections.push(`| Stale conventions (>30d) | ${staleConventions.length} |`);
	sections.push("");

	return sections.join("\n");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function generatePmReport(db: SiaDb, opts: PmReportOptions): Promise<string> {
	switch (opts.type) {
		case "sprint": {
			const since = opts.since ?? Date.now() - 14 * 24 * 60 * 60 * 1000;
			const until = opts.until ?? Date.now();
			return generateSprintSummary(db, since, until);
		}
		case "decisions":
			return generateDecisionLog(db, opts.since);
		case "risks":
			return generateRiskDashboard(db);
		default:
			throw new Error(`Unknown report type: ${opts.type}`);
	}
}

const DEFAULT_OUTPUT: Record<PmReportType, string> = {
	sprint: "SPRINT-SUMMARY.md",
	decisions: "DECISION-LOG.md",
	risks: "RISK-DASHBOARD.md",
};

export async function runPmReport(args: string[]): Promise<void> {
	const { resolveRepoHash } = await import("@/capture/hook");
	const { openGraphDb } = await import("@/graph/semantic-db");
	const { resolveSiaHome } = await import("@/shared/config");

	let type: PmReportType = "sprint";
	let since: number | undefined;
	let until: number | undefined;
	let outputPath: string | undefined;

	for (let i = 0; i < args.length; i++) {
		if (args[i] === "--type" && args[i + 1]) {
			const t = args[++i];
			if (t === "sprint" || t === "decisions" || t === "risks") type = t;
			else {
				console.error(`Unknown report type: ${t}. Use sprint, decisions, or risks.`);
				return;
			}
		} else if (args[i] === "--since" && args[i + 1]) {
			since = new Date(args[++i]).getTime();
		} else if (args[i] === "--until" && args[i + 1]) {
			until = new Date(args[++i]).getTime();
		} else if (args[i] === "--output" && args[i + 1]) {
			outputPath = args[++i];
		} else if (!args[i].startsWith("--")) {
			const t = args[i];
			if (t === "sprint" || t === "decisions" || t === "risks") type = t;
		}
	}

	const cwd = process.cwd();
	const repoHash = resolveRepoHash(cwd);
	const siaHome = resolveSiaHome();
	const db = openGraphDb(repoHash, siaHome);

	try {
		const markdown = await generatePmReport(db, { type, since, until });
		const outFile = outputPath ?? DEFAULT_OUTPUT[type];
		const fullPath = join(cwd, outFile);
		writeFileSync(fullPath, markdown, "utf-8");
		console.log(`PM report (${type}) written to ${outFile} (${markdown.length} chars)`);
	} finally {
		await db.close();
	}
}
