// Module: staging — CRUD for the memory_staging table (Tier 4 security staging area)

import { randomUUID } from "node:crypto";
import { writeAuditEntry } from "@/graph/audit";
import type { SiaDb } from "@/graph/db-interface";

/** Row shape matching all columns of the `memory_staging` table. */
export interface StagedFact {
	id: string;
	source_episode: string | null;
	proposed_type: string;
	proposed_name: string;
	proposed_content: string;
	proposed_tags: string;
	proposed_file_paths: string;
	trust_tier: number;
	raw_confidence: number;
	validation_status: string;
	rejection_reason: string | null;
	created_at: number;
	expires_at: number;
}

/** Fields the caller provides when inserting a staged fact. */
export interface InsertStagedFactInput {
	source_episode?: string;
	proposed_type: string;
	proposed_name: string;
	proposed_content: string;
	proposed_tags?: string;
	proposed_file_paths?: string;
	trust_tier?: number;
	raw_confidence: number;
}

/** 7-day TTL in milliseconds. */
const SEVEN_DAYS_MS = 7 * 86_400_000;

/**
 * Insert a new staged fact into `memory_staging`.
 *
 * Generates a UUID, sets `created_at = Date.now()`, computes
 * `expires_at = created_at + 7 days`, defaults `validation_status = 'pending'`.
 * Writes a STAGE audit entry. Returns the generated id.
 */
export async function insertStagedFact(db: SiaDb, input: InsertStagedFactInput): Promise<string> {
	const id = randomUUID();
	const createdAt = Date.now();
	const expiresAt = createdAt + SEVEN_DAYS_MS;

	await db.execute(
		`INSERT INTO memory_staging (
			id, source_episode, proposed_type, proposed_name, proposed_content,
			proposed_tags, proposed_file_paths, trust_tier, raw_confidence,
			validation_status, created_at, expires_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			id,
			input.source_episode ?? null,
			input.proposed_type,
			input.proposed_name,
			input.proposed_content,
			input.proposed_tags ?? "[]",
			input.proposed_file_paths ?? "[]",
			input.trust_tier ?? 4,
			input.raw_confidence,
			"pending",
			createdAt,
			expiresAt,
		],
	);

	await writeAuditEntry(db, "STAGE", {
		entity_id: id,
		trust_tier: input.trust_tier ?? 4,
		source_episode: input.source_episode,
	});

	return id;
}

/**
 * Retrieve pending staged facts that have not yet expired.
 *
 * Returns rows WHERE `validation_status = 'pending' AND expires_at > now`,
 * ordered by `created_at ASC`, limited to `limit` rows (default 100).
 */
export async function getPendingStagedFacts(db: SiaDb, limit = 100): Promise<StagedFact[]> {
	const now = Date.now();
	const result = await db.execute(
		`SELECT * FROM memory_staging
		 WHERE validation_status = 'pending' AND expires_at > ?
		 ORDER BY created_at ASC
		 LIMIT ?`,
		[now, limit],
	);
	return result.rows as unknown as StagedFact[];
}

/**
 * Update the validation status of a staged fact.
 *
 * Optionally sets `rejection_reason`. Writes a QUARANTINE audit entry
 * when the status is 'rejected' or 'quarantined'.
 */
export async function updateStagingStatus(
	db: SiaDb,
	id: string,
	status: string,
	rejectionReason?: string,
): Promise<void> {
	await db.execute(
		`UPDATE memory_staging
		 SET validation_status = ?, rejection_reason = ?
		 WHERE id = ?`,
		[status, rejectionReason ?? null, id],
	);

	if (status === "rejected" || status === "quarantined") {
		await writeAuditEntry(db, "QUARANTINE", { entity_id: id });
	}
}

/**
 * Expire stale staged facts whose `expires_at` has passed while still pending.
 *
 * Sets `validation_status = 'expired'` for all matching rows.
 * Returns the number of rows affected.
 */
export async function expireStaleStagedFacts(db: SiaDb): Promise<number> {
	const now = Date.now();

	// Get count of rows that will be affected before updating
	const countResult = await db.execute(
		`SELECT COUNT(*) as cnt FROM memory_staging
		 WHERE expires_at <= ? AND validation_status = 'pending'`,
		[now],
	);
	const count = (countResult.rows[0]?.cnt as number) ?? 0;

	if (count > 0) {
		await db.execute(
			`UPDATE memory_staging
			 SET validation_status = 'expired'
			 WHERE expires_at <= ? AND validation_status = 'pending'`,
			[now],
		);
	}

	return count;
}
