import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SiaDb } from "@/graph/db-interface";
import { insertEntity } from "@/graph/entities";
import { openGraphDb } from "@/graph/semantic-db";
import {
	TASK_TYPE_BOOSTS,
	classifyQuery,
	packagePathBoost,
} from "@/retrieval/query-classifier";

describe("query-classifier", () => {
	let tmpDir: string;
	let db: SiaDb | undefined;

	function makeTmp(): string {
		const dir = join(tmpdir(), `sia-qc-test-${randomUUID()}`);
		mkdirSync(dir, { recursive: true });
		return dir;
	}

	afterEach(async () => {
		if (db) {
			await db.close();
			db = undefined;
		}
		if (tmpDir) {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it('"explain the architecture" → global mode', async () => {
		tmpDir = makeTmp();
		db = openGraphDb(randomUUID(), tmpDir);

		// Insert 150 entities to pass the min graph size threshold
		for (let i = 0; i < 150; i++) {
			await insertEntity(db, {
				type: "Concept",
				name: `Entity-${i}`,
				content: "content",
				summary: "summary",
			});
		}

		const result = await classifyQuery(db, "explain the architecture", {
			communityMinGraphSize: 100,
		});

		expect(result.mode).toBe("global");
		expect(result.globalUnavailable).toBe(false);
	});

	it('"how does TokenStore.validate work" → local mode', async () => {
		tmpDir = makeTmp();
		db = openGraphDb(randomUUID(), tmpDir);

		const result = await classifyQuery(db, "how does TokenStore.validate work", {
			communityMinGraphSize: 100,
		});

		expect(result.mode).toBe("local");
		expect(result.globalUnavailable).toBe(false);
	});

	it("graph < 100 entities → local with globalUnavailable: true", async () => {
		tmpDir = makeTmp();
		db = openGraphDb(randomUUID(), tmpDir);

		// Insert only 50 entities (below the 100 threshold)
		for (let i = 0; i < 50; i++) {
			await insertEntity(db, {
				type: "Concept",
				name: `SmallEntity-${i}`,
				content: "content",
				summary: "summary",
			});
		}

		// Use a global-leaning query
		const result = await classifyQuery(db, "explain the architecture overview", {
			communityMinGraphSize: 100,
		});

		expect(result.mode).toBe("local");
		expect(result.globalUnavailable).toBe(true);
	});

	it("ambiguous query defaults to local", async () => {
		tmpDir = makeTmp();
		db = openGraphDb(randomUUID(), tmpDir);

		// A query with no keywords from either list
		const result = await classifyQuery(db, "tell me about the project", {
			communityMinGraphSize: 100,
		});

		expect(result.mode).toBe("local");
		expect(result.globalUnavailable).toBe(false);
	});

	it("TASK_TYPE_BOOSTS: bug-fix has Bug, feature has Concept", () => {
		expect(TASK_TYPE_BOOSTS["bug-fix"]).toBeDefined();
		expect(TASK_TYPE_BOOSTS["bug-fix"].has("Bug")).toBe(true);
		expect(TASK_TYPE_BOOSTS["bug-fix"].has("Solution")).toBe(true);

		// regression is an alias for bug-fix
		expect(TASK_TYPE_BOOSTS.regression).toBeDefined();
		expect(TASK_TYPE_BOOSTS.regression.has("Bug")).toBe(true);
		expect(TASK_TYPE_BOOSTS.regression.has("Solution")).toBe(true);

		expect(TASK_TYPE_BOOSTS.feature).toBeDefined();
		expect(TASK_TYPE_BOOSTS.feature.has("Concept")).toBe(true);
		expect(TASK_TYPE_BOOSTS.feature.has("Decision")).toBe(true);

		expect(TASK_TYPE_BOOSTS.review).toBeDefined();
		expect(TASK_TYPE_BOOSTS.review.has("Convention")).toBe(true);
	});

	it("packagePathBoost: matching returns 0.15, non-matching returns 0", () => {
		expect(packagePathBoost("src/auth", "src/auth")).toBe(0.15);
		expect(packagePathBoost("src/auth", "src/db")).toBe(0);
		expect(packagePathBoost(null, "src/auth")).toBe(0);
		expect(packagePathBoost("src/auth", null)).toBe(0);
		expect(packagePathBoost(null, null)).toBe(0);
	});
});
