// Module: mcp/tools/nous-curiosity — explores graph for high-trust low-access entities
//
// Reads graph_nodes for knowledge that exists but has rarely/never been
// retrieved, and writes top-N results as Concern nodes (status:open). Call on
// session slack or when a knowledge gap is detected.

import { v4 as uuid } from "uuid";
import type { SiaDb } from "@/graph/db-interface";

export interface CuriosityInput {
	topic?: string;
	depth?: 1 | 2 | 3;
}

export interface EntityCluster {
	id: string;
	name: string;
	type: string;
	trust_tier: number;
	access_count: number;
	rationale: string;
}

export interface CuriosityResult {
	clusters: EntityCluster[];
	concernsWritten: number;
}

const MIN_TRUST_TIER = 2; // Only high-trust entities
const MAX_ACCESS_COUNT = 3; // Never or rarely retrieved
const CLUSTER_LIMIT = 10;

export async function handleNousCuriosity(
	db: SiaDb,
	sessionId: string,
	input: CuriosityInput,
): Promise<CuriosityResult> {
	const raw = db.rawSqlite();
	if (!raw) return { clusters: [], concernsWritten: 0 };

	const limit = CLUSTER_LIMIT * (input.depth ?? 1);

	let query = `
		SELECT id, name, type, trust_tier, access_count, summary
		FROM graph_nodes
		WHERE trust_tier <= ?
			AND access_count <= ?
			AND t_valid_until IS NULL
			AND archived_at IS NULL
			AND (kind IS NULL OR kind NOT IN ('Episode', 'Signal', 'Concern', 'Preference'))
	`;
	const params: unknown[] = [MIN_TRUST_TIER, MAX_ACCESS_COUNT];

	if (input.topic) {
		query += " AND (name LIKE ? OR summary LIKE ?)";
		params.push(`%${input.topic}%`, `%${input.topic}%`);
	}

	query += " ORDER BY trust_tier ASC, access_count ASC LIMIT ?";
	params.push(limit);

	const rows = raw.prepare(query).all(...params) as Array<{
		id: string;
		name: string;
		type: string;
		trust_tier: number;
		access_count: number;
		summary: string;
	}>;

	const clusters: EntityCluster[] = rows.map((r) => ({
		id: r.id,
		name: r.name,
		type: r.type,
		trust_tier: r.trust_tier,
		access_count: r.access_count,
		rationale: `High-trust (tier ${r.trust_tier}) entity with ${r.access_count} retrievals — worth exploring.`,
	}));

	// Write Concern nodes for top clusters (tagged status:open).
	const now = Date.now();
	const insertConcern = raw.prepare(
		`INSERT INTO graph_nodes (
			id, type, name, content, summary,
			tags, file_paths,
			trust_tier, confidence, base_confidence,
			importance, base_importance,
			access_count, edge_count,
			last_accessed, created_at, t_created,
			visibility, created_by,
			kind,
			captured_by_session_id, captured_by_session_type
		) VALUES (
			?, 'Concern', ?, ?, ?,
			'["status:open"]', '[]',
			3, 0.7, 0.7,
			0.5, 0.5,
			0, 0,
			?, ?, ?,
			'private', 'nous-curiosity',
			'Concern',
			?, 'primary'
		)`,
	);

	let concernsWritten = 0;
	for (const cluster of clusters.slice(0, 5)) {
		insertConcern.run(
			uuid(),
			`Unexplored: ${cluster.name}`,
			`Entity "${cluster.name}" (${cluster.type}) has ${cluster.access_count} retrievals despite trust tier ${cluster.trust_tier}. ${cluster.rationale}`,
			`Unexplored high-trust entity: ${cluster.name}`,
			now,
			now,
			now,
			sessionId,
		);
		concernsWritten++;
	}

	return { clusters, concernsWritten };
}
