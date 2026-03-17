import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { detectCommunities } from "@/community/leiden";
import { insertEdge } from "@/graph/edges";
import { insertEntity } from "@/graph/entities";
import { openGraphDb } from "@/graph/semantic-db";

function createDb() {
	const dir = mkdtempSync(join(tmpdir(), "sia-community-"));
	return openGraphDb("test-repo", dir);
}

describe("detectCommunities", () => {
	it("creates multi-level communities from active edges", async () => {
		const db = createDb();
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

		await db.close();
	});
});
