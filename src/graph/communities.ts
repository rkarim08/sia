// Module: communities — Community CRUD layer with audit logging

import { randomUUID } from "node:crypto";
import { writeAuditEntry } from "@/graph/audit";
import type { SiaDb } from "@/graph/db-interface";
import type {
	Community,
	CommunityMember,
	CommunitySummary,
	InsertCommunityInput,
	UpdateCommunityInput,
} from "@/graph/types";

/**
 * Insert a new community into the graph database.
 * Generates a UUID, sets created_at and updated_at to now.
 * Writes an ADD entry to the audit log.
 */
export async function insertCommunity(db: SiaDb, input: InsertCommunityInput): Promise<Community> {
	const now = Date.now();
	const id = randomUUID();

	const community: Community = {
		id,
		level: input.level,
		parent_id: input.parent_id ?? null,
		summary: null,
		summary_hash: null,
		member_count: 0,
		last_summary_member_count: 0,
		package_path: input.package_path ?? null,
		created_at: now,
		updated_at: now,
	};

	await db.execute(
		`INSERT INTO communities (
			id, level, parent_id, summary, summary_hash,
			member_count, last_summary_member_count,
			package_path, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			community.id,
			community.level,
			community.parent_id,
			community.summary,
			community.summary_hash,
			community.member_count,
			community.last_summary_member_count,
			community.package_path,
			community.created_at,
			community.updated_at,
		],
	);

	await writeAuditEntry(db, "ADD", {});

	return community;
}

/**
 * Retrieve a single community by id.
 * Returns the community or null if not found.
 */
export async function getCommunity(db: SiaDb, id: string): Promise<Community | null> {
	const result = await db.execute("SELECT * FROM communities WHERE id = ?", [id]);
	return (result.rows[0] as Community | undefined) ?? null;
}

/**
 * Retrieve communities filtered by level and optional package path.
 */
export async function getCommunityByLevel(
	db: SiaDb,
	level: 0 | 1 | 2,
	packagePath?: string | null,
): Promise<Community[]> {
	if (packagePath !== undefined && packagePath !== null) {
		const result = await db.execute(
			"SELECT * FROM communities WHERE level = ? AND package_path = ?",
			[level, packagePath],
		);
		return result.rows as Community[];
	}

	const result = await db.execute("SELECT * FROM communities WHERE level = ?", [level]);
	return result.rows as Community[];
}

/**
 * Update partial fields on an existing community.
 * Always updates updated_at to now.
 * Writes an UPDATE entry to the audit log.
 */
export async function updateCommunity(
	db: SiaDb,
	id: string,
	updates: UpdateCommunityInput,
): Promise<void> {
	const entries = Object.entries(updates).filter(([, v]) => v !== undefined);
	const now = Date.now();

	// Always update updated_at
	const setClauses = [...entries.map(([key]) => `${key} = ?`), "updated_at = ?"].join(", ");
	const values = [...entries.map(([, v]) => v), now];

	await db.execute(`UPDATE communities SET ${setClauses} WHERE id = ?`, [...values, id]);

	await writeAuditEntry(db, "UPDATE", {});
}

/**
 * Add a member entity to a community.
 * Uses INSERT OR IGNORE so duplicate adds are safe (idempotent).
 */
export async function addMember(
	db: SiaDb,
	communityId: string,
	entityId: string,
	level: 0 | 1 | 2,
): Promise<void> {
	await db.execute(
		"INSERT OR IGNORE INTO community_members (community_id, entity_id, level) VALUES (?, ?, ?)",
		[communityId, entityId, level],
	);
}

/**
 * Remove all members from a community.
 * Used during Leiden algorithm re-runs to clear stale membership.
 */
export async function removeMembers(db: SiaDb, communityId: string): Promise<void> {
	await db.execute("DELETE FROM community_members WHERE community_id = ?", [communityId]);
}

/**
 * Retrieve all members of a community.
 */
export async function getMembers(db: SiaDb, communityId: string): Promise<CommunityMember[]> {
	const result = await db.execute("SELECT * FROM community_members WHERE community_id = ?", [
		communityId,
	]);
	return result.rows as CommunityMember[];
}

/**
 * Retrieve community summaries (WHERE summary IS NOT NULL).
 * Ordered by member_count DESC. Optionally filtered by level and limited.
 */
export async function getSummaries(
	db: SiaDb,
	level?: 0 | 1 | 2,
	limit?: number,
): Promise<CommunitySummary[]> {
	let sql: string;
	const params: Array<number | string> = [];

	if (level !== undefined) {
		sql =
			"SELECT id, level, summary, member_count FROM communities WHERE summary IS NOT NULL AND level = ? ORDER BY member_count DESC";
		params.push(level);
	} else {
		sql =
			"SELECT id, level, summary, member_count FROM communities WHERE summary IS NOT NULL ORDER BY member_count DESC";
	}

	if (limit !== undefined) {
		sql += " LIMIT ?";
		params.push(limit);
	}

	const result = await db.execute(sql, params);

	return (
		result.rows as Array<{ id: string; level: 0 | 1 | 2; summary: string; member_count: number }>
	).map((row) => ({
		id: row.id,
		level: row.level,
		summary: row.summary,
		member_count: row.member_count,
		top_entities: [],
	}));
}

/**
 * Pure function: returns true if the community needs re-summarization.
 * Triggered when the relative change in member count exceeds 20%.
 * Formula: |member_count - last_summary_member_count| / max(last_summary_member_count, 1) > 0.20
 */
export function needsResummarization(community: Community): boolean {
	const last = community.last_summary_member_count;
	const current = community.member_count;
	const change = Math.abs(current - last) / Math.max(last, 1);
	return change > 0.2;
}
