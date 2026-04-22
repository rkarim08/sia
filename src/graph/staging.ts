// Module: staging — CRUD for the memory_staging table (Tier 4 security staging area)
//
// Also exposes `promoteStagedEntities()`, a lightweight promotion entry point
// used by hook handlers (PreCompact, SessionEnd) where no LLM / embedder is
// available. This helper runs TTL expiry + a confidence-gated, injection-safe
// promotion pass that upgrades provisional Tier-4 staging rows into the graph
// via `consolidate()`. The full four-check pipeline (with embedder + Rule of
// Two) lives in `src/security/staging-promoter.ts::promoteStagedFacts()`; this
// helper is its hook-friendly, LLM-free counterpart.

import { randomUUID } from "node:crypto";
import { consolidate } from "@/capture/consolidate";
import type { CandidateFact, EntityType } from "@/capture/types";
import { writeAuditEntry } from "@/graph/audit";
import type { SiaDb } from "@/graph/db-interface";
import { detectInjection } from "@/security/pattern-detector";

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

/** Result of a single `promoteStagedEntities` pass. */
export interface PromoteStagedResult {
	/** Staged rows that passed all checks and were promoted via `consolidate()`. */
	promoted: number;
	/** Staged rows that stayed `'pending'` — below confidence threshold but not unsafe. */
	kept: number;
	/**
	 * Staged rows rejected this pass — sum of pattern-injection quarantines and
	 * TTL expirations processed in the same call.
	 */
	rejected: number;
}

/** Confidence gate for Tier-4 staged facts. Below this → keep pending. */
const TIER4_CONFIDENCE_THRESHOLD = 0.85;
/** Confidence gate for Tier 1–3 staged facts. */
const TIER_LOW_CONFIDENCE_THRESHOLD = 0.7;
/** Per-call cap so a flood of staged facts cannot stall a hook. */
const MAX_STAGED_PER_CALL = 50;

/**
 * Promote staged provisional entities that have acquired enough confirmatory
 * signals during the session. Hook-friendly (PreCompact / SessionEnd) — runs
 * without LLM or embedder dependencies.
 *
 * Pipeline per pending row:
 *   1. Expire stale rows (TTL past) → counted in `rejected`.
 *   2. Pattern-injection detection → quarantine → counted in `rejected`.
 *   3. Confidence gate (Tier 4: ≥ 0.85, else ≥ 0.70).
 *      - Fail → leave `'pending'` → counted in `kept`.
 *      - Pass → `consolidate()` + mark `'passed'` → counted in `promoted`.
 *
 * Safe no-op: if the `memory_staging` table is missing, returns
 * `{ promoted: 0, kept: 0, rejected: 0 }` without throwing. This is the
 * documented "schema lacks staging columns" fallback called out in the plan.
 *
 * @param opts.dry — if true, only compute classifications; do not write.
 */
export async function promoteStagedEntities(
	db: SiaDb,
	opts?: { dry?: boolean },
): Promise<PromoteStagedResult> {
	const dry = opts?.dry ?? false;
	const result: PromoteStagedResult = { promoted: 0, kept: 0, rejected: 0 };

	// Step 1: expire stale rows (counted against `rejected`).
	let expiredCount = 0;
	try {
		if (!dry) {
			expiredCount = await expireStaleStagedFacts(db);
		}
	} catch (err) {
		// Only a missing `memory_staging` table is a legitimate silent no-op (the
		// documented schema fallback). Anything else — locked DB, corrupt row,
		// I/O error — must be surfaced to stderr so the failure is debuggable.
		// We still return the zeroed result so the hook does not break the
		// surrounding PreCompact / SessionEnd flow.
		const msg = err instanceof Error ? err.message : String(err);
		const isNoTable = /no such table/i.test(msg);
		if (!isNoTable) {
			process.stderr.write(`[sia:staging] expireStaleStagedFacts failed: ${msg}\n`);
		}
		return result;
	}
	result.rejected += expiredCount;

	// Step 2: fetch pending rows (capped).
	let pending: StagedFact[];
	try {
		pending = await getPendingStagedFacts(db, MAX_STAGED_PER_CALL);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		const isNoTable = /no such table/i.test(msg);
		if (!isNoTable) {
			process.stderr.write(`[sia:staging] getPendingStagedFacts failed: ${msg}\n`);
		}
		return result;
	}

	// Step 3: classify + (unless dry) write.
	for (const fact of pending) {
		const injection = detectInjection(fact.proposed_content);
		if (injection.flagged) {
			if (!dry) {
				await updateStagingStatus(
					db,
					fact.id,
					"quarantined",
					`pattern_injection: ${injection.reason ?? "detected"}`,
				);
			}
			result.rejected++;
			continue;
		}

		// Null/undefined trust_tier = unknown provenance = highest scrutiny.
		// `null >= 4` is false in JS, which would wrongly drop such rows into
		// the lower 0.70 gate. Default to Tier 4 so unknown-tier facts get the
		// strict 0.85 threshold.
		const tier = fact.trust_tier ?? 4;
		const threshold = tier >= 4 ? TIER4_CONFIDENCE_THRESHOLD : TIER_LOW_CONFIDENCE_THRESHOLD;
		if (fact.raw_confidence < threshold) {
			// Below threshold → keep pending; future sessions may raise confidence.
			result.kept++;
			continue;
		}

		if (dry) {
			result.promoted++;
			continue;
		}

		const candidate: CandidateFact = {
			type: fact.proposed_type as EntityType,
			name: fact.proposed_name,
			content: fact.proposed_content,
			summary: fact.proposed_content.slice(0, 80),
			tags: safeParseStringArray(fact.proposed_tags),
			file_paths: safeParseStringArray(fact.proposed_file_paths),
			trust_tier: fact.trust_tier as 1 | 2 | 3 | 4,
			confidence: fact.raw_confidence,
			extraction_method: "staging:promoteStagedEntities",
		};

		await consolidate(db, [candidate]);
		await updateStagingStatus(db, fact.id, "passed");
		await writeAuditEntry(db, "PROMOTE", { entity_id: fact.id });
		result.promoted++;
	}

	return result;
}

/** Best-effort JSON-array-of-strings parser. Returns `[]` on any failure. */
function safeParseStringArray(raw: string): string[] {
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
	} catch {
		return [];
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
