// Module: scheduler — decides when to run community detection

import { detectCommunities } from "@/community/leiden";
import { buildSummaryTree } from "@/community/raptor";
import { summarizeCommunities } from "@/community/summarize";
import type { SiaDb } from "@/graph/db-interface";
import type { SiaConfig } from "@/shared/config";
import type { LlmClient } from "@/shared/llm-client";

async function countActiveEntities(db: SiaDb): Promise<number> {
	const result = await db.execute(
		`SELECT COUNT(*) as count
		 FROM graph_nodes
		 WHERE t_valid_until IS NULL AND archived_at IS NULL`,
	);
	return Number((result.rows[0] as { count: number }).count ?? 0);
}

async function lastRunAt(db: SiaDb): Promise<number> {
	const result = await db.execute("SELECT MAX(updated_at) as ts FROM communities");
	const ts = (result.rows[0] as { ts: number | null }).ts;
	return typeof ts === "number" ? ts : 0;
}

async function newEntitiesSince(db: SiaDb, since: number): Promise<number> {
	const result = await db.execute(
		`SELECT COUNT(*) as count
		 FROM graph_nodes
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
		console.warn(
			`Graph has fewer than ${config.communityMinGraphSize} entities (${totalEntities}) — skipping community detection`,
		);
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
		private readonly llmClient?: LlmClient,
	) {}

	async check(): Promise<boolean> {
		return shouldRunDetection(this.db, this.config);
	}

	async run(): Promise<void> {
		const shouldRun = await this.check();
		if (!shouldRun) return;

		await detectCommunities(this.db);
		await summarizeCommunities(this.db, { airGapped: this.config.airGapped }, this.llmClient);
		await buildSummaryTree(this.db, this.llmClient);
	}

	runInBackground(): void {
		void this.run().catch((err) => console.error("Community detection failed:", err));
	}
}
