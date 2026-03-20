// Module: edges — Edge CRUD layer (bi-temporal, never hard-deletes)

import { randomUUID } from "node:crypto";
import { writeAuditEntry } from "@/graph/audit";
import type { SiaDb } from "@/graph/db-interface";

/** Shape accepted by insertEdge. Caller supplies classification and endpoints; we generate id & timestamps. */
export interface NewEdge {
	from_id: string;
	to_id: string;
	type: string;
	weight?: number;
	confidence?: number;
	trust_tier?: number;
	t_valid_from?: number | null;
	source_episode?: string | null;
	extraction_method?: string | null;
}

/** Row shape returned by edge queries. */
export interface EdgeRow {
	id: string;
	from_id: string;
	to_id: string;
	type: string;
	weight: number;
	confidence: number;
	trust_tier: number;
	t_created: number;
	t_expired: number | null;
	t_valid_from: number | null;
	t_valid_until: number | null;
	hlc_created: number | null;
	hlc_modified: number | null;
	source_episode: string | null;
	extraction_method: string | null;
}

/**
 * Insert a new edge into the graph.
 *
 * Generates a UUID for `id`, sets `t_created = Date.now()`, `t_valid_until = null`.
 * Writes an 'ADD' audit log entry.
 */
export async function insertEdge(db: SiaDb, edge: NewEdge): Promise<EdgeRow> {
	const id = randomUUID();
	const now = Date.now();

	await db.execute(
		`INSERT INTO graph_edges (
			id, from_id, to_id, type, weight, confidence, trust_tier,
			t_created, t_expired, t_valid_from, t_valid_until,
			source_episode, extraction_method
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?)`,
		[
			id,
			edge.from_id,
			edge.to_id,
			edge.type,
			edge.weight ?? 1.0,
			edge.confidence ?? 0.7,
			edge.trust_tier ?? 3,
			now,
			edge.t_valid_from ?? null,
			edge.source_episode ?? null,
			edge.extraction_method ?? null,
		],
	);

	await writeAuditEntry(db, "ADD", { edge_id: id });

	return {
		id,
		from_id: edge.from_id,
		to_id: edge.to_id,
		type: edge.type,
		weight: edge.weight ?? 1.0,
		confidence: edge.confidence ?? 0.7,
		trust_tier: edge.trust_tier ?? 3,
		t_created: now,
		t_expired: null,
		t_valid_from: edge.t_valid_from ?? null,
		t_valid_until: null,
		hlc_created: null,
		hlc_modified: null,
		source_episode: edge.source_episode ?? null,
		extraction_method: edge.extraction_method ?? null,
	};
}

/**
 * Invalidate an edge (soft-delete).
 *
 * Sets BOTH `t_valid_until` AND `t_expired` to the given timestamp (default: now).
 * Writes an 'INVALIDATE' audit log entry.
 * Never hard-deletes.
 */
export async function invalidateEdge(db: SiaDb, id: string, tValidUntil?: number): Promise<void> {
	const ts = tValidUntil ?? Date.now();

	await db.execute("UPDATE graph_edges SET t_valid_until = ?, t_expired = ? WHERE id = ?", [ts, ts, id]);

	await writeAuditEntry(db, "INVALIDATE", { edge_id: id });
}

/**
 * Get all currently active edges for an entity (as source or target).
 *
 * Active = `t_valid_until IS NULL`.
 */
export async function getActiveEdges(db: SiaDb, entityId: string): Promise<EdgeRow[]> {
	const result = await db.execute(
		`SELECT * FROM graph_edges
		 WHERE (from_id = ? OR to_id = ?)
		   AND t_valid_until IS NULL`,
		[entityId, entityId],
	);
	return result.rows as unknown as EdgeRow[];
}

/**
 * Get currently active edges from a source node filtered by type(s).
 *
 * Returns edges where `from_id = fromId`, `type IN types`, and `t_valid_until IS NULL`.
 */
export async function getEdgesByType(
	db: SiaDb,
	fromId: string,
	types: string[],
): Promise<Record<string, unknown>[]> {
	const placeholders = types.map(() => "?").join(", ");
	const { rows } = await db.execute(
		`SELECT * FROM graph_edges WHERE from_id = ? AND type IN (${placeholders}) AND t_valid_until IS NULL`,
		[fromId, ...types],
	);
	return rows;
}

/**
 * Get edges for an entity that were valid at a specific point in time.
 *
 * Matches edges where:
 * - `t_valid_from IS NULL OR t_valid_from <= asOfMs`  (edge had started)
 * - `t_valid_until IS NULL OR t_valid_until > asOfMs`  (edge had not yet ended)
 */
export async function getEdgesAsOf(
	db: SiaDb,
	entityId: string,
	asOfMs: number,
): Promise<EdgeRow[]> {
	const result = await db.execute(
		`SELECT * FROM graph_edges
		 WHERE (from_id = ? OR to_id = ?)
		   AND (t_valid_from IS NULL OR t_valid_from <= ?)
		   AND (t_valid_until IS NULL OR t_valid_until > ?)`,
		[entityId, entityId, asOfMs, asOfMs],
	);
	return result.rows as unknown as EdgeRow[];
}
