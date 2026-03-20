import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SiaDb } from "@/graph/db-interface";
import { openGraphDb } from "@/graph/semantic-db";
import { ProgressiveThrottle } from "@/retrieval/throttle";

describe("ProgressiveThrottle", () => {
	let tmpDir: string;
	let db: SiaDb;

	afterEach(async () => {
		if (db) await db.close();
		if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
	});

	function setup() {
		tmpDir = mkdtempSync(join(tmpdir(), "sia-throttle-test-"));
		db = openGraphDb(randomUUID(), tmpDir);
		return new ProgressiveThrottle(db);
	}

	it("first 3 calls are normal", async () => {
		const throttle = setup();
		for (let i = 0; i < 3; i++) {
			const result = await throttle.check("s1", "sia_search");
			expect(result.mode).toBe("normal");
		}
	});

	it("calls 4-8 are reduced", async () => {
		const throttle = setup();
		for (let i = 0; i < 3; i++) await throttle.check("s1", "sia_search");
		for (let i = 3; i < 8; i++) {
			const result = await throttle.check("s1", "sia_search");
			expect(result.mode).toBe("reduced");
			expect(result.warning).toBeDefined();
		}
	});

	it("calls 9+ are blocked", async () => {
		const throttle = setup();
		for (let i = 0; i < 8; i++) await throttle.check("s1", "sia_search");
		const result = await throttle.check("s1", "sia_search");
		expect(result.mode).toBe("blocked");
		expect(result.warning).toContain("sia_batch_execute");
	});

	it("different tools track independently", async () => {
		const throttle = setup();
		for (let i = 0; i < 5; i++) await throttle.check("s1", "sia_search");
		const result = await throttle.check("s1", "sia_execute");
		expect(result.mode).toBe("normal");
		expect(result.callCount).toBe(1);
	});

	it("reset clears all counters for session", async () => {
		const throttle = setup();
		for (let i = 0; i < 5; i++) await throttle.check("s1", "sia_search");
		await throttle.reset("s1");
		const result = await throttle.check("s1", "sia_search");
		expect(result.mode).toBe("normal");
		expect(result.callCount).toBe(1);
	});

	it("uses configurable thresholds", async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "sia-throttle-test-"));
		db = openGraphDb(randomUUID(), tmpDir);
		const throttle = new ProgressiveThrottle(db, { normalMax: 1, reducedMax: 2 });
		const r1 = await throttle.check("s1", "sia_search");
		expect(r1.mode).toBe("normal");
		const r2 = await throttle.check("s1", "sia_search");
		expect(r2.mode).toBe("reduced");
		const r3 = await throttle.check("s1", "sia_search");
		expect(r3.mode).toBe("blocked");
	});
});
