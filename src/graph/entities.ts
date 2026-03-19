// Module: entities — Entity CRUD layer with bi-temporal invalidation

import { v4 as uuid } from "uuid";
import { writeAuditEntry } from "@/graph/audit";
import type { SiaDb } from "@/graph/db-interface";

/** Shape of an entity row as stored in the database. */
export interface Entity {
	id: string;
	type: string;
	name: string;
	content: string;
	summary: string;
	package_path: string | null;
	tags: string;
	file_paths: string;
	trust_tier: number;
	confidence: number;
	base_confidence: number;
	importance: number;
	base_importance: number;
	access_count: number;
	edge_count: number;
	last_accessed: number;
	created_at: number;
	t_created: number;
	t_expired: number | null;
	t_valid_from: number | null;
	t_valid_until: number | null;
	visibility: string;
	created_by: string;
	workspace_scope: string | null;
	hlc_created: number | null;
	hlc_modified: number | null;
	synced_at: number | null;
	conflict_group_id: string | null;
	source_episode: string | null;
	extraction_method: string | null;
	extraction_model: string | null;
	embedding: Uint8Array | null;
	archived_at: number | null;
}

/** Fields the caller must or may provide when inserting an entity. */
export interface InsertEntityInput {
	type: string;
	name: string;
	content: string;
	summary: string;
	package_path?: string | null;
	tags?: string;
	file_paths?: string;
	trust_tier?: number;
	confidence?: number;
	base_confidence?: number;
	importance?: number;
	base_importance?: number;
	access_count?: number;
	edge_count?: number;
	last_accessed?: number;
	created_at?: number;
	t_valid_from?: number | null;
	visibility?: string;
	created_by?: string;
	workspace_scope?: string | null;
	hlc_created?: number | null;
	hlc_modified?: number | null;
	source_episode?: string | null;
	extraction_method?: string | null;
	extraction_model?: string | null;
	embedding?: Uint8Array | null;
}

/** Fields that can be partially updated on an existing entity. */
export type UpdateEntityInput = Partial<Omit<Entity, "id" | "t_created" | "created_at">>;

/** Options for getActiveEntities. */
export interface GetActiveEntitiesOpts {
	limit?: number;
}

/**
 * Insert a new entity into the graph database.
 * Generates a UUID, sets t_created=now, t_valid_from as provided (default null),
 * t_valid_until=null. Writes an ADD entry to the audit log.
 */
export async function insertEntity(db: SiaDb, input: InsertEntityInput): Promise<Entity> {
	const now = Date.now();
	const id = uuid();

	const entity: Entity = {
		id,
		type: input.type,
		name: input.name,
		content: input.content,
		summary: input.summary,
		package_path: input.package_path ?? null,
		tags: input.tags ?? "[]",
		file_paths: input.file_paths ?? "[]",
		trust_tier: input.trust_tier ?? 3,
		confidence: input.confidence ?? 0.7,
		base_confidence: input.base_confidence ?? 0.7,
		importance: input.importance ?? 0.5,
		base_importance: input.base_importance ?? 0.5,
		access_count: input.access_count ?? 0,
		edge_count: input.edge_count ?? 0,
		last_accessed: input.last_accessed ?? now,
		created_at: input.created_at ?? now,
		t_created: now,
		t_expired: null,
		t_valid_from: input.t_valid_from ?? null,
		t_valid_until: null,
		visibility: input.visibility ?? "private",
		created_by: input.created_by ?? "local",
		workspace_scope: input.workspace_scope ?? null,
		hlc_created: input.hlc_created ?? null,
		hlc_modified: input.hlc_modified ?? null,
		synced_at: null,
		conflict_group_id: null,
		source_episode: input.source_episode ?? null,
		extraction_method: input.extraction_method ?? null,
		extraction_model: input.extraction_model ?? null,
		embedding: input.embedding ?? null,
		archived_at: null,
	};

	await db.execute(
		`INSERT INTO entities (
			id, type, name, content, summary,
			package_path, tags, file_paths,
			trust_tier, confidence, base_confidence,
			importance, base_importance,
			access_count, edge_count,
			last_accessed, created_at,
			t_created, t_expired, t_valid_from, t_valid_until,
			visibility, created_by, workspace_scope,
			hlc_created, hlc_modified, synced_at,
			conflict_group_id,
			source_episode, extraction_method, extraction_model,
			embedding, archived_at
		) VALUES (
			?, ?, ?, ?, ?,
			?, ?, ?,
			?, ?, ?,
			?, ?,
			?, ?,
			?, ?,
			?, ?, ?, ?,
			?, ?, ?,
			?, ?, ?,
			?,
			?, ?, ?,
			?, ?
		)`,
		[
			entity.id,
			entity.type,
			entity.name,
			entity.content,
			entity.summary,
			entity.package_path,
			entity.tags,
			entity.file_paths,
			entity.trust_tier,
			entity.confidence,
			entity.base_confidence,
			entity.importance,
			entity.base_importance,
			entity.access_count,
			entity.edge_count,
			entity.last_accessed,
			entity.created_at,
			entity.t_created,
			entity.t_expired,
			entity.t_valid_from,
			entity.t_valid_until,
			entity.visibility,
			entity.created_by,
			entity.workspace_scope,
			entity.hlc_created,
			entity.hlc_modified,
			entity.synced_at,
			entity.conflict_group_id,
			entity.source_episode,
			entity.extraction_method,
			entity.extraction_model,
			entity.embedding,
			entity.archived_at,
		],
	);

	await writeAuditEntry(db, "ADD", { entity_id: id });

	return entity;
}

/**
 * Retrieve a single entity by id.
 * Returns the entity or undefined if not found.
 */
export async function getEntity(db: SiaDb, id: string): Promise<Entity | undefined> {
	const result = await db.execute("SELECT * FROM entities WHERE id = ?", [id]);
	return (result.rows[0] as unknown as Entity | undefined) ?? undefined;
}

/**
 * Update partial fields on an existing entity.
 * Writes an UPDATE entry to the audit log.
 */
export async function updateEntity(
	db: SiaDb,
	id: string,
	updates: UpdateEntityInput,
): Promise<void> {
	const entries = Object.entries(updates).filter(([, v]) => v !== undefined);
	if (entries.length === 0) return;

	const setClauses = entries.map(([key]) => `${key} = ?`).join(", ");
	const values = entries.map(([, v]) => v);

	await db.execute(`UPDATE entities SET ${setClauses} WHERE id = ?`, [...values, id]);

	await writeAuditEntry(db, "UPDATE", { entity_id: id });
}

/**
 * Touch an entity: update last_accessed to now and increment access_count.
 */
export async function touchEntity(db: SiaDb, id: string): Promise<void> {
	await db.execute(
		"UPDATE entities SET last_accessed = ?, access_count = access_count + 1 WHERE id = ?",
		[Date.now(), id],
	);
}

/**
 * Invalidate an entity (bi-temporal): sets both t_valid_until AND t_expired.
 * Used when a fact is superseded or proven wrong.
 * Does NOT set archived_at.
 */
export async function invalidateEntity(db: SiaDb, id: string, tValidUntil?: number): Promise<void> {
	const ts = tValidUntil ?? Date.now();
	await db.execute("UPDATE entities SET t_valid_until = ?, t_expired = ? WHERE id = ?", [
		ts,
		ts,
		id,
	]);

	await writeAuditEntry(db, "INVALIDATE", { entity_id: id });
}

/**
 * Archive an entity (soft delete for decayed/irrelevant entities).
 * Sets archived_at only. Does NOT touch t_valid_until or t_expired.
 */
export async function archiveEntity(db: SiaDb, id: string): Promise<void> {
	await db.execute("UPDATE entities SET archived_at = ? WHERE id = ?", [Date.now(), id]);

	await writeAuditEntry(db, "ARCHIVE", { entity_id: id });
}

/**
 * Retrieve active entities: those that are neither invalidated nor archived.
 * Filters WHERE t_valid_until IS NULL AND archived_at IS NULL.
 */
export async function getActiveEntities(
	db: SiaDb,
	opts?: GetActiveEntitiesOpts,
): Promise<Entity[]> {
	const limit = opts?.limit;
	const sql = limit
		? "SELECT * FROM entities WHERE t_valid_until IS NULL AND archived_at IS NULL LIMIT ?"
		: "SELECT * FROM entities WHERE t_valid_until IS NULL AND archived_at IS NULL";
	const params = limit ? [limit] : [];

	const result = await db.execute(sql, params);
	return result.rows as unknown as Entity[];
}

/**
 * Retrieve active entities scoped to a specific package path.
 * Filters WHERE package_path = ? AND t_valid_until IS NULL AND archived_at IS NULL.
 */
export async function getEntitiesByPackage(db: SiaDb, packagePath: string): Promise<Entity[]> {
	const result = await db.execute(
		"SELECT * FROM entities WHERE package_path = ? AND t_valid_until IS NULL AND archived_at IS NULL",
		[packagePath],
	);
	return result.rows as unknown as Entity[];
}
