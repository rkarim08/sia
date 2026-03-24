import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { formatHealth, getGraphHealth } from "@/cli/commands/status";
import type { SiaDb } from "@/graph/db-interface";
import { insertEdge } from "@/graph/edges";
import { insertEntity } from "@/graph/entities";
import { openGraphDb } from "@/graph/semantic-db";

function makeTmp(): string {
	const dir = join(tmpdir(), `sia-test-${randomUUID()}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

describe("status — getGraphHealth", () => {
	let tmpDir: string;
	let db: SiaDb | undefined;

	afterEach(async () => {
		if (db) {
			await db.close();
			db = undefined;
		}
		if (tmpDir) {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("should return correct totalEntities count", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("status-total", tmpDir);

		await insertEntity(db, { type: "CodeEntity", name: "fn1", content: "c", summary: "s" });
		await insertEntity(db, { type: "Decision", name: "d1", content: "c", summary: "s" });
		await insertEntity(db, { type: "Bug", name: "b1", content: "c", summary: "s" });

		const health = await getGraphHealth(db);
		expect(health.totalEntities).toBe(3);
	});

	it("should group entities by type", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("status-by-type", tmpDir);

		await insertEntity(db, { type: "CodeEntity", name: "fn1", content: "c", summary: "s" });
		await insertEntity(db, { type: "CodeEntity", name: "fn2", content: "c", summary: "s" });
		await insertEntity(db, { type: "Decision", name: "d1", content: "c", summary: "s" });

		const health = await getGraphHealth(db);
		expect(health.byType).toEqual({ CodeEntity: 2, Decision: 1 });
	});

	it("should group entities by tier", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("status-by-tier", tmpDir);

		await insertEntity(db, { type: "CodeEntity", name: "t2a", content: "c", summary: "s", trust_tier: 2 });
		await insertEntity(db, { type: "CodeEntity", name: "t2b", content: "c", summary: "s", trust_tier: 2 });
		await insertEntity(db, { type: "Decision", name: "t1", content: "c", summary: "s", trust_tier: 1 });

		const health = await getGraphHealth(db);
		expect(health.byTier).toEqual({ 1: 1, 2: 2 });
	});

	it("should count conflict groups", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("status-conflicts", tmpDir);

		const groupId = randomUUID();
		await insertEntity(db, {
			type: "Decision",
			name: "conflict-a",
			content: "c",
			summary: "s",
		});
		// Manually set conflict_group_id
		await db.execute(
			"UPDATE graph_nodes SET conflict_group_id = ? WHERE name = ?",
			[groupId, "conflict-a"],
		);
		await insertEntity(db, {
			type: "Decision",
			name: "conflict-b",
			content: "c",
			summary: "s",
		});
		await db.execute(
			"UPDATE graph_nodes SET conflict_group_id = ? WHERE name = ?",
			[groupId, "conflict-b"],
		);

		const health = await getGraphHealth(db);
		expect(health.conflictGroups).toBe(1);
	});

	it("should count total edges", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("status-edges", tmpDir);

		const e1 = await insertEntity(db, { type: "CodeEntity", name: "a", content: "c", summary: "s" });
		const e2 = await insertEntity(db, { type: "CodeEntity", name: "b", content: "c", summary: "s" });
		await insertEdge(db, { from_id: e1.id, to_id: e2.id, type: "relates_to" });

		const health = await getGraphHealth(db);
		expect(health.totalEdges).toBe(1);
	});

	it("should return zero counts on empty database", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("status-empty", tmpDir);

		const health = await getGraphHealth(db);
		expect(health.totalEntities).toBe(0);
		expect(health.totalEdges).toBe(0);
		expect(health.totalCommunities).toBe(0);
		expect(health.conflictGroups).toBe(0);
		expect(health.byType).toEqual({});
		expect(health.byTier).toEqual({});
	});
});

describe("status — formatHealth", () => {
	it("should produce formatted terminal output", () => {
		const output = formatHealth({
			totalEntities: 342,
			totalEdges: 891,
			totalCommunities: 5,
			byType: { CodeEntity: 280, Decision: 25, Convention: 18, Bug: 12, Solution: 7 },
			byTier: { 1: 43, 2: 280, 3: 19 },
			byKind: {},
			conflictGroups: 1,
			archivedEntities: 10,
			recentEntities24h: 23,
			oldestEntity: "2026-01-01T00:00:00.000Z",
			newestEntity: "2026-03-24T00:00:00.000Z",
		});

		expect(output).toContain("SIA Knowledge Graph Health");
		expect(output).toContain("342");
		expect(output).toContain("891");
		expect(output).toContain("CodeEntity");
		expect(output).toContain("Tier 1");
		expect(output).toContain("Tier 2");
	});
});
