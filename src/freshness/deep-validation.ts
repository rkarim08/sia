/**
 * deep-validation.ts — Layer 5 of the freshness engine.
 *
 * Periodic deep validation pipeline (nightly / weekly).
 * Catches anything that real-time layers (1–4) missed:
 *
 *   (a) Documentation-vs-code cross-validation
 *   (b) Low-confidence LLM-inferred claim re-verification
 *   (c) PageRank importance score recomputation
 *   (d) Version compaction (archived entity purge + FTS5 optimize)
 *
 * Must be run in a separate DB connection — never blocks the MCP server.
 */

import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { computePageRank } from "@/ast/pagerank-builder";
import type { SiaDb } from "@/graph/db-interface";
import { invalidateEntity } from "@/graph/entities";
import { updateImportanceScores } from "@/retrieval/pagerank";

// ─── Public types ───────────────────────────────────────────────────────────

export interface DeepValidationResult {
	documentsChecked: number;
	staleDocsFound: number;
	claimsReVerified: number;
	claimsInvalidated: number;
	claimsConfirmed: number;
	nodesScored: number; // PageRank
	versionsCompacted: number;
	ftsOptimized: boolean;
	durationMs: number;
}

export interface DeepValidationConfig {
	maxClaimsToVerify: number; // default 20
	retentionDays: number; // default 90
	eventRetentionDays: number; // default 30
	archiveThreshold: number; // default 0.05
}

const DEFAULT_CONFIG: DeepValidationConfig = {
	maxClaimsToVerify: 20,
	retentionDays: 90,
	eventRetentionDays: 30,
	archiveThreshold: 0.05,
};

// ─── Main pipeline ──────────────────────────────────────────────────────────

/**
 * Run the full deep validation pipeline.
 * Should be called nightly via the decay scheduler.
 * Runs in a separate DB connection — never blocks the MCP server.
 */
export async function runDeepValidation(
	db: SiaDb,
	repoRoot: string,
	config?: Partial<DeepValidationConfig>,
): Promise<DeepValidationResult> {
	const cfg: DeepValidationConfig = { ...DEFAULT_CONFIG, ...config };
	const start = Date.now();

	// (a) Documentation cross-validation
	const { checked, staleFound } = await validateDocumentation(db, repoRoot);

	// (b) Low-confidence claim re-verification
	const { verified, invalidated, confirmed } = await identifyLowConfidenceClaims(
		db,
		cfg.maxClaimsToVerify,
	);

	// (c) PageRank recomputation
	const { nodesScored } = await recomputePageRank(db);

	// (d) Version compaction
	const { compacted, ftsOptimized } = await compactVersions(db, cfg);

	const durationMs = Date.now() - start;

	return {
		documentsChecked: checked,
		staleDocsFound: staleFound,
		claimsReVerified: verified,
		claimsInvalidated: invalidated,
		claimsConfirmed: confirmed,
		nodesScored,
		versionsCompacted: compacted,
		ftsOptimized,
		durationMs,
	};
}

// ─── Sub-task (a): Documentation-vs-code cross-validation ──────────────────

/**
 * Sub-task (a): Documentation-vs-code cross-validation.
 *
 * For each entity with trust_tier 1 and type in ('CodeEntity','Convention','Decision')
 * that has a non-empty file_paths array, stat() the referenced files.
 * If any file was modified (mtime) after the entity's t_created, tag it as potentially-stale
 * and reduce its confidence.
 */
export async function validateDocumentation(
	db: SiaDb,
	repoRoot: string,
): Promise<{ checked: number; staleFound: number }> {
	const { rows } = await db.execute(
		`SELECT id, file_paths, t_created, confidence, tags
		 FROM graph_nodes
		 WHERE type IN ('CodeEntity', 'Convention', 'Decision')
		   AND trust_tier = 1
		   AND file_paths IS NOT NULL
		   AND file_paths != '[]'
		   AND t_valid_until IS NULL
		   AND archived_at IS NULL`,
	);

	let checked = 0;
	let staleFound = 0;

	for (const row of rows) {
		const entityId = row.id as string;
		const tCreated = row.t_created as number;
		const filePathsRaw = row.file_paths as string;
		const currentTagsRaw = row.tags as string;
		const currentConfidence = row.confidence as number;

		let filePaths: string[];
		try {
			filePaths = JSON.parse(filePathsRaw) as string[];
		} catch {
			continue;
		}

		if (!Array.isArray(filePaths) || filePaths.length === 0) continue;

		checked++;

		let isStale = false;

		for (const rawPath of filePaths) {
			if (typeof rawPath !== "string" || rawPath.length === 0) continue;

			// Resolve relative paths against repoRoot
			const absPath = rawPath.startsWith("/") ? rawPath : join(repoRoot, rawPath);

			if (!existsSync(absPath)) continue;

			try {
				const fileStat = await stat(absPath);
				if (fileStat.mtimeMs > tCreated) {
					isStale = true;
					break;
				}
			} catch {
				// Stat failed — skip this path
			}
		}

		if (isStale) {
			staleFound++;

			// Tag entity as potentially-stale and reduce confidence
			let tags: string[];
			try {
				tags = JSON.parse(currentTagsRaw) as string[];
			} catch {
				tags = [];
			}
			if (!tags.includes("potentially-stale")) {
				tags.push("potentially-stale");
			}

			const newConfidence = Math.max(0.01, currentConfidence - 0.1);
			await db.execute("UPDATE graph_nodes SET tags = ?, confidence = ? WHERE id = ?", [
				JSON.stringify(tags),
				newConfidence,
				entityId,
			]);
		}
	}

	return { checked, staleFound };
}

// ─── Sub-task (b): Low-confidence claim re-verification ────────────────────

/**
 * Sub-task (b): Sample lowest-confidence LLM-inferred (tier-3) entities
 * and flag them for re-verification.
 *
 * In production this would call an LLM (e.g. Haiku), but for now we identify
 * candidates and update their Bayesian state based on whether source files
 * still exist on disk.
 *
 * - If the entity has no file_paths or all referenced files still exist → confirmed
 * - If any referenced file has been deleted → invalidated
 */
export async function identifyLowConfidenceClaims(
	db: SiaDb,
	maxClaims = 20,
): Promise<{ verified: number; invalidated: number; confirmed: number }> {
	const { rows } = await db.execute(
		`SELECT id, file_paths, confidence
		 FROM graph_nodes
		 WHERE trust_tier = 3
		   AND t_valid_until IS NULL
		   AND archived_at IS NULL
		 ORDER BY confidence ASC
		 LIMIT ?`,
		[maxClaims],
	);

	let verified = 0;
	let invalidated = 0;
	let confirmed = 0;

	for (const row of rows) {
		const entityId = row.id as string;
		const filePathsRaw = row.file_paths as string;

		let filePaths: string[];
		try {
			filePaths = JSON.parse(filePathsRaw) as string[];
		} catch {
			filePaths = [];
		}

		verified++;

		if (!Array.isArray(filePaths) || filePaths.length === 0) {
			// No source file to check — treat as confirmed
			confirmed++;
			await db.execute(
				"UPDATE graph_nodes SET confidence = MIN(1.0, confidence + 0.05) WHERE id = ?",
				[entityId],
			);
			continue;
		}

		// Check if any source file has been deleted
		const hasDeletedFile = filePaths.some(
			(p) => typeof p === "string" && p.length > 0 && !existsSync(p),
		);

		if (hasDeletedFile) {
			invalidated++;
			await invalidateEntity(db, entityId);
		} else {
			confirmed++;
			// Bump confidence slightly as a re-observation
			await db.execute(
				"UPDATE graph_nodes SET confidence = MIN(1.0, confidence + 0.05) WHERE id = ?",
				[entityId],
			);
		}
	}

	return { verified, invalidated, confirmed };
}

// ─── Sub-task (c): PageRank recomputation ──────────────────────────────────

/**
 * Sub-task (c): Recompute PageRank importance scores.
 * Uses the existing computePageRank from ast/pagerank-builder.ts.
 */
export async function recomputePageRank(db: SiaDb): Promise<{ nodesScored: number }> {
	const result = await computePageRank(db);

	// computePageRank already writes importance scores directly.
	// We call updateImportanceScores with an empty map to emit the audit log entry,
	// but only if there were actually nodes to avoid a no-op audit spam.
	if (result.nodesScored > 0) {
		// Build score map from the computed results
		const { rows } = await db.execute(
			"SELECT id, importance FROM graph_nodes WHERE t_valid_until IS NULL AND archived_at IS NULL",
		);
		const scores = new Map<string, number>(
			rows.map((r) => [r.id as string, r.importance as number]),
		);
		await updateImportanceScores(db, scores);
	}

	return { nodesScored: result.nodesScored };
}

// ─── Sub-task (d): Version compaction ──────────────────────────────────────

/**
 * Sub-task (d): Version compaction.
 *
 * 1. Hard-delete archived entities older than `retentionDays`.
 * 2. Hard-delete archived event entities with low importance, zero edges,
 *    and older than `eventRetentionDays`.
 * 3. Run FTS5 optimize.
 */
export async function compactVersions(
	db: SiaDb,
	config?: Partial<DeepValidationConfig>,
): Promise<{ compacted: number; ftsOptimized: boolean }> {
	const cfg: DeepValidationConfig = { ...DEFAULT_CONFIG, ...config };

	const now = Date.now();
	const retentionCutoff = now - cfg.retentionDays * 86_400_000;
	const eventRetentionCutoff = now - cfg.eventRetentionDays * 86_400_000;

	// 1. Delete archived entities beyond the main retention window
	const { rows: deletedRows } = await db.execute(
		`DELETE FROM graph_nodes
		 WHERE archived_at IS NOT NULL
		   AND archived_at < ?
		 RETURNING id`,
		[retentionCutoff],
	);
	let compacted = deletedRows.length;

	// 2. Delete archived event entities with low importance and zero edges
	//    that are beyond the event retention window
	const { rows: deletedEventRows } = await db.execute(
		`DELETE FROM graph_nodes
		 WHERE type LIKE '%Event'
		   AND importance < ?
		   AND edge_count = 0
		   AND archived_at IS NOT NULL
		   AND archived_at < ?
		 RETURNING id`,
		[cfg.archiveThreshold, eventRetentionCutoff],
	);
	compacted += deletedEventRows.length;

	// 3. Optimize the FTS5 virtual table
	let ftsOptimized = false;
	try {
		await db.execute("INSERT INTO graph_nodes_fts(graph_nodes_fts) VALUES('optimize')", []);
		ftsOptimized = true;
	} catch {
		// FTS5 table may not exist in all test environments — treat as non-fatal
		ftsOptimized = false;
	}

	return { compacted, ftsOptimized };
}
