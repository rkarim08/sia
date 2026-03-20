// Module: pipeline — End-to-end capture pipeline orchestration
//
// Wires together: chunker -> Track A + Track B -> consolidation -> edge inference -> flag processing.
// Includes circuit breaker for consolidation failures and global timeout.

import { randomUUID } from "node:crypto";
import { chunkPayload } from "@/capture/chunker";
import { consolidate } from "@/capture/consolidate";
import { inferEdges } from "@/capture/edge-inferrer";
import { processFlags } from "@/capture/flag-processor";
import { resolveRepoHash } from "@/capture/hook";
import { extractTrackA } from "@/capture/track-a-ast";
import { extractTrackB } from "@/capture/track-b-llm";
import type {
	CandidateFact,
	ConsolidationResult,
	HookPayload,
	PipelineResult,
} from "@/capture/types";
import { writeAuditEntry } from "@/graph/audit";
import { insertCrossRepoEdge, openBridgeDb } from "@/graph/bridge-db";
import type { SiaDb } from "@/graph/db-interface";
import { insertEntity, updateEntity } from "@/graph/entities";
import { openEpisodicDb, openGraphDb } from "@/graph/semantic-db";
import { insertStagedFact } from "@/graph/staging";
import { getConfig, type SiaConfig } from "@/shared/config";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PipelineOpts {
	siaHome?: string;
	config?: SiaConfig;
	/** Optional meta.db handle for sharing rules enforcement. */
	metaDb?: SiaDb;
}

// ---------------------------------------------------------------------------
// Circuit breaker — module-level state
// ---------------------------------------------------------------------------

let failureCount = 0;
let breakerActiveUntil = 0;

/** Reset the circuit breaker (for testing). */
export function resetCircuitBreaker(): void {
	failureCount = 0;
	breakerActiveUntil = 0;
}

function isCircuitBreakerActive(): boolean {
	if (Date.now() > breakerActiveUntil && breakerActiveUntil > 0) {
		// Breaker expired — reset
		failureCount = 0;
		breakerActiveUntil = 0;
	}
	return Date.now() < breakerActiveUntil;
}

// ---------------------------------------------------------------------------
// Cross-repo detection
// ---------------------------------------------------------------------------

/**
 * Scan candidates for workspace:* npm imports or TypeScript project references.
 * When metaDb is provided, looks up api_contracts where the current repo is the consumer
 * and writes depends_on edges to bridge.db for matching patterns.
 * Returns the number of cross-repo edges written (0 if no metaDb provided).
 */
export async function detectCrossRepoEdges(
	_graphDb: SiaDb,
	bridgeDb: SiaDb,
	candidates: CandidateFact[],
	repoHash: string,
	metaDb?: SiaDb,
): Promise<number> {
	if (!metaDb) {
		return 0;
	}

	// Find candidates that match cross-repo patterns
	const matchingCandidates: CandidateFact[] = [];
	for (const candidate of candidates) {
		if (/"workspace:\*"/.test(candidate.content) || /"references":/.test(candidate.content)) {
			matchingCandidates.push(candidate);
		}
	}

	if (matchingCandidates.length === 0) {
		return 0;
	}

	// Look up api_contracts where this repo is the consumer
	const { rows: contracts } = await metaDb.execute(
		"SELECT id, provider_repo_id, consumer_repo_id, contract_type FROM api_contracts WHERE consumer_repo_id = ?",
		[repoHash],
	);

	if (contracts.length === 0) {
		return 0;
	}

	// Write a depends_on edge for each (matching candidate, contract) pair
	let edgesWritten = 0;
	for (const candidate of matchingCandidates) {
		for (const contract of contracts) {
			const providerRepoId = contract.provider_repo_id as string;
			await insertCrossRepoEdge(bridgeDb, {
				source_repo_id: repoHash,
				source_entity_id: candidate.name,
				target_repo_id: providerRepoId,
				target_entity_id: providerRepoId,
				type: "depends_on",
				trust_tier: 2,
				created_by: "auto-detect",
			});
			edgesWritten++;
		}
	}

	return edgesWritten;
}

// ---------------------------------------------------------------------------
// Session compaction
// ---------------------------------------------------------------------------

/**
 * Compact session content when it exceeds the working memory token budget.
 * Creates a summary entity tagged with 'session-compaction'.
 */
export async function compactSession(
	db: SiaDb,
	sessionContent: string,
	config: SiaConfig,
): Promise<void> {
	// Rough token estimate: 1 token ~ 4 chars
	const estimatedTokens = Math.ceil(sessionContent.length / 4);
	if (estimatedTokens <= config.workingMemoryTokenBudget) {
		return;
	}

	const summary = sessionContent.slice(0, 200);
	await insertEntity(db, {
		type: "Concept",
		name: summary.slice(0, 50),
		content: summary,
		summary: summary.slice(0, 80),
		tags: JSON.stringify(["session-compaction"]),
	});
}

// ---------------------------------------------------------------------------
// Pipeline timeout helper
// ---------------------------------------------------------------------------

const PIPELINE_TIMEOUT_MS = 8_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	return Promise.race([
		promise,
		new Promise<never>((_resolve, reject) => {
			setTimeout(() => reject(new Error("Pipeline timeout")), ms);
		}),
	]);
}

// ---------------------------------------------------------------------------
// Sharing rules enforcement (Task 11.6)
// ---------------------------------------------------------------------------

/**
 * After consolidation, check sharing_rules in meta.db and override entity
 * visibility for entities matching a rule's workspace + type criteria.
 * Logs auto-promotion to audit_log.
 */
async function applySharingRules(
	graphDb: SiaDb,
	metaDb: SiaDb,
	repoHash: string,
	entityIds: string[],
): Promise<void> {
	if (entityIds.length === 0) return;

	// Find which workspace this repo belongs to
	const { rows: wsRows } = await metaDb.execute(
		"SELECT workspace_id FROM workspace_repos WHERE repo_id = ?",
		[repoHash],
	);
	if (wsRows.length === 0) return;

	const workspaceId = wsRows[0].workspace_id as string;

	// Query sharing rules for this workspace (or global rules where workspace_id IS NULL)
	const { rows: rules } = await metaDb.execute(
		`SELECT entity_type, default_visibility FROM sharing_rules
		 WHERE (workspace_id = ? OR workspace_id IS NULL)
		 ORDER BY workspace_id DESC`,
		[workspaceId],
	);
	if (rules.length === 0) return;

	// Build a type→visibility lookup (workspace-specific rules take precedence)
	const ruleMap = new Map<string | null, string>();
	for (const rule of rules) {
		const type = (rule.entity_type as string | null) ?? null;
		if (!ruleMap.has(type)) {
			ruleMap.set(type, rule.default_visibility as string);
		}
	}

	// Apply rules to newly created entities
	for (const entityId of entityIds) {
		const { rows } = await graphDb.execute(
			"SELECT type, visibility FROM graph_nodes WHERE id = ?",
			[entityId],
		);
		if (rows.length === 0) continue;

		const entityType = rows[0].type as string;
		const currentVisibility = rows[0].visibility as string;

		// Check type-specific rule first, then wildcard (null type)
		const newVisibility = ruleMap.get(entityType) ?? ruleMap.get(null);
		if (newVisibility && newVisibility !== currentVisibility) {
			await updateEntity(graphDb, entityId, { visibility: newVisibility });
			await writeAuditEntry(graphDb, "UPDATE", { entity_id: entityId });
		}
	}
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

export async function runPipeline(
	payload: HookPayload,
	opts?: PipelineOpts,
): Promise<PipelineResult> {
	const start = Date.now();
	const siaHome = opts?.siaHome;
	const config = opts?.config ?? getConfig(siaHome);
	const repoHash = resolveRepoHash(payload.cwd);

	const graphDb = openGraphDb(repoHash, siaHome);
	const episodicDb = openEpisodicDb(repoHash, siaHome);

	// Partial result used on timeout or failure
	const partialResult = (): PipelineResult => ({
		candidates: 0,
		consolidation: { added: 0, updated: 0, invalidated: 0, noops: 0 },
		edgesCreated: 0,
		flagsProcessed: 0,
		durationMs: Date.now() - start,
		circuitBreakerActive: isCircuitBreakerActive(),
	});

	async function run(): Promise<PipelineResult> {
		try {
			// Step 4-5: Write episode to episodic.db FIRST
			const episodeId = randomUUID();
			const episodeType = payload.toolName ? "tool_use" : "conversation";
			const role = payload.type === "Stop" ? "assistant" : "tool";

			await episodicDb.execute(
				`INSERT INTO episodes (id, session_id, ts, type, role, content, tool_name, file_path, trust_tier)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				[
					episodeId,
					payload.sessionId,
					Date.now(),
					episodeType,
					role,
					payload.content,
					payload.toolName ?? null,
					payload.filePath ?? null,
					payload.type === "Stop" ? 1 : 3,
				],
			);

			// Step 6: Run chunker
			const chunkerCandidates = await chunkPayload(payload, config, graphDb);

			// Step 7: Run Track A + Track B in parallel
			const [trackAResult, trackBResult] = await Promise.allSettled([
				Promise.resolve(extractTrackA(payload.content, payload.filePath)),
				extractTrackB(payload.content, {
					captureModel: config.captureModel,
					minExtractConfidence: config.minExtractConfidence,
					airGapped: config.airGapped,
				}),
			]);

			// Step 8: Merge all candidates
			const allCandidates: CandidateFact[] = [...chunkerCandidates];
			if (trackAResult.status === "fulfilled") {
				allCandidates.push(...trackAResult.value);
			}
			if (trackBResult.status === "fulfilled") {
				allCandidates.push(...trackBResult.value);
			}

			// Step 9: Consolidation (or direct-write if circuit breaker active)
			let consolidation: ConsolidationResult = { added: 0, updated: 0, invalidated: 0, noops: 0 };
			const newEntityIds: string[] = [];

			if (isCircuitBreakerActive()) {
				// Direct-write: insert all as ADD
				for (const candidate of allCandidates) {
					const entity = await insertEntity(graphDb, {
						type: candidate.type,
						name: candidate.name,
						content: candidate.content,
						summary: candidate.summary,
						tags: JSON.stringify(candidate.tags),
						file_paths: JSON.stringify(candidate.file_paths),
						trust_tier: candidate.trust_tier,
						confidence: candidate.confidence,
						extraction_method: candidate.extraction_method ?? null,
						t_valid_from: candidate.t_valid_from ?? null,
					});
					newEntityIds.push(entity.id);
					consolidation.added++;
				}
			} else {
				try {
					// Route Tier 4 candidates to staging instead of consolidation
					const tier4Candidates = allCandidates.filter((c) => c.trust_tier === 4);
					const nonTier4Candidates = allCandidates.filter((c) => c.trust_tier !== 4);

					for (const candidate of tier4Candidates) {
						await insertStagedFact(graphDb, {
							source_episode: payload.sessionId,
							proposed_type: candidate.type,
							proposed_name: candidate.name,
							proposed_content: candidate.content,
							proposed_tags: JSON.stringify(candidate.tags ?? []),
							proposed_file_paths: JSON.stringify(candidate.file_paths ?? []),
							trust_tier: candidate.trust_tier,
							raw_confidence: candidate.confidence,
						});
					}

					// Only consolidate non-Tier-4 candidates
					consolidation = await consolidate(graphDb, nonTier4Candidates);

					// Gather IDs of newly added entities for edge inference
					for (const candidate of nonTier4Candidates) {
						const result = await graphDb.execute(
							"SELECT id FROM graph_nodes WHERE name = ? AND type = ? AND t_valid_until IS NULL AND archived_at IS NULL ORDER BY t_created DESC LIMIT 1",
							[candidate.name, candidate.type],
						);
						const row = result.rows[0] as { id: string } | undefined;
						if (row) {
							newEntityIds.push(row.id);
						}
					}

					// Reset failure count on success
					failureCount = 0;
				} catch {
					failureCount++;
					if (failureCount >= 3) {
						breakerActiveUntil = Date.now() + 5 * 60 * 1000;
					}
					// Fall through — consolidation failed but pipeline continues
				}
			}

			// Step 10: Edge inference
			const edgesCreated = newEntityIds.length > 0 ? await inferEdges(graphDb, newEntityIds) : 0;

			// Step 10.6: Cross-repo edge detection — writes depends_on edges to bridge.db
			if (opts?.metaDb && allCandidates.length > 0) {
				try {
					const bridgeDb = openBridgeDb(siaHome);
					try {
						await detectCrossRepoEdges(graphDb, bridgeDb, allCandidates, repoHash, opts.metaDb);
					} finally {
						await bridgeDb.close();
					}
				} catch {
					// Best effort — bridge edge detection failure should not break pipeline
				}
			}

			// Step 10.5: Sharing rules enforcement (Task 11.6)
			if (opts?.metaDb && newEntityIds.length > 0) {
				try {
					await applySharingRules(graphDb, opts.metaDb, repoHash, newEntityIds);
				} catch {
					// Best effort — sharing rules failure should not break pipeline
				}
			}

			// Step 11: Flag processor
			const flagsProcessed = await processFlags(graphDb, payload.sessionId, config);

			// Step 12: Write sessions_processed entry
			await episodicDb.execute(
				`INSERT OR REPLACE INTO sessions_processed (session_id, processing_status, processed_at, entity_count, pipeline_version)
				 VALUES (?, ?, ?, ?, ?)`,
				[payload.sessionId, "complete", Date.now(), consolidation.added, config.captureModel],
			);

			return {
				candidates: allCandidates.length,
				consolidation,
				edgesCreated,
				flagsProcessed,
				durationMs: Date.now() - start,
				circuitBreakerActive: isCircuitBreakerActive(),
			};
		} catch (err) {
			// Write failed status
			try {
				await episodicDb.execute(
					`INSERT OR REPLACE INTO sessions_processed (session_id, processing_status, processed_at, entity_count, pipeline_version)
					 VALUES (?, ?, ?, ?, ?)`,
					[payload.sessionId, "failed", Date.now(), 0, config.captureModel],
				);
			} catch {
				// Best effort
			}
			throw err;
		}
	}

	try {
		const result = await withTimeout(run(), PIPELINE_TIMEOUT_MS);
		return result;
	} catch (_err) {
		// On timeout or unhandled error: write failed status, return partial
		try {
			await episodicDb.execute(
				`INSERT OR REPLACE INTO sessions_processed (session_id, processing_status, processed_at, entity_count, pipeline_version)
				 VALUES (?, ?, ?, ?, ?)`,
				[payload.sessionId, "failed", Date.now(), 0, config.captureModel],
			);
		} catch {
			// Best effort
		}
		return partialResult();
	} finally {
		// Step 13: Close databases
		await graphDb.close();
		await episodicDb.close();
	}
}
