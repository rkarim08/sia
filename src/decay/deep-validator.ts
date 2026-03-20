// Module: deep-validator — LLM re-verification of lowest-confidence Tier 3 entities

import type { BatchResult } from "@/decay/types";
import type { SiaDb } from "@/graph/db-interface";
import { invalidateEntity, updateEntity } from "@/graph/entities";
import type { LlmClient } from "@/shared/llm-client";

/**
 * Validate one low-confidence Tier 3 entity using LLM classification.
 *
 * Picks the active Tier 3 entity with the lowest confidence that hasn't
 * been validated recently (last_accessed > 24h ago), asks the LLM whether
 * the entity's content is still valid, and either boosts confidence or
 * invalidates it.
 *
 * Rate-limited externally by the maintenance scheduler to 1 call per
 * config.deepValidationRateMs (default 5s).
 */
export async function deepValidateBatch(
	db: SiaDb,
	llmClient: LlmClient,
	batchSize: number,
): Promise<BatchResult> {
	const cutoff = Date.now() - 86_400_000; // 24h ago

	const { rows } = await db.execute(
		`SELECT id, name, type, content, confidence FROM graph_nodes
		 WHERE trust_tier = 3
		   AND t_valid_until IS NULL
		   AND archived_at IS NULL
		   AND last_accessed < ?
		 ORDER BY confidence ASC
		 LIMIT ?`,
		[cutoff, batchSize],
	);

	let processed = 0;

	for (const row of rows) {
		const entityId = row.id as string;
		const name = row.name as string;
		const content = row.content as string;
		const currentConfidence = row.confidence as number;

		const prompt = `Is the following knowledge entity still likely to be accurate and relevant?\n\nName: ${name}\nContent: ${content}\n\nRespond with YES if it appears valid, or NO if it appears outdated or incorrect.`;

		const verdict = await llmClient.classify(prompt, ["YES", "NO"]);

		if (verdict === "YES") {
			// Boost confidence slightly (capped at 0.9 for Tier 3)
			const newConfidence = Math.min(currentConfidence + 0.1, 0.9);
			await updateEntity(db, entityId, { confidence: newConfidence });
		} else {
			// Invalidate — the LLM thinks this is no longer valid
			await invalidateEntity(db, entityId);
		}

		processed++;
	}

	return { processed, remaining: processed === batchSize };
}
