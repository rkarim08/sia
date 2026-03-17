// Module: staging-promoter — Three-check promotion pipeline for staged Tier 4 facts
//
// For each pending staged fact, runs checks sequentially:
//   1. Pattern injection detection
//   2. Semantic consistency (if embedder available)
//   3. Confidence threshold (>= 0.75 for Tier 4, >= 0.60 for lower tiers)
//   4. Rule of Two LLM verification
//
// Pass => promote via consolidation pipeline. Fail => quarantine with reason.

import { consolidate } from "@/capture/consolidate";
import type { Embedder } from "@/capture/embedder";
import type { CandidateFact, EntityType } from "@/capture/types";
import { writeAuditEntry } from "@/graph/audit";
import type { SiaDb } from "@/graph/db-interface";
import {
	expireStaleStagedFacts,
	getPendingStagedFacts,
	updateStagingStatus,
} from "@/graph/staging";
import { detectInjection } from "@/security/pattern-detector";
import { checkRuleOfTwo } from "@/security/rule-of-two";
import { checkSemanticConsistency, loadCentroid } from "@/security/semantic-consistency";
import type { LlmClient } from "@/shared/llm-client";

/** Aggregate result of a promotion run. */
export interface PromotionResult {
	promoted: number;
	quarantined: number;
	expired: number;
}

/**
 * Run the staging promotion pipeline.
 *
 * 1. Expire stale staged facts (past TTL).
 * 2. Fetch all pending staged facts.
 * 3. For each, run checks sequentially — quarantine on first failure.
 * 4. If all checks pass, promote via consolidation and mark as 'passed'.
 */
export async function promoteStagedFacts(
	db: SiaDb,
	opts: {
		repoHash: string;
		siaHome?: string;
		llmClient?: LlmClient;
		embedder?: Embedder;
		airGapped?: boolean;
	},
): Promise<PromotionResult> {
	const result: PromotionResult = { promoted: 0, quarantined: 0, expired: 0 };

	// Step 1: Clean up expired entries
	const expiredCount = await expireStaleStagedFacts(db);
	result.expired = expiredCount;

	// Step 2: Get pending facts
	const pendingFacts = await getPendingStagedFacts(db);

	// Step 3: Process each pending fact
	for (const fact of pendingFacts) {
		let quarantineReason: string | null = null;

		// Check 1: Pattern injection detection
		if (!quarantineReason) {
			const injectionResult = detectInjection(fact.proposed_content);
			if (injectionResult.flagged) {
				quarantineReason = `pattern_injection: ${injectionResult.reason}`;
			}
		}

		// Check 2: Semantic consistency (only if embedder available)
		if (!quarantineReason && opts.embedder) {
			const embedding = await opts.embedder.embed(fact.proposed_content);
			if (embedding) {
				const centroidState = loadCentroid(opts.repoHash, opts.siaHome);
				if (centroidState) {
					const semanticResult = checkSemanticConsistency(embedding, centroidState.centroid);
					if (semanticResult.flagged) {
						quarantineReason = `off_domain: distance=${semanticResult.distance}`;
					}
				}
			}
		}

		// Check 3: Confidence threshold
		if (!quarantineReason) {
			const threshold = fact.trust_tier >= 4 ? 0.75 : 0.6;
			if (fact.raw_confidence < threshold) {
				quarantineReason = "low_confidence";
			}
		}

		// Check 4: Rule of Two
		if (!quarantineReason) {
			const ruleResult = await checkRuleOfTwo(
				fact.proposed_content,
				fact.trust_tier,
				"ADD",
				opts.llmClient ?? null,
				opts.airGapped ?? false,
			);
			if (ruleResult.quarantined) {
				quarantineReason = ruleResult.reason ?? "RULE_OF_TWO_VIOLATION";
			}
		}

		if (quarantineReason) {
			// Quarantine the fact
			await updateStagingStatus(db, fact.id, "quarantined", quarantineReason);
			await writeAuditEntry(db, "QUARANTINE", { entity_id: fact.id });
			result.quarantined++;
		} else {
			// All checks passed — promote via consolidation
			const candidate: CandidateFact = {
				type: fact.proposed_type as EntityType,
				name: fact.proposed_name,
				content: fact.proposed_content,
				summary: fact.proposed_content.slice(0, 80),
				tags: safeParseTags(fact.proposed_tags),
				file_paths: safeParseFilePaths(fact.proposed_file_paths),
				trust_tier: fact.trust_tier as 1 | 2 | 3 | 4,
				confidence: fact.raw_confidence,
			};

			await consolidate(db, [candidate]);
			await updateStagingStatus(db, fact.id, "passed");
			await writeAuditEntry(db, "PROMOTE", { entity_id: fact.id });
			result.promoted++;
		}
	}

	return result;
}

/** Safely parse a JSON string array, returning [] on failure. */
function safeParseTags(json: string): string[] {
	try {
		const parsed = JSON.parse(json);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

/** Safely parse a JSON string array for file paths, returning [] on failure. */
function safeParseFilePaths(json: string): string[] {
	try {
		const parsed = JSON.parse(json);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}
