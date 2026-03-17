import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { detectCommunities } from "@/community/leiden";
import type { SiaDb } from "@/graph/db-interface";
import { insertEdge } from "@/graph/edges";
import { insertEntity } from "@/graph/entities";
import { openGraphDb } from "@/graph/semantic-db";

describe("detectCommunities", () => {
	let tmpDir: string;
	let db: SiaDb | undefined;

	function makeTmp(): string {
		const dir = join(tmpdir(), `sia-test-${randomUUID()}`);
		mkdirSync(dir, { recursive: true });
		return dir;
	}

	afterEach(async () => {
		if (db) {
			await db.close();
			db = undefined;
		}
		if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
	});

	it("creates multi-level communities from active edges", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("test-repo", tmpDir);
		const clusters: Array<{ pkg: string; ids: string[] }> = [
			{ pkg: "pkg/a", ids: [] },
			{ pkg: "pkg/b", ids: [] },
			{ pkg: "pkg/c", ids: [] },
		];

		// Seed 21 entities across three clusters with strong intra-cluster edges.
		for (const cluster of clusters) {
			for (let i = 0; i < 7; i++) {
				const entity = await insertEntity(db, {
					type: "Function",
					name: `${cluster.pkg}-entity-${i}`,
					content: `content-${cluster.pkg}-${i}`,
					summary: `summary-${cluster.pkg}-${i}`,
					package_path: cluster.pkg,
				});
				cluster.ids.push(entity.id);
			}
			for (let i = 0; i < cluster.ids.length - 1; i++) {
				await insertEdge(db, {
					from_id: cluster.ids[i],
					to_id: cluster.ids[i + 1],
					type: "calls",
					weight: 1,
				});
			}
		}

		const result = await detectCommunities(db);

		expect(result.levels.length).toBe(3);
		expect(result.levels[1]).toBeGreaterThanOrEqual(3);

		const communities = await db.execute("SELECT COUNT(*) as count FROM communities");
		expect(Number((communities.rows[0] as { count: number }).count)).toBeGreaterThan(0);

		const members = await db.execute("SELECT COUNT(*) as count FROM community_members");
		expect(Number((members.rows[0] as { count: number }).count)).toBeGreaterThanOrEqual(
			clusters.reduce((sum, c) => sum + c.ids.length, 0),
		);

		// Verify that entities in cluster A are grouped into Level 0 communities
		// (fewer distinct communities than entities, showing real clustering)
		const placeholders = clusters[0].ids.map(() => "?").join(",");
		const clusterAMembers = await db.execute(
			`SELECT cm.entity_id, cm.community_id
			 FROM community_members cm
			 WHERE cm.entity_id IN (${placeholders})
			   AND cm.level = 0`,
			clusters[0].ids,
		);
		const entityToCommunity = new Map<string, string>();
		for (const row of clusterAMembers.rows) {
			const r = row as { entity_id: string; community_id: string };
			entityToCommunity.set(r.entity_id, r.community_id);
		}
		// All cluster A entities should have a Level 0 community assignment
		expect(entityToCommunity.size).toBe(clusters[0].ids.length);
		// The number of distinct communities should be less than the number of entities
		const distinctCommunities = new Set(entityToCommunity.values());
		expect(distinctCommunities.size).toBeLessThan(clusters[0].ids.length);
		// At least one pair of adjacent entities in the chain should share a community
		let sharedCount = 0;
		for (let i = 0; i < clusters[0].ids.length - 1; i++) {
			if (
				entityToCommunity.get(clusters[0].ids[i]) === entityToCommunity.get(clusters[0].ids[i + 1])
			) {
				sharedCount++;
			}
		}
		expect(sharedCount).toBeGreaterThan(0);
	});
});
