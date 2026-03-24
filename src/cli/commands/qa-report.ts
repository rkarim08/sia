// Module: qa-report — Generate QA-focused testing intelligence report
//
// Queries the graph for bugs, solutions, decisions, and recent changes,
// then produces a markdown report grouped by risk level with test
// recommendations derived from bug history.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SiaDb } from "@/graph/db-interface";

export interface QaReportOptions {
	since?: number;
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
	edge_count: number;
}

function formatDate(ms: number): string {
	return new Date(ms).toISOString().split("T")[0];
}

function riskLevel(bugCount: number, recentCount: number, edgeCount: number): { label: string; score: number } {
	// Weighted score: bug density 40%, change velocity 35%, dependency fan-out 25%
	const bugScore = Math.min(bugCount * 20, 100);
	const changeScore = Math.min(recentCount * 15, 100);
	const edgeScore = Math.min(edgeCount * 5, 100);
	const score = Math.round(bugScore * 0.4 + changeScore * 0.35 + edgeScore * 0.25);

	if (score > 70) return { label: "HIGH", score };
	if (score >= 40) return { label: "MEDIUM", score };
	return { label: "LOW", score };
}

export async function generateQaReport(
	db: SiaDb,
	opts: QaReportOptions = {},
): Promise<string> {
	const since = opts.since ?? Date.now() - 86400000 * 14; // default: 14 days

	// Query all active entities
	const allResult = await db.execute(
		"SELECT COUNT(*) as cnt FROM graph_nodes WHERE t_valid_until IS NULL AND archived_at IS NULL",
	);
	const totalEntities = (allResult.rows[0] as any).cnt;

	if (totalEntities === 0) {
		return `# QA Report\n\n*No entities in the knowledge graph yet. Run \`/sia-learn\` to build the graph.*\n`;
	}

	// Query bugs
	const bugsResult = await db.execute(
		`SELECT id, type, name, content, summary, trust_tier, importance, created_at, file_paths, edge_count
		 FROM graph_nodes
		 WHERE type = 'Bug' AND t_valid_until IS NULL AND archived_at IS NULL
		 ORDER BY created_at DESC
		 LIMIT 50`,
	);
	const bugs = bugsResult.rows as unknown as EntityRow[];

	// Query solutions
	const solutionsResult = await db.execute(
		`SELECT id, type, name, content, summary, trust_tier, importance, created_at, file_paths, edge_count
		 FROM graph_nodes
		 WHERE type = 'Solution' AND t_valid_until IS NULL AND archived_at IS NULL
		 ORDER BY created_at DESC
		 LIMIT 50`,
	);
	const solutions = solutionsResult.rows as unknown as EntityRow[];

	// Query recent decisions
	const decisionsResult = await db.execute(
		`SELECT id, type, name, content, summary, trust_tier, importance, created_at, file_paths, edge_count
		 FROM graph_nodes
		 WHERE type = 'Decision' AND t_valid_until IS NULL AND archived_at IS NULL AND created_at >= ?
		 ORDER BY created_at DESC
		 LIMIT 50`,
		[since],
	);
	const recentDecisions = decisionsResult.rows as unknown as EntityRow[];

	// Recent entities (all types)
	const recentResult = await db.execute(
		`SELECT id, type, name, content, summary, trust_tier, importance, created_at, file_paths, edge_count
		 FROM graph_nodes
		 WHERE t_valid_until IS NULL AND archived_at IS NULL AND created_at >= ?
		 ORDER BY created_at DESC
		 LIMIT 100`,
		[since],
	);
	const recentEntities = recentResult.rows as unknown as EntityRow[];

	const recentBugs = bugs.filter((b) => b.created_at >= since);
	const totalEdgeCount = bugs.reduce((sum, b) => sum + (b.edge_count || 0), 0);

	const risk = riskLevel(bugs.length, recentEntities.length, totalEdgeCount);

	const sections: string[] = [];

	// Header
	sections.push("# QA Report");
	sections.push(`\n*Generated on ${formatDate(Date.now())} | Since: ${formatDate(since)} | ${totalEntities} total entities*\n`);
	sections.push("---\n");

	// Summary
	sections.push("## Summary\n");
	sections.push(`| Metric | Count |`);
	sections.push(`|---|---|`);
	sections.push(`| Total entities | ${totalEntities} |`);
	sections.push(`| Recent changes (since ${formatDate(since)}) | ${recentEntities.length} |`);
	sections.push(`| Total bugs | ${bugs.length} |`);
	sections.push(`| Recent bugs | ${recentBugs.length} |`);
	sections.push(`| Solutions | ${solutions.length} |`);
	sections.push(`| Recent decisions | ${recentDecisions.length} |`);
	sections.push(`| Overall risk | **${risk.label}** (score: ${risk.score}) |`);
	sections.push("");

	// Bug Activity
	sections.push("## Bug Activity\n");
	if (bugs.length === 0) {
		sections.push("*No bugs recorded in the knowledge graph.*\n");
	} else {
		sections.push(`| Bug | Date | Trust | Files |`);
		sections.push(`|---|---|---|---|`);
		for (const bug of bugs) {
			const date = formatDate(bug.created_at);
			const tier = bug.trust_tier === 1 ? "verified" : bug.trust_tier === 2 ? "code-derived" : "inferred";
			const files = bug.file_paths && bug.file_paths !== "[]" ? bug.file_paths : "—";
			sections.push(`| ${bug.name} | ${date} | ${tier} | ${files} |`);
		}
		sections.push("");
	}

	// Solutions
	if (solutions.length > 0) {
		sections.push("## Solutions Applied\n");
		sections.push(`| Solution | Date | Files |`);
		sections.push(`|---|---|---|`);
		for (const sol of solutions) {
			const date = formatDate(sol.created_at);
			const files = sol.file_paths && sol.file_paths !== "[]" ? sol.file_paths : "—";
			sections.push(`| ${sol.name} | ${date} | ${files} |`);
		}
		sections.push("");
	}

	// Recent Decisions
	if (recentDecisions.length > 0) {
		sections.push("## Recent Decisions\n");
		for (const dec of recentDecisions) {
			sections.push(`### ${dec.name}`);
			sections.push(`*${formatDate(dec.created_at)}*\n`);
			if (dec.content) sections.push(`${dec.content.slice(0, 300)}\n`);
		}
	}

	// Test Recommendations
	sections.push("## Test Recommendations\n");
	if (bugs.length === 0) {
		sections.push("*No bugs in the graph — no specific test cases to recommend.*\n");
	} else {
		sections.push("Based on bug history, prioritize testing these scenarios:\n");
		for (let i = 0; i < bugs.length; i++) {
			const bug = bugs[i];
			sections.push(`${i + 1}. **${bug.name}** — ${bug.content.slice(0, 150)}`);
		}
		sections.push("");
	}

	// Coverage Gaps
	sections.push("## Coverage Gaps\n");
	const codeEntitiesResult = await db.execute(
		`SELECT COUNT(*) as cnt FROM graph_nodes
		 WHERE type = 'CodeEntity' AND t_valid_until IS NULL AND archived_at IS NULL`,
	);
	const codeCount = (codeEntitiesResult.rows[0] as any).cnt;
	if (codeCount > 0 && bugs.length > 0) {
		sections.push(`- ${codeCount} code entities tracked, ${bugs.length} bugs found`);
		sections.push(`- Areas with bugs but no corresponding solutions may indicate coverage gaps`);
		const unresolvedCount = bugs.length - solutions.length;
		if (unresolvedCount > 0) {
			sections.push(`- **${unresolvedCount} bugs without matching solutions** — potential untested areas`);
		}
	} else if (codeCount === 0) {
		sections.push("*No code entities indexed yet — run `/sia-learn` for coverage analysis.*");
	} else {
		sections.push("*No bugs recorded — coverage analysis not applicable.*");
	}
	sections.push("");

	// Footer
	sections.push("---\n");
	sections.push("*Generated by SIA QA Report — run `/sia-qa-report` to regenerate.*");

	return sections.join("\n");
}

export async function runQaReport(args: string[]): Promise<void> {
	const { resolveRepoHash } = await import("@/capture/hook");
	const { openGraphDb } = await import("@/graph/semantic-db");
	const { resolveSiaHome } = await import("@/shared/config");

	let outputPath = "QA-REPORT.md";
	let since: number | undefined;

	for (let i = 0; i < args.length; i++) {
		if (args[i] === "--output" && args[i + 1]) outputPath = args[++i];
		if (args[i] === "--since" && args[i + 1]) {
			const parsed = Date.parse(args[++i]);
			if (!Number.isNaN(parsed)) since = parsed;
		}
	}

	const cwd = process.cwd();
	const repoHash = resolveRepoHash(cwd);
	const siaHome = resolveSiaHome();
	const db = openGraphDb(repoHash, siaHome);

	try {
		const markdown = await generateQaReport(db, { since, outputPath });
		const fullPath = join(cwd, outputPath);
		writeFileSync(fullPath, markdown, "utf-8");
		console.log(`QA report written to ${outputPath} (${markdown.length} chars)`);
	} finally {
		await db.close();
	}
}
