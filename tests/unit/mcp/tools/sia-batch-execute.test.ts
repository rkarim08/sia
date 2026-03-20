// tests/unit/mcp/tools/sia-batch-execute.test.ts

import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Embedder } from "@/capture/embedder";
import type { SiaDb } from "@/graph/db-interface";
import { openGraphDb } from "@/graph/semantic-db";
import { handleSiaBatchExecute } from "@/mcp/tools/sia-batch-execute";
import { ProgressiveThrottle } from "@/retrieval/throttle";

function makeMockEmbedder(): Embedder {
	return { embed: vi.fn(async () => new Float32Array(384)), close: vi.fn() };
}

describe("handleSiaBatchExecute", () => {
	let tmpDir: string;
	let db: SiaDb;

	afterEach(async () => {
		if (db) await db.close();
		if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
	});

	function setup() {
		tmpDir = mkdtempSync(join(tmpdir(), "sia-batch-exec-test-"));
		db = openGraphDb(randomUUID(), tmpDir);
		return {
			embedder: makeMockEmbedder(),
			throttle: new ProgressiveThrottle(db),
			sessionId: "test-session",
		};
	}

	it("executes multiple operations and returns results array", async () => {
		const deps = setup();
		const result = await handleSiaBatchExecute(
			db,
			{
				operations: [
					{ type: "execute", code: 'echo "hello"', language: "bash" },
					{ type: "execute", code: 'echo "world"', language: "bash" },
				],
			},
			deps.embedder,
			deps.throttle,
			deps.sessionId,
		);

		expect(result.error).toBeUndefined();
		expect(result.results).toHaveLength(2);
		expect(result.results[0].stdout?.trim()).toBe("hello");
		expect(result.results[1].stdout?.trim()).toBe("world");
		expect(result.eventNodeIds).toHaveLength(2);
	});

	it("rejects batch exceeding 20 operations", async () => {
		const deps = setup();
		const operations = Array.from({ length: 21 }, (_, i) => ({
			type: "execute" as const,
			code: `echo "op ${i}"`,
			language: "bash",
		}));

		const result = await handleSiaBatchExecute(
			db,
			{ operations },
			deps.embedder,
			deps.throttle,
			deps.sessionId,
		);

		expect(result.error).toBeDefined();
		expect(result.error).toContain("20");
	});

	it("increments throttle counter for each operation in the batch", async () => {
		const deps = setup();
		await handleSiaBatchExecute(
			db,
			{
				operations: [
					{ type: "execute", code: 'echo "a"', language: "bash" },
					{ type: "execute", code: 'echo "b"', language: "bash" },
				],
			},
			deps.embedder,
			deps.throttle,
			deps.sessionId,
		);

		// After 2 execute ops, the next check increments to 3
		const throttleResult = await deps.throttle.check(deps.sessionId, "sia_execute");
		expect(throttleResult.callCount).toBe(3);
	});
});
