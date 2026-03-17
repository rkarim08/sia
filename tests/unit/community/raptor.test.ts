import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { detectCommunities } from "@/community/leiden";
import { buildSummaryTree } from "@/community/raptor";
import { summarizeCommunities } from "@/community/summarize";
import type { SiaDb } from "@/graph/db-interface";
import { insertEdge } from "@/graph/edges";
import { insertEntity } from "@/graph/entities";
import { openGraphDb } from "@/graph/semantic-db";

function createDb() {
	const dir = mkdtempSync(join(tmpdir(), "sia-raptor-"));
	return openGraphDb("raptor-repo", dir);
}

async function seedGraph(db: SiaDb) {
	const ids: string[] = [];
	for (let i = 0; i < 4; i++) {
		const entity = await insertEntity(db, {
			type: "Function",
			name: `entity-${i}`,
			content: `content-${i}`,
			summary: `summary-${i}`,
		});
		ids.push(entity.id);
	}
	for (let i = 0; i < ids.length - 1; i++) {
		await insertEdge(db, { from_id: ids[i], to_id: ids[i + 1], type: "calls", weight: 1 });
	}
	return ids;
}

describe("buildSummaryTree", () => {
	it("populates all levels and expires invalidated entity summaries", async () => {
		const db = createDb();
		const ids = await seedGraph(db);

		await detectCommunities(db);
		await summarizeCommunities(db, { airGapped: false });
		await buildSummaryTree(db);

		const counts = await db.execute(
			"SELECT level, COUNT(*) as count FROM summary_tree GROUP BY level ORDER BY level",
		);
		const countMap = new Map<number, number>(
			(counts.rows as Array<{ level: number; count: number }>).map((r) => [r.level, r.count]),
		);
		expect(countMap.get(0)).toBe(ids.length);
		expect(countMap.get(1)).toBe(ids.length);
		expect((countMap.get(2) ?? 0) > 0).toBe(true);
		expect((countMap.get(3) ?? 0) > 0).toBe(true);

		await db.execute("UPDATE entities SET t_valid_until = ? WHERE id = ?", [Date.now(), ids[0]]);
		await buildSummaryTree(db);
		const expired = await db.execute("SELECT expires_at FROM summary_tree WHERE id = ?", [
			`lvl1:${ids[0]}`,
		]);
		expect((expired.rows[0] as { expires_at: number | null }).expires_at).not.toBeNull();

		await db.close();
	});
});
