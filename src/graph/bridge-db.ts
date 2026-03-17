// Module: bridge-db — Bridge database opener and cross-repo edge CRUD

import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import type { BunSqliteDb, SiaDb } from "@/graph/db-interface";
import { runMigrations } from "@/graph/semantic-db";
import { SIA_HOME } from "@/shared/config";

/**
 * Open (or create) the global bridge database.
 * Resolves to `{siaHome}/bridge.db` (not under repos/) and applies
 * migrations from the `migrations/bridge` directory.
 */
export function openBridgeDb(siaHome?: string): BunSqliteDb {
	const home = siaHome ?? SIA_HOME;
	const dbPath = join(home, "bridge.db");
	const migrationsDir = resolve(import.meta.dirname, "../../migrations/bridge");
	return runMigrations(dbPath, migrationsDir);
}

// ---------------------------------------------------------------------------
// Cross-repo edge types
// ---------------------------------------------------------------------------

/** Shape accepted by insertCrossRepoEdge. Caller supplies endpoints and classification. */
export interface NewCrossRepoEdge {
	source_repo_id: string;
	source_entity_id: string;
	target_repo_id: string;
	target_entity_id: string;
	type: string;
	weight?: number;
	confidence?: number;
	trust_tier?: number;
	properties?: string | null;
	t_valid_from?: number | null;
	created_by?: string | null;
}

/** Row shape returned by cross-repo edge queries. */
export interface CrossRepoEdgeRow {
	id: string;
	source_repo_id: string;
	source_entity_id: string;
	target_repo_id: string;
	target_entity_id: string;
	type: string;
	weight: number;
	confidence: number;
	trust_tier: number;
	properties: string | null;
	t_created: number;
	t_expired: number | null;
	t_valid_from: number | null;
	t_valid_until: number | null;
	hlc_created: number | null;
	hlc_modified: number | null;
	created_by: string | null;
}

// ---------------------------------------------------------------------------
// Cross-repo edge CRUD
// ---------------------------------------------------------------------------

/**
 * Insert a new cross-repo edge into bridge.db.
 *
 * Generates a UUID for `id`, sets `t_created = Date.now()`.
 * Returns the generated id.
 */
export async function insertCrossRepoEdge(db: SiaDb, edge: NewCrossRepoEdge): Promise<string> {
	const id = randomUUID();
	const now = Date.now();

	await db.execute(
		`INSERT INTO cross_repo_edges (
			id, source_repo_id, source_entity_id,
			target_repo_id, target_entity_id,
			type, weight, confidence, trust_tier, properties,
			t_created, t_expired, t_valid_from, t_valid_until,
			created_by
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?)`,
		[
			id,
			edge.source_repo_id,
			edge.source_entity_id,
			edge.target_repo_id,
			edge.target_entity_id,
			edge.type,
			edge.weight ?? 1.0,
			edge.confidence ?? 0.9,
			edge.trust_tier ?? 2,
			edge.properties ?? null,
			now,
			edge.t_valid_from ?? null,
			edge.created_by ?? null,
		],
	);

	return id;
}

/**
 * Invalidate a cross-repo edge (soft-delete).
 *
 * Sets BOTH `t_valid_until` AND `t_expired` to the given timestamp (default: now).
 * Never hard-deletes.
 */
export async function invalidateCrossRepoEdge(
	db: SiaDb,
	id: string,
	tValidUntil?: number,
): Promise<void> {
	const ts = tValidUntil ?? Date.now();

	await db.execute("UPDATE cross_repo_edges SET t_valid_until = ?, t_expired = ? WHERE id = ?", [
		ts,
		ts,
		id,
	]);
}

/**
 * Get all currently active cross-repo edges for an entity (as source or target).
 *
 * Active = `t_valid_until IS NULL`.
 */
export async function getActiveCrossRepoEdgesFor(
	db: SiaDb,
	repoId: string,
	entityId: string,
): Promise<CrossRepoEdgeRow[]> {
	const result = await db.execute(
		`SELECT * FROM cross_repo_edges
		 WHERE ((source_repo_id = ? AND source_entity_id = ?)
		    OR  (target_repo_id = ? AND target_entity_id = ?))
		   AND t_valid_until IS NULL`,
		[repoId, entityId, repoId, entityId],
	);
	return result.rows as unknown as CrossRepoEdgeRow[];
}
