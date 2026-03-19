// Module: conflict — conflict detection for concurrent facts

import { v4 as uuid } from "uuid";
import { wordJaccard } from "@/capture/consolidate";
import type { SiaDb } from "@/graph/db-interface";
import type { Entity } from "@/graph/entities";
import type { LlmClient } from "@/shared/llm-client";
import { cosineSimilarity } from "@/sync/dedup";

/**
 * Compute the magnitude (L2 norm) of an embedding vector.
 */
function embeddingMagnitude(e: Uint8Array | null): number | null {
	if (!e) return null;
	const f = new Float32Array(e.buffer, e.byteOffset, Math.floor(e.byteLength / 4));
	if (f.length === 0) return null;
	let sum = 0;
	for (let i = 0; i < f.length; i++) {
		sum += f[i] * f[i];
	}
	return Math.sqrt(sum);
}

function rangesOverlap(
	aStart: number | null,
	aEnd: number | null,
	bStart: number | null,
	bEnd: number | null,
): boolean {
	const a0 = aStart ?? Number.MIN_SAFE_INTEGER;
	const a1 = aEnd ?? Number.MAX_SAFE_INTEGER;
	const b0 = bStart ?? Number.MIN_SAFE_INTEGER;
	const b1 = bEnd ?? Number.MAX_SAFE_INTEGER;
	return a0 <= b1 && b0 <= a1;
}

export async function detectConflicts(db: SiaDb, llmClient?: LlmClient): Promise<number> {
	const result = await db.execute(
		"SELECT * FROM entities WHERE archived_at IS NULL AND t_valid_until IS NULL",
	);
	const entities = result.rows as unknown as Entity[];

	let conflicts = 0;

	for (let i = 0; i < entities.length; i++) {
		for (let j = i + 1; j < entities.length; j++) {
			const a = entities[i];
			const b = entities[j];

			if (a.type !== b.type) continue;
			if (!rangesOverlap(a.t_valid_from, a.t_valid_until, b.t_valid_from, b.t_valid_until))
				continue;

			// Pre-filter: skip pairs where embedding magnitude difference > 0.3
			const magA = embeddingMagnitude(a.embedding);
			const magB = embeddingMagnitude(b.embedding);
			if (magA !== null && magB !== null && Math.abs(magA - magB) > 0.3) continue;

			// Similarity check: cosine for entities with embeddings, wordJaccard fallback
			let similar = false;
			const bothHaveEmbeddings = a.embedding !== null && b.embedding !== null;
			if (bothHaveEmbeddings) {
				const cosine = cosineSimilarity(a.embedding, b.embedding);
				similar = cosine !== null && cosine > 0.85;
			} else {
				const jaccard = wordJaccard(a.content, b.content);
				similar = jaccard > 0.95;
			}

			if (!similar) continue;

			// Contradiction check: LLM classification or content comparison fallback
			let contradictory: boolean;
			if (llmClient) {
				const prompt = `Fact A: "${a.name}" — ${a.content}\nFact B: "${b.name}" — ${b.content}\n\nAre these two facts contradictory, complementary, or duplicate?`;
				const classification = await llmClient.classify(prompt, [
					"contradictory",
					"complementary",
					"duplicate",
				]);
				contradictory = classification === "contradictory";
			} else {
				contradictory = a.content !== b.content;
			}

			if (contradictory) {
				const groupId = a.conflict_group_id ?? b.conflict_group_id ?? uuid();
				if (a.conflict_group_id !== groupId) {
					await db.execute("UPDATE entities SET conflict_group_id = ? WHERE id = ?", [
						groupId,
						a.id,
					]);
				}
				if (b.conflict_group_id !== groupId) {
					await db.execute("UPDATE entities SET conflict_group_id = ? WHERE id = ?", [
						groupId,
						b.id,
					]);
				}
				conflicts++;
			}
		}
	}

	return conflicts;
}
