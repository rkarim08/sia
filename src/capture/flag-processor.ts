// Module: flag-processor — Converts unconsumed session flags into graph entities

import { consolidate } from "@/capture/consolidate";
import type { CandidateFact } from "@/capture/types";
import type { SiaDb } from "@/graph/db-interface";
import { updateEntity } from "@/graph/entities";
import { getUnconsumedFlags, markFlagConsumed } from "@/graph/flags";
import type { SiaConfig } from "@/shared/config";

const DEFAULT_BASE_IMPORTANCE = 0.5;

/**
 * Process all unconsumed session flags for the given session.
 *
 * For each flag:
 * 1. Build a CandidateFact of type "Concept" from the flag reason.
 * 2. Apply the configured flaggedConfidenceThreshold and flaggedImportanceBoost.
 * 3. Run the candidate through the consolidation pipeline.
 * 4. Mark the flag as consumed.
 *
 * Returns the number of flags processed (0 when flagging is disabled).
 */
export async function processFlags(
	db: SiaDb,
	sessionId: string,
	config: SiaConfig,
): Promise<number> {
	if (!config.enableFlagging) return 0;

	const flags = await getUnconsumedFlags(db, sessionId);

	for (const flag of flags) {
		const candidate: CandidateFact = {
			type: "Concept",
			name: flag.reason.slice(0, 50),
			content: flag.reason,
			summary: flag.reason.slice(0, 80),
			tags: ["session-flag"],
			file_paths: [],
			trust_tier: 1,
			confidence: config.flaggedConfidenceThreshold,
		};

		await consolidate(db, [candidate]);

		// Apply the importance boost to the entity just created/updated
		const boostedImportance = DEFAULT_BASE_IMPORTANCE + config.flaggedImportanceBoost;
		const result = await db.execute(
			"SELECT id FROM entities WHERE name = ? AND type = 'Concept' AND t_valid_until IS NULL AND archived_at IS NULL",
			[candidate.name],
		);
		const row = result.rows[0] as { id: string } | undefined;
		if (row) {
			await updateEntity(db, row.id, {
				base_importance: boostedImportance,
				importance: boostedImportance,
			});
		}

		await markFlagConsumed(db, flag.id);
	}

	return flags.length;
}
