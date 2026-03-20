import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SiaDb } from "@/graph/db-interface";
import { openGraphDb } from "@/graph/semantic-db";
import { ProgressiveThrottle } from "@/retrieval/throttle";

describe("ProgressiveThrottle", () => {
	let tmpDir: string;
	let db: SiaDb | undefined;

	function makeTmp(): string {
		const dir = join(tmpdir(), `sia-throttle-test-${randomUUID()}`);
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

	const defaultConfig = { normalMax: 3, reducedMax: 8, blockedMax: 9 };

	it("3rd call returns normal mode (with normalMax=3)", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("throttle-test-1", tmpDir);
		const throttle = new ProgressiveThrottle(db, defaultConfig);
		const sessionId = randomUUID();

		await throttle.check(sessionId, "sia_search");
		await throttle.check(sessionId, "sia_search");
		const result = await throttle.check(sessionId, "sia_search");

		expect(result.mode).toBe("normal");
		expect(result.callCount).toBe(3);
		expect(result.warning).toBeUndefined();
	});

	it("4th call returns reduced mode (above normalMax=3)", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("throttle-test-2", tmpDir);
		const throttle = new ProgressiveThrottle(db, defaultConfig);
		const sessionId = randomUUID();

		for (let i = 0; i < 3; i++) {
			await throttle.check(sessionId, "sia_search");
		}
		const result = await throttle.check(sessionId, "sia_search");

		expect(result.mode).toBe("reduced");
		expect(result.callCount).toBe(4);
		expect(result.warning).toBeDefined();
	});

	it("5th call returns reduced with warning", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("throttle-test-3", tmpDir);
		const throttle = new ProgressiveThrottle(db, defaultConfig);
		const sessionId = randomUUID();

		for (let i = 0; i < 4; i++) {
			await throttle.check(sessionId, "sia_search");
		}
		const result = await throttle.check(sessionId, "sia_search");

		expect(result.mode).toBe("reduced");
		expect(result.callCount).toBe(5);
		expect(result.warning).toMatch(/5 times/);
	});

	it("10th call returns blocked with warning", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("throttle-test-4", tmpDir);
		const throttle = new ProgressiveThrottle(db, defaultConfig);
		const sessionId = randomUUID();

		for (let i = 0; i < 9; i++) {
			await throttle.check(sessionId, "sia_search");
		}
		const result = await throttle.check(sessionId, "sia_search");

		expect(result.mode).toBe("blocked");
		expect(result.callCount).toBe(10);
		expect(result.warning).toBeDefined();
	});

	it("reset clears counts so next call returns normal", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("throttle-test-5", tmpDir);
		const throttle = new ProgressiveThrottle(db, defaultConfig);
		const sessionId = randomUUID();

		// Exhaust into blocked territory
		for (let i = 0; i < 10; i++) {
			await throttle.check(sessionId, "sia_search");
		}
		const blockedResult = await throttle.check(sessionId, "sia_search");
		expect(blockedResult.mode).toBe("blocked");

		// Reset and check again
		await throttle.reset(sessionId);
		const afterReset = await throttle.check(sessionId, "sia_search");
		expect(afterReset.mode).toBe("normal");
		expect(afterReset.callCount).toBe(1);
	});

	it("different tools have independent counters", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("throttle-test-6", tmpDir);
		const throttle = new ProgressiveThrottle(db, defaultConfig);
		const sessionId = randomUUID();

		// Exhaust sia_search
		for (let i = 0; i < 10; i++) {
			await throttle.check(sessionId, "sia_search");
		}

		// sia_graph should start fresh
		const result = await throttle.check(sessionId, "sia_graph");
		expect(result.mode).toBe("normal");
		expect(result.callCount).toBe(1);
	});

	it("different sessions have independent counters", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("throttle-test-7", tmpDir);
		const throttle = new ProgressiveThrottle(db, defaultConfig);
		const session1 = randomUUID();
		const session2 = randomUUID();

		for (let i = 0; i < 10; i++) {
			await throttle.check(session1, "sia_search");
		}

		const result = await throttle.check(session2, "sia_search");
		expect(result.mode).toBe("normal");
		expect(result.callCount).toBe(1);
	});

	it("reset only clears the specified session", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("throttle-test-8", tmpDir);
		const throttle = new ProgressiveThrottle(db, defaultConfig);
		const session1 = randomUUID();
		const session2 = randomUUID();

		for (let i = 0; i < 5; i++) {
			await throttle.check(session1, "sia_search");
			await throttle.check(session2, "sia_search");
		}

		await throttle.reset(session1);

		const s1Result = await throttle.check(session1, "sia_search");
		expect(s1Result.callCount).toBe(1);

		const s2Result = await throttle.check(session2, "sia_search");
		expect(s2Result.callCount).toBe(6);
	});
});
