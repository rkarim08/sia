// Module: entry-point-scorer — Scores CodeEntity nodes for entry-point likelihood
//
// Scoring dimensions (cumulative, clamped to [0, 1]):
// 1. isExported (from tags): +0.35
// 2. Name patterns (handle*, on*, *Controller): +0.35; main/index: +0.55
// 3. Call ratio (inDegree / outDegree): up to +0.2
// 4. Framework hints (tags contain 'route', 'handler', 'controller'): +0.3

import type { SiaDb } from "@/graph/db-interface";

export interface EntryPointScore {
	entityId: string;
	score: number;
	reasons: string[];
}

/** Name patterns that strongly suggest an entry point. */
const ENTRY_NAME_PATTERNS: Array<{ pattern: RegExp; reason: string; bonus: number }> = [
	{ pattern: /^main$/i, reason: "name is 'main'", bonus: 0.55 },
	{ pattern: /^index$/i, reason: "name is 'index'", bonus: 0.55 },
	{ pattern: /^handle[A-Z]/, reason: "name starts with 'handle'", bonus: 0.4 },
	{ pattern: /^on[A-Z]/, reason: "name starts with 'on'", bonus: 0.35 },
	{ pattern: /Controller$/i, reason: "name ends with 'Controller'", bonus: 0.35 },
];

/** Framework hint tags that suggest an entry point. */
const FRAMEWORK_HINTS = new Set(["route", "handler", "controller", "endpoint", "middleware"]);

export async function scoreEntryPoints(db: SiaDb): Promise<EntryPointScore[]> {
	// Fetch all active CodeEntity nodes
	const nodeResult = await db.execute(
		`SELECT id, name, tags
		 FROM graph_nodes
		 WHERE type = 'CodeEntity'
		   AND t_valid_until IS NULL
		   AND archived_at IS NULL`,
	);

	const nodes = nodeResult.rows as Array<{ id: string; name: string; tags: string }>;
	if (nodes.length === 0) return [];

	// Fetch call edges for ratio computation
	const edgeResult = await db.execute(
		`SELECT from_id, to_id
		 FROM graph_edges
		 WHERE type = 'calls'
		   AND t_valid_until IS NULL`,
	);
	const edges = edgeResult.rows as Array<{ from_id: string; to_id: string }>;

	// Compute inDegree and outDegree for each node
	const inDegree = new Map<string, number>();
	const outDegree = new Map<string, number>();
	for (const edge of edges) {
		inDegree.set(edge.to_id, (inDegree.get(edge.to_id) ?? 0) + 1);
		outDegree.set(edge.from_id, (outDegree.get(edge.from_id) ?? 0) + 1);
	}

	const scores: EntryPointScore[] = [];

	for (const node of nodes) {
		let score = 0;
		const reasons: string[] = [];

		// Parse tags
		let tags: string[] = [];
		try {
			const parsed = JSON.parse(node.tags);
			if (Array.isArray(parsed)) tags = parsed;
		} catch {
			// ignore malformed tags
		}

		// 1. isExported check (+0.35)
		const isExported = tags.includes("isExported");
		if (isExported) {
			score += 0.35;
			reasons.push("exported symbol");
		}

		// 2. Name patterns (variable bonus)
		for (const { pattern, reason, bonus } of ENTRY_NAME_PATTERNS) {
			if (pattern.test(node.name)) {
				score += bonus;
				reasons.push(reason);
				break; // Only apply one name pattern bonus
			}
		}

		// 3. Call ratio (up to +0.2)
		const nodeInDegree = inDegree.get(node.id) ?? 0;
		const nodeOutDegree = outDegree.get(node.id) ?? 0;
		if (nodeInDegree > 0 || nodeOutDegree > 0) {
			// High in-degree relative to out-degree suggests entry point
			const ratio = nodeInDegree / (nodeInDegree + nodeOutDegree);
			const callBonus = ratio * 0.2;
			if (callBonus > 0.01) {
				score += callBonus;
				reasons.push(`call ratio (in=${nodeInDegree}, out=${nodeOutDegree})`);
			}
		}

		// 4. Framework hints (+0.35 base, +0.15 per additional hint, max +0.55)
		const frameworkTags = tags.filter((t) => FRAMEWORK_HINTS.has(t.toLowerCase()));
		if (frameworkTags.length > 0) {
			const frameworkBonus = Math.min(0.55, 0.35 + (frameworkTags.length - 1) * 0.15);
			score += frameworkBonus;
			reasons.push(`framework hint: ${frameworkTags.join(", ")}`);
		}

		// Clamp to [0, 1]
		score = Math.min(1, Math.max(0, score));

		scores.push({ entityId: node.id, score, reasons });
	}

	// Write scores to graph_nodes.entry_point_score
	for (const entry of scores) {
		await db.execute("UPDATE graph_nodes SET entry_point_score = ? WHERE id = ?", [
			entry.score,
			entry.entityId,
		]);
	}

	return scores;
}
