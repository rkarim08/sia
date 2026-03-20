// Module: archiver — soft-archive decayed entities

import type { BatchResult } from "@/decay/types";
import type { SiaDb } from "@/graph/db-interface";
import { archiveEntity } from "@/graph/entities";
import type { SiaConfig } from "@/shared/config";

/** Default batch size for archiveDecayedEntities loop. */
const DEFAULT_BATCH_SIZE = 50;

/** Inactivity window: 90 days in milliseconds. */
const INACTIVE_DAYS_MS = 90 * 86400000;

/**
 * Archive a single batch of decayed entities.
 *
 * Selects entities matching ALL conditions:
 * - importance below config.archiveThreshold (default 0.05)
 * - zero edges (isolated node)
 * - not accessed in 90 days
 * - not bi-temporally invalidated (t_valid_until IS NULL)
 * - not already archived (archived_at IS NULL)
 *
 * For each matched entity, calls archiveEntity which sets archived_at ONLY
 * (never t_valid_until or t_expired).
 */
export async function archiveBatch(
	db: SiaDb,
	config: SiaConfig,
	batchSize: number,
): Promise<BatchResult> {
	const cutoff = Date.now() - INACTIVE_DAYS_MS;

	const { rows } = await db.execute(
		`SELECT id FROM graph_nodes
		 WHERE importance < ?
		   AND edge_count = 0
		   AND last_accessed < ?
		   AND t_valid_until IS NULL
		   AND archived_at IS NULL
		 ORDER BY importance ASC
		 LIMIT ?`,
		[config.archiveThreshold, cutoff, batchSize],
	);

	for (const row of rows) {
		await archiveEntity(db, row.id as string);
	}

	const processed = rows.length;
	return { processed, remaining: processed === batchSize };
}

/**
 * Archive all decayed entities across the entire graph.
 *
 * Repeatedly calls archiveBatch in batches of 50 until no more
 * archivable entities remain.
 *
 * Returns the total number of entities archived.
 */
export async function archiveDecayedEntities(db: SiaDb, config: SiaConfig): Promise<number> {
	let total = 0;
	let hasMore = true;

	while (hasMore) {
		const result = await archiveBatch(db, config, DEFAULT_BATCH_SIZE);
		total += result.processed;
		hasMore = result.remaining;
	}

	return total;
}
