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
import type { SiaDb } from "@/graph/db-interface";
import { insertEntity } from "@/graph/entities";
import { openEpisodicDb, openGraphDb } from "@/graph/semantic-db";
import { getConfig, type SiaConfig } from "@/shared/config";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PipelineOpts {
	siaHome?: string;
	config?: SiaConfig;
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
 * Returns the number of cross-repo edges detected (0 for now if no bridge api_contracts to match).
 */
export function detectCrossRepoEdges(
	_graphDb: SiaDb,
	_bridgeDb: SiaDb,
	candidates: CandidateFact[],
	_repoHash: string,
): number {
	let detected = 0;
	for (const candidate of candidates) {
		if (/"workspace:\*"/.test(candidate.content)) {
			detected++;
		}
		if (/"references":/.test(candidate.content)) {
			detected++;
		}
	}
	// For now we just return the count of patterns found; actual bridge edge
	// creation will come when meta.db api_contracts table exists.
	return detected;
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
					consolidation = await consolidate(graphDb, allCandidates);

					// Gather IDs of newly added entities for edge inference
					for (const candidate of allCandidates) {
						const result = await graphDb.execute(
							"SELECT id FROM entities WHERE name = ? AND type = ? AND t_valid_until IS NULL AND archived_at IS NULL ORDER BY t_created DESC LIMIT 1",
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
