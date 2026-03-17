// Module: decay — importance decay batch processing

import type { BatchResult, DecayResult } from "@/decay/types";
import type { SiaDb } from "@/graph/db-interface";
import type { Entity } from "@/graph/entities";
import { updateEntity } from "@/graph/entities";
import type { DecayHalfLife, SiaConfig } from "@/shared/config";

export type { BatchResult, DecayResult };

const BATCH_SIZE = 500;
const MS_PER_DAY = 86_400_000;

/**
 * Compute decayed importance for a single entity.
 *
 * Formula:
 *   daysSinceAccess = (now - entity.last_accessed) / 86400000
 *   halfLife = config.decayHalfLife[entity.type] ?? config.decayHalfLife.default
 *   decayFactor = 0.5 ^ (daysSinceAccess / halfLife)
 *   edgeBoost = min(entity.edge_count * 0.02, 0.3)
 *   newImportance = max(entity.base_importance * decayFactor + edgeBoost, 0.01)
 *
 * Highly-connected entities (edge_count > 20) never drop below 0.25.
 */
function computeDecayedImportance(entity: Entity, config: SiaConfig, now: number): number {
	const daysSinceAccess = (now - entity.last_accessed) / MS_PER_DAY;
	const halfLife =
		config.decayHalfLife[entity.type as keyof DecayHalfLife] ?? config.decayHalfLife.default;
	const decayFactor = 0.5 ** (daysSinceAccess / halfLife);
	const edgeBoost = Math.min(entity.edge_count * 0.02, 0.3);

	let newImportance = Math.max(entity.base_importance * decayFactor + edgeBoost, 0.01);

	// Highly-connected entities never drop below 0.25
	if (entity.edge_count > 20 && newImportance < 0.25) {
		newImportance = 0.25;
	}

	return newImportance;
}

/**
 * Process a single batch of entities for importance decay.
 *
 * Queries active, non-invalidated entities ordered by least-recently accessed,
 * applies the decay formula, and updates each entity's importance. Entities
 * whose importance falls below `config.archiveThreshold` are archived.
 */
export async function decayBatch(
	db: SiaDb,
	config: SiaConfig,
	batchSize: number,
	offset: number,
): Promise<BatchResult> {
	const result = await db.execute(
		`SELECT * FROM entities
		 WHERE archived_at IS NULL AND t_valid_until IS NULL
		 ORDER BY last_accessed ASC
		 LIMIT ? OFFSET ?`,
		[batchSize, offset],
	);

	const entities = result.rows as Entity[];
	const now = Date.now();

	for (const entity of entities) {
		const newImportance = computeDecayedImportance(entity, config, now);
		await updateEntity(db, entity.id, { importance: newImportance });
	}

	return {
		processed: entities.length,
		remaining: entities.length === batchSize,
	};
}

/**
 * Run importance decay across all active entities.
 *
 * Iterates through the full set in batches of 500, applying `decayBatch`
 * to each page. Returns the total number of entities processed and the
 * wall-clock duration.
 */
export async function decayImportance(db: SiaDb, config: SiaConfig): Promise<DecayResult> {
	const start = Date.now();
	let total = 0;
	let offset = 0;
	let hasMore = true;

	while (hasMore) {
		const batch = await decayBatch(db, config, BATCH_SIZE, offset);
		total += batch.processed;
		hasMore = batch.remaining;
		offset += BATCH_SIZE;
	}

	return {
		processed: total,
		durationMs: Date.now() - start,
	};
}
