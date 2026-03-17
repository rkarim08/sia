// Module: consolidation-sweep — maintenance dedup of similar entities

import { wordJaccard } from "@/capture/consolidate";
import type { BatchResult } from "@/decay/types";
import type { SiaDb } from "@/graph/db-interface";

interface ActiveEntity {
	id: string;
	type: string;
	name: string;
	content: string;
}

/**
 * Ensure canonical ordering: the smaller ID is always first.
 */
function canonicalPair(idA: string, idB: string): [string, string] {
	return idA < idB ? [idA, idB] : [idB, idA];
}

/**
 * Process a batch of entity pairs for deduplication.
 *
 * Finds active entity pairs of the same type that have not yet been checked,
 * computes word Jaccard similarity, and records a decision in local_dedup_log:
 *   - > 0.92  => 'merged'
 *   - > 0.5   => 'related'
 *   - else    => 'different'
 */
export async function consolidationSweepBatch(db: SiaDb, batchSize: number): Promise<BatchResult> {
	// 1. Fetch all active entities grouped by type, name
	const { rows } = await db.execute(
		`SELECT id, type, name, content FROM entities
		 WHERE t_valid_until IS NULL AND archived_at IS NULL
		 ORDER BY type, name`,
	);

	const entities = rows as unknown as ActiveEntity[];

	// 2. Group entities by type
	const byType = new Map<string, ActiveEntity[]>();
	for (const entity of entities) {
		let group = byType.get(entity.type);
		if (!group) {
			group = [];
			byType.set(entity.type, group);
		}
		group.push(entity);
	}

	// 3. Iterate pairs within each type group, up to batchSize
	let pairsProcessed = 0;

	for (const group of byType.values()) {
		if (pairsProcessed >= batchSize) break;

		for (let i = 0; i < group.length && pairsProcessed < batchSize; i++) {
			for (let j = i + 1; j < group.length && pairsProcessed < batchSize; j++) {
				const [aId, bId] = canonicalPair(group[i].id, group[j].id);

				// Check if this pair was already processed
				const existing = await db.execute(
					"SELECT 1 FROM local_dedup_log WHERE entity_a_id = ? AND entity_b_id = ?",
					[aId, bId],
				);

				if (existing.rows.length > 0) continue;

				// Compute similarity
				const similarity = wordJaccard(group[i].content, group[j].content);

				let decision: string;
				if (similarity > 0.92) {
					decision = "merged";
				} else if (similarity > 0.5) {
					decision = "related";
				} else {
					decision = "different";
				}

				const now = Date.now();
				await db.execute(
					"INSERT INTO local_dedup_log (entity_a_id, entity_b_id, decision, checked_at) VALUES (?, ?, ?, ?)",
					[aId, bId, decision, now],
				);

				pairsProcessed++;
			}
		}
	}

	return { processed: pairsProcessed, remaining: pairsProcessed === batchSize };
}

/**
 * Run the full consolidation sweep across all entity pairs.
 * Processes in batches of 50 until no work remains.
 * Returns the total number of pairs processed.
 */
export async function runConsolidationSweep(db: SiaDb): Promise<number> {
	const BATCH_SIZE = 50;
	let total = 0;
	let remaining = true;

	while (remaining) {
		const result = await consolidationSweepBatch(db, BATCH_SIZE);
		total += result.processed;
		remaining = result.remaining;
	}

	return total;
}
