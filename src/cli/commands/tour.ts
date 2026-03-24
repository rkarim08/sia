// Module: tour — Interactive guided walkthrough of the knowledge graph

import type { SiaDb } from "@/graph/db-interface";

export interface TourSection {
	title: string;
	content: string;
	entityCount: number;
}

export interface TourResult {
	totalEntities: number;
	totalEdges: number;
	sections: TourSection[];
}

export async function generateTour(db: SiaDb): Promise<TourResult> {
	// Count totals
	const entityCount = await db.execute(
		"SELECT COUNT(*) as cnt FROM graph_nodes WHERE t_valid_until IS NULL AND archived_at IS NULL",
	);
	const edgeCount = await db.execute(
		"SELECT COUNT(*) as cnt FROM graph_edges WHERE t_valid_until IS NULL",
	);

	const totalEntities = (entityCount.rows[0] as any).cnt;
	const totalEdges = (edgeCount.rows[0] as any).cnt;

	const sections: TourSection[] = [];

	// Section 1: Architecture Overview (from communities)
	const communities = await db.execute(
		"SELECT id, summary, member_count FROM communities WHERE level = 2 ORDER BY member_count DESC LIMIT 5",
	);
	if ((communities.rows as any[]).length > 0) {
		const content = (communities.rows as any[])
			.map((c) => `- **${c.summary?.slice(0, 100) || "Unnamed community"}** (${c.member_count} members)`)
			.join("\n");
		sections.push({
			title: "Architecture Overview",
			content: `Your codebase has ${(communities.rows as any[]).length} major modules:\n\n${content}`,
			entityCount: (communities.rows as any[]).length,
		});
	}

	// Section 2: Key Decisions
	const decisions = await db.execute(
		`SELECT name, summary FROM graph_nodes
		 WHERE type = 'Decision' AND t_valid_until IS NULL AND archived_at IS NULL
		 ORDER BY importance DESC LIMIT 5`,
	);
	if ((decisions.rows as any[]).length > 0) {
		const content = (decisions.rows as any[])
			.map((d) => `- **${d.name}**: ${d.summary?.slice(0, 120) || "no summary"}`)
			.join("\n");
		sections.push({
			title: "Key Decisions",
			content: `${(decisions.rows as any[]).length} architectural decisions captured:\n\n${content}`,
			entityCount: (decisions.rows as any[]).length,
		});
	}

	// Section 3: Active Conventions
	const conventions = await db.execute(
		`SELECT name, summary FROM graph_nodes
		 WHERE type = 'Convention' AND t_valid_until IS NULL AND archived_at IS NULL
		 ORDER BY importance DESC LIMIT 10`,
	);
	if ((conventions.rows as any[]).length > 0) {
		const content = (conventions.rows as any[])
			.map((c) => `- **${c.name}**: ${c.summary?.slice(0, 120) || "no summary"}`)
			.join("\n");
		sections.push({
			title: "Coding Conventions",
			content: `${(conventions.rows as any[]).length} conventions to follow:\n\n${content}`,
			entityCount: (conventions.rows as any[]).length,
		});
	}

	// Section 4: Known Issues
	const bugs = await db.execute(
		`SELECT name, summary FROM graph_nodes
		 WHERE type = 'Bug' AND t_valid_until IS NULL AND archived_at IS NULL
		 ORDER BY created_at DESC LIMIT 5`,
	);
	if ((bugs.rows as any[]).length > 0) {
		const content = (bugs.rows as any[])
			.map((b) => `- **${b.name}**: ${b.summary?.slice(0, 120) || "no summary"}`)
			.join("\n");
		sections.push({
			title: "Known Issues",
			content: `${(bugs.rows as any[]).length} known bugs to be aware of:\n\n${content}`,
			entityCount: (bugs.rows as any[]).length,
		});
	}

	// Section 5: Documentation
	const docs = await db.execute(
		`SELECT name, summary FROM graph_nodes
		 WHERE type = 'FileNode' AND tags LIKE '%project-docs%' AND t_valid_until IS NULL
		 ORDER BY importance DESC LIMIT 10`,
	);
	if ((docs.rows as any[]).length > 0) {
		const content = (docs.rows as any[])
			.map((d) => `- ${d.name}`)
			.join("\n");
		sections.push({
			title: "Ingested Documentation",
			content: `${(docs.rows as any[]).length} docs in the knowledge graph:\n\n${content}`,
			entityCount: (docs.rows as any[]).length,
		});
	}

	return { totalEntities, totalEdges, sections };
}

export function formatTour(tour: TourResult): string {
	const lines: string[] = [];
	lines.push("=== SIA Knowledge Graph Tour ===\n");
	lines.push(`Total: ${tour.totalEntities} entities, ${tour.totalEdges} edges\n`);

	for (const section of tour.sections) {
		lines.push(`--- ${section.title} ---`);
		lines.push(section.content);
		lines.push("");
	}

	if (tour.sections.length === 0) {
		lines.push("The knowledge graph is empty. Run /sia-learn to populate it.");
	}

	lines.push("--- Next Steps ---");
	lines.push("- Ask any question — SIA tools activate automatically");
	lines.push("- /sia-search — search the knowledge graph");
	lines.push("- /sia-status — detailed graph health");
	lines.push("- /sia-visualize-live — interactive browser visualization");

	return lines.join("\n");
}

export async function runTour(_args: string[]): Promise<void> {
	const { resolveRepoHash } = await import("@/capture/hook");
	const { openGraphDb } = await import("@/graph/semantic-db");
	const { resolveSiaHome } = await import("@/shared/config");

	const repoHash = resolveRepoHash(process.cwd());
	const siaHome = resolveSiaHome();
	const db = openGraphDb(repoHash, siaHome);

	try {
		const tour = await generateTour(db);
		console.log(formatTour(tour));
	} finally {
		await db.close();
	}
}
