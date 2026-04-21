// Module: mcp/tools/nous-concern — surfaces open Concern nodes filtered by active Preferences
//
// Flips tag 'status:open' → 'status:surfaced' for the returned set so a given
// Concern is surfaced once per lifetime (until further curiosity sweeps
// regenerate open Concerns).

import type { SiaDb } from "@/graph/db-interface";

export interface ConcernInput {
	person?: string;
	context?: string;
}

export interface SurfacedConcern {
	id: string;
	name: string;
	description: string;
	relevanceScore: number;
}

export interface ConcernResult {
	concerns: SurfacedConcern[];
}

export async function handleNousConcern(
	db: SiaDb,
	_input: ConcernInput,
): Promise<ConcernResult> {
	const raw = db.rawSqlite();
	if (!raw) return { concerns: [] };

	// Fetch open Concern nodes (status stored in tags field as 'status:open').
	const rows = raw
		.prepare(
			`SELECT id, name, summary as description, confidence as relevance_score
			FROM graph_nodes
			WHERE kind = 'Concern'
				AND tags LIKE '%status:open%'
				AND t_valid_until IS NULL
				AND archived_at IS NULL
			ORDER BY confidence DESC
			LIMIT 20`,
		)
		.all() as Array<{
		id: string;
		name: string;
		description: string;
		relevance_score: number;
	}>;

	if (rows.length === 0) return { concerns: [] };

	// Mark returned concerns as surfaced.
	const update = raw.prepare(
		"UPDATE graph_nodes SET tags = REPLACE(tags, 'status:open', 'status:surfaced') WHERE id = ?",
	);
	for (const row of rows) update.run(row.id);

	return {
		concerns: rows.map((r) => ({
			id: r.id,
			name: r.name,
			description: r.description,
			relevanceScore: r.relevance_score,
		})),
	};
}
