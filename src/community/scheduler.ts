// Module: scheduler — decides when to run community detection

import { detectCommunities } from "@/community/leiden";
import { buildSummaryTree } from "@/community/raptor";
import { summarizeCommunities } from "@/community/summarize";
import type { SiaDb } from "@/graph/db-interface";
import type { SiaConfig } from "@/shared/config";

async function countActiveEntities(db: SiaDb): Promise<number> {
	const result = await db.execute(
		`SELECT COUNT(*) as count
                 FROM entities
                 WHERE t_valid_until IS NULL AND archived_at IS NULL`,
	);
	return Number((result.rows[0] as { count: number }).count ?? 0);
}

async function lastRunAt(db: SiaDb): Promise<number> {
	const result = await db.execute(`SELECT MAX(updated_at) as ts FROM communities`);
	const ts = (result.rows[0] as { ts: number | null }).ts;
	return typeof ts === "number" ? ts : 0;
}

async function newEntitiesSince(db: SiaDb, since: number): Promise<number> {
	const result = await db.execute(
		`SELECT COUNT(*) as count
                 FROM entities
                 WHERE t_valid_until IS NULL
                   AND archived_at IS NULL
                   AND (created_at > ? OR t_created > ?)`,
		[since, since],
	);
	return Number((result.rows[0] as { count: number }).count ?? 0);
}

export async function shouldRunDetection(db: SiaDb, config: SiaConfig): Promise<boolean> {
	const totalEntities = await countActiveEntities(db);
	if (totalEntities < config.communityMinGraphSize) {
		return false;
	}

	const lastRun = await lastRunAt(db);
	const fresh = await newEntitiesSince(db, lastRun);
	return fresh > config.communityTriggerNodeCount;
}

export class CommunityScheduler {
	constructor(
		private readonly db: SiaDb,
		private readonly config: SiaConfig,
	) {}

	async check(): Promise<boolean> {
		return shouldRunDetection(this.db, this.config);
	}

	async run(): Promise<void> {
		const shouldRun = await this.check();
		if (!shouldRun) return;

		await detectCommunities(this.db);
		await summarizeCommunities(this.db, { airGapped: this.config.airGapped });
		await buildSummaryTree(this.db);
	}
}
