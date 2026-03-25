// tests/unit/mcp/tools/sia-execute.test.ts

import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Embedder } from "@/capture/embedder";
import type { SiaDb } from "@/graph/db-interface";
import { openGraphDb } from "@/graph/semantic-db";
import { handleSiaExecute } from "@/mcp/tools/sia-execute";
import { ProgressiveThrottle } from "@/retrieval/throttle";

function makeMockEmbedder(): Embedder {
	const embedFn = vi.fn(async () => new Float32Array(384));
	return { embed: embedFn, embedBatch: vi.fn(async (texts: string[]) => texts.map(() => new Float32Array(384))), close: vi.fn() };
}

describe("handleSiaExecute", () => {
	let tmpDir: string;
	let db: SiaDb;

	afterEach(async () => {
		if (db) await db.close();
		if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
	});

	function setup() {
		tmpDir = mkdtempSync(join(tmpdir(), "sia-exec-test-"));
		db = openGraphDb(randomUUID(), tmpDir);
		return {
			embedder: makeMockEmbedder(),
			throttle: new ProgressiveThrottle(db),
			sessionId: "test-session",
		};
	}

	it("executes bash code and returns stdout", async () => {
		const deps = setup();
		const result = await handleSiaExecute(
			db,
			{
				code: 'echo "hello"',
				language: "bash",
			},
			deps.embedder,
			deps.throttle,
			deps.sessionId,
		);

		expect(result.stdout?.trim()).toBe("hello");
		expect(result.exitCode).toBe(0);
	});

	it("returns error when throttled to blocked", async () => {
		const deps = setup();
		for (let i = 0; i < 9; i++) {
			await deps.throttle.check(deps.sessionId, "sia_execute");
		}
		const result = await handleSiaExecute(
			db,
			{
				code: 'echo "blocked"',
				language: "bash",
			},
			deps.embedder,
			deps.throttle,
			deps.sessionId,
		);

		expect(result.error).toBeDefined();
		expect(result.error).toContain("blocked");
	});

	it("executes with null embedder — context mode skipped", async () => {
		const deps = setup();
		const result = await handleSiaExecute(
			db,
			{ code: 'echo "works"', language: "bash" },
			null,
			deps.throttle,
			deps.sessionId,
		);

		expect(result.stdout?.trim()).toBe("works");
		expect(result.exitCode).toBe(0);
		expect(result.contextMode).toBeUndefined();
	});

	it("warns on stderr when context mode skipped due to null embedder", async () => {
		const deps = setup();
		const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

		// Use a low threshold so we don't need huge inline strings
		const code = 'for i in $(seq 1 50); do echo "Line $i: some padded output text here"; done';
		const result = await handleSiaExecute(
			db,
			{
				code,
				language: "bash",
				intent: "find something",
			},
			null,
			deps.throttle,
			deps.sessionId,
			{
				sandboxTimeoutMs: 10000,
				sandboxOutputMaxBytes: 1_048_576,
				contextModeThreshold: 100,
				contextModeTopK: 5,
			},
		);

		expect(result.stdout).toBeDefined();
		expect(result.stdout!.length).toBeGreaterThan(100);
		expect(result.contextMode).toBeUndefined();

		expect(stderrSpy).toHaveBeenCalledWith(
			expect.stringContaining("context mode skipped"),
		);

		stderrSpy.mockRestore();
	});

	it("applies context mode for large output with intent", async () => {
		const deps = setup();
		const code = 'for i in $(seq 1 500); do echo "Log line $i: normal operation"; done';
		const result = await handleSiaExecute(
			db,
			{
				code,
				language: "bash",
				intent: "error lines",
			},
			deps.embedder,
			deps.throttle,
			deps.sessionId,
			{
				sandboxTimeoutMs: 10000,
				sandboxOutputMaxBytes: 1_048_576,
				contextModeThreshold: 1024,
				contextModeTopK: 3,
			},
		);

		expect(result.contextMode).toBeDefined();
		expect(result.contextMode?.applied).toBe(true);
		expect(result.contextMode?.totalIndexed).toBeGreaterThan(0);
	});
});
