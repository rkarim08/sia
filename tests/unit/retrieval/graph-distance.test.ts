import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SiaDb } from "@/graph/db-interface";
import { openGraphDb } from "@/graph/semantic-db";
import {
	computeGraphDistances,
	updateLandmarkCache,
} from "@/retrieval/graph-distance";

describe("graph distance cache", () => {
	let tmpDir: string;
	let db: SiaDb | undefined;

	function makeTmp(): string {
		const dir = join(tmpdir(), `sia-gd-test-${randomUUID()}`);
		mkdirSync(dir, { recursive: true });
		return dir;
	}

	afterEach(async () => {
		if (db) { await db.close(); db = undefined; }
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
});
