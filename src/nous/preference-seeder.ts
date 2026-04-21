// Module: nous/preference-seeder — seeds initial Preference nodes from CLAUDE.md values
//
// Called from SessionStart; idempotent — if any Preference nodes already exist
// (seeded or authored), it skips. Uses graph_nodes directly with the raw
// bun:sqlite handle because seeding runs in-process from synchronous hook code.

import { v4 as uuid } from "uuid";
import type { SiaDb } from "@/graph/db-interface";

export interface PreferenceSeed {
	name: string;
	description: string;
	trust_tier: 1 | 3;
}

/** Core developer values extracted from CLAUDE.md on first Nous run. */
export const CLAUDE_MD_PREFERENCES: PreferenceSeed[] = [
	{
		name: "Avoid sycophantic reversals",
		description:
			"Do not reverse a stated position solely in response to user pushback. A change in position requires new evidence or reasoning, not social pressure.",
		trust_tier: 1,
	},
	{
		name: "Cite retrieved memory entities",
		description:
			"When Sia memory entities constrain a decision, cite them explicitly. Do not silently apply memory.",
		trust_tier: 1,
	},
	{
		name: "Resolve conflicts before proceeding",
		description:
			"When conflict_group_id is non-null on a retrieved entity, stop and present both conflicting facts to the developer before continuing.",
		trust_tier: 1,
	},
	{
		name: "Prefer minimal scope",
		description:
			"Only make changes directly requested or clearly necessary. Do not add features, refactor, or improve beyond the task scope.",
		trust_tier: 1,
	},
];

/**
 * Insert the CLAUDE_MD_PREFERENCES list as Preference nodes if none exist yet.
 * Returns the number of rows inserted (0 if already seeded).
 */
export function seedPreferences(db: SiaDb): number {
	const raw = db.rawSqlite();
	if (!raw) return 0;

	// Skip if any Preference node already exists.
	const existing = raw
		.prepare("SELECT COUNT(*) as cnt FROM graph_nodes WHERE kind = 'Preference'")
		.get() as { cnt: number };
	if (existing.cnt > 0) return 0;

	const now = Date.now();
	const insert = raw.prepare(
		`INSERT INTO graph_nodes (
			id, type, name, content, summary,
			tags, file_paths,
			trust_tier, confidence, base_confidence,
			importance, base_importance,
			access_count, edge_count,
			last_accessed, created_at, t_created,
			visibility, created_by,
			kind
		) VALUES (
			?, 'Preference', ?, ?, ?,
			'[]', '[]',
			?, 1.0, 1.0,
			0.7, 0.7,
			0, 0,
			?, ?, ?,
			'private', 'nous-seeder',
			'Preference'
		)`,
	);

	let inserted = 0;
	for (const pref of CLAUDE_MD_PREFERENCES) {
		insert.run(uuid(), pref.name, pref.description, pref.name, pref.trust_tier, now, now, now);
		inserted++;
	}

	return inserted;
}
