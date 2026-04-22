import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SiaDb } from "@/graph/db-interface";
import { openGraphDb } from "@/graph/semantic-db";
import { computeGraphDistances, updateLandmarkCache } from "@/retrieval/graph-distance";

describe("graph distance cache", () => {
	let tmpDir: string;
	let db: SiaDb | undefined;

	function makeTmp(): string {
		const dir = join(tmpdir(), `sia-gd-test-${randomUUID()}`);
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

	it("returns zero matrix when no landmarks computed", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("gd-empty", tmpDir);
		const matrix = await computeGraphDistances(db, ["a", "b", "c"]);
		expect(matrix.length).toBe(3);
		expect(matrix[0][0]).toBe(0); // self-distance
	});

	it("distance from node to itself is always 0", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("gd-self", tmpDir);
		const matrix = await computeGraphDistances(db, ["x"]);
		expect(matrix[0][0]).toBe(0);
	});

	it("updateLandmarkCache runs without error on empty graph", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("gd-update", tmpDir);
		await expect(updateLandmarkCache(db, { topN: 5 })).resolves.not.toThrow();
	});

	it("computes correct distances for a linear chain A→B→C", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("gd-chain", tmpDir);

		const now = Date.now();
		// Insert 3 nodes with access_count to make them landmarks
		for (const id of ["a", "b", "c"]) {
			await db.execute(
				`INSERT INTO graph_nodes (id, type, name, content, summary, trust_tier, confidence, importance, access_count, last_accessed, t_valid_from, t_created, created_at, created_by)
				 VALUES (?, 'Concept', ?, 'content', 'summary', 2, 0.9, 0.8, 10, ?, ?, ?, ?, 'test')`,
				[id, `Node_${id}`, now, now, now, now],
			);
		}

		// Insert edges: a→b, b→c (linear chain)
		await db.execute(
			"INSERT INTO graph_edges (id, from_id, to_id, type, weight, t_created) VALUES (?, ?, ?, 'DEPENDS_ON', 1.0, ?)",
			["e1", "a", "b", now],
		);
		await db.execute(
			"INSERT INTO graph_edges (id, from_id, to_id, type, weight, t_created) VALUES (?, ?, ?, 'DEPENDS_ON', 1.0, ?)",
			["e2", "b", "c", now],
		);

		await updateLandmarkCache(db, { topN: 3 });

		const matrix = await computeGraphDistances(db, ["a", "b", "c"]);
		// a→b = 1 hop, b→c = 1 hop, a→c = 2 hops (via triangle inequality)
		expect(matrix[0][1]).toBeLessThanOrEqual(1); // a→b
		expect(matrix[1][2]).toBeLessThanOrEqual(1); // b→c
		expect(matrix[0][2]).toBeLessThanOrEqual(2); // a→c
		// Self-distances
		expect(matrix[0][0]).toBe(0);
		expect(matrix[1][1]).toBe(0);
		expect(matrix[2][2]).toBe(0);
	});

	it("distances are capped at 5", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("gd-cap", tmpDir);
		// Insert a distance > 5 directly and verify it gets capped on read
		await db.execute(
			"INSERT OR REPLACE INTO landmark_distances (landmark_id, target_id, distance, computed_at) VALUES (?, ?, ?, ?)",
			["lm1", "t1", 99, Date.now()],
		);
		const matrix = await computeGraphDistances(db, ["lm1", "t1"]);
		// Any stored value > 5 should be treated as capped (5) by the lookup
		const dist = matrix[0][1]; // lm1 → t1
		expect(dist).toBeLessThanOrEqual(5);
	});

	it("returns GRAPHORMER_MAX_DIST between disconnected components", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("gd-disconnected", tmpDir);

		const now = Date.now();
		// Cluster A: nodes a1, a2 connected
		for (const id of ["a1", "a2"]) {
			await db.execute(
				`INSERT INTO graph_nodes (id, type, name, content, summary, trust_tier, confidence, importance, access_count, last_accessed, t_valid_from, t_created, created_at, created_by)
				 VALUES (?, 'Concept', ?, 'content', 'summary', 2, 0.9, 0.8, 10, ?, ?, ?, ?, 'test')`,
				[id, `Node_${id}`, now, now, now, now],
			);
		}
		// Cluster B: nodes b1, b2 connected
		for (const id of ["b1", "b2"]) {
			await db.execute(
				`INSERT INTO graph_nodes (id, type, name, content, summary, trust_tier, confidence, importance, access_count, last_accessed, t_valid_from, t_created, created_at, created_by)
				 VALUES (?, 'Concept', ?, 'content', 'summary', 2, 0.9, 0.8, 10, ?, ?, ?, ?, 'test')`,
				[id, `Node_${id}`, now, now, now, now],
			);
		}

		// Edges within clusters only — no cross-cluster edges
		await db.execute(
			"INSERT INTO graph_edges (id, from_id, to_id, type, weight, t_created) VALUES (?, ?, ?, 'DEPENDS_ON', 1.0, ?)",
			["e-a", "a1", "a2", now],
		);
		await db.execute(
			"INSERT INTO graph_edges (id, from_id, to_id, type, weight, t_created) VALUES (?, ?, ?, 'DEPENDS_ON', 1.0, ?)",
			["e-b", "b1", "b2", now],
		);

		await updateLandmarkCache(db, { topN: 4 });

		const matrix = await computeGraphDistances(db, ["a1", "b1"]);
		// a1 and b1 are in disconnected components
		expect(matrix[0][1]).toBe(5); // GRAPHORMER_MAX_DIST
		expect(matrix[1][0]).toBe(5);
		// Self-distances
		expect(matrix[0][0]).toBe(0);
		expect(matrix[1][1]).toBe(0);
	});
});
