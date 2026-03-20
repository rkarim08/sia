// Module: session-sweeper — session-end focused dedup of current session's entities

import { wordJaccard } from "@/capture/consolidate";
import type { SiaDb } from "@/graph/db-interface";

/**
 * Targeted sweep of entities created during a specific session.
 *
 * On SessionEnd, deduplicates the session's output against the existing graph:
 * 1. Query entities where source_episode = sessionId
 * 2. For each, check local_dedup_log for existing pairs
 * 3. Compare against same-type active entities (word Jaccard > 0.92)
 * 4. Write results to local_dedup_log
 *
 * Typically completes in < 2s for a session's worth of entities (5-20).
 */
export async function sweepSession(db: SiaDb, sessionId: string): Promise<number> {
	const { rows: sessionEntities } = await db.execute(
		`SELECT id, type, content FROM graph_nodes
		 WHERE source_episode = ?
		   AND t_valid_until IS NULL
		   AND archived_at IS NULL`,
		[sessionId],
	);

	if (sessionEntities.length === 0) return 0;

	let pairsProcessed = 0;
	const now = Date.now();

	for (const entity of sessionEntities) {
		const entityId = entity.id as string;
		const entityType = entity.type as string;
		const entityContent = entity.content as string;

		// Find same-type active entities (excluding self)
		const { rows: candidates } = await db.execute(
			`SELECT id, content FROM graph_nodes
			 WHERE type = ?
			   AND id != ?
			   AND t_valid_until IS NULL
			   AND archived_at IS NULL`,
			[entityType, entityId],
		);

		for (const candidate of candidates) {
			const candidateId = candidate.id as string;

			// Canonical pair ordering
			const [aId, bId] = entityId < candidateId ? [entityId, candidateId] : [candidateId, entityId];

			// Skip if already checked
			const existing = await db.execute(
				"SELECT 1 FROM local_dedup_log WHERE entity_a_id = ? AND entity_b_id = ?",
				[aId, bId],
			);
			if (existing.rows.length > 0) continue;

			const similarity = wordJaccard(entityContent, candidate.content as string);

			let decision: string;
			if (similarity > 0.92) {
				decision = "merged";
			} else if (similarity > 0.5) {
				decision = "related";
			} else {
				decision = "different";
			}

			await db.execute(
				"INSERT INTO local_dedup_log (entity_a_id, entity_b_id, decision, checked_at) VALUES (?, ?, ?, ?)",
				[aId, bId, decision, now],
			);
			pairsProcessed++;
		}
	}

	return pairsProcessed;
}
