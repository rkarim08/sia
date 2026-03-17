// Module: consolidate — Two-phase consolidation of candidate facts into the graph

import type { CandidateFact, ConsolidationResult } from "@/capture/types";
import { writeAuditEntry } from "@/graph/audit";
import type { SiaDb } from "@/graph/db-interface";
import type { Entity } from "@/graph/entities";
import { insertEntity, invalidateEntity, updateEntity } from "@/graph/entities";

/**
 * Compute the Jaccard similarity between two strings based on their word sets.
 * Splits both strings on whitespace, computes |intersection| / |union|.
 * Returns 0 if either string is empty.
 */
export function wordJaccard(a: string, b: string): number {
	const setA = new Set(a.split(/\s+/).filter(Boolean));
	const setB = new Set(b.split(/\s+/).filter(Boolean));

	if (setA.size === 0 || setB.size === 0) return 0;

	let intersectionSize = 0;
	for (const word of setA) {
		if (setB.has(word)) intersectionSize++;
	}

	const unionSize = setA.size + setB.size - intersectionSize;
	if (unionSize === 0) return 0;

	return intersectionSize / unionSize;
}

/**
 * Consolidate an array of candidate facts into the graph database.
 *
 * For each candidate:
 * 1. Query existing entities matching name + type that are still active.
 * 2. If no match: ADD (insert new entity + audit).
 * 3. If match found, compute wordJaccard on content:
 *    - >0.8  => NOOP (skip, audit NOOP)
 *    - 0.4-0.8 => UPDATE (update content, audit UPDATE)
 *    - <0.4  => INVALIDATE old + ADD new (invalidate old, insert new, audit both)
 * 4. All writes happen inside db.transaction() for atomicity.
 * 5. Returns aggregate counts { added, updated, invalidated, noops }.
 */
export async function consolidate(
	db: SiaDb,
	candidates: CandidateFact[],
): Promise<ConsolidationResult> {
	const result: ConsolidationResult = {
		added: 0,
		updated: 0,
		invalidated: 0,
		noops: 0,
	};

	await db.transaction(async (tx) => {
		for (const candidate of candidates) {
			// 1. Query active entities with same name and type
			const existing = await tx.execute(
				"SELECT * FROM entities WHERE name = ? AND type = ? AND t_valid_until IS NULL AND archived_at IS NULL",
				[candidate.name, candidate.type],
			);

			const match = existing.rows[0] as Entity | undefined;

			if (!match) {
				// 2. No match — ADD
				const _inserted = await insertEntity(tx, {
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
				// insertEntity already writes an ADD audit entry
				result.added++;
			} else {
				// 3. Match found — compare content similarity
				const similarity = wordJaccard(match.content, candidate.content);

				if (similarity > 0.8) {
					// NOOP — content is sufficiently similar
					await writeAuditEntry(tx, "NOOP", { entity_id: match.id });
					result.noops++;
				} else if (similarity >= 0.4) {
					// UPDATE — content is moderately similar
					await updateEntity(tx, match.id, {
						content: candidate.content,
						summary: candidate.summary,
						tags: JSON.stringify(candidate.tags),
						file_paths: JSON.stringify(candidate.file_paths),
						confidence: candidate.confidence,
						extraction_method: candidate.extraction_method ?? null,
					});
					// updateEntity already writes an UPDATE audit entry
					result.updated++;
				} else {
					// INVALIDATE old + ADD new — content is too different
					await invalidateEntity(tx, match.id);
					// invalidateEntity already writes an INVALIDATE audit entry

					await insertEntity(tx, {
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
					// insertEntity already writes an ADD audit entry
					result.invalidated++;
					result.added++;
				}
			}
		}
	});

	return result;
}
