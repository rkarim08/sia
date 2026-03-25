// tests/unit/mcp/tools/sia-execute-file.test.ts

import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Embedder } from "@/capture/embedder";
import type { SiaDb } from "@/graph/db-interface";
import { openGraphDb } from "@/graph/semantic-db";
import { handleSiaExecuteFile } from "@/mcp/tools/sia-execute-file";
import { ProgressiveThrottle } from "@/retrieval/throttle";

function makeMockEmbedder(): Embedder {
	const embedFn = vi.fn(async () => new Float32Array(384));
	return {
		embed: embedFn,
		embedBatch: vi.fn(async (texts: string[]) => texts.map(() => new Float32Array(384))),
		close: vi.fn(),
	};
}

describe("handleSiaExecuteFile", () => {
	let tmpDir: string;
	let db: SiaDb;

	afterEach(async () => {
		if (db) await db.close();
		if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
	});

	function setup() {
		tmpDir = mkdtempSync(join(tmpdir(), "sia-exec-file-test-"));
		db = openGraphDb(randomUUID(), tmpDir);
		return {
			embedder: makeMockEmbedder(),
			throttle: new ProgressiveThrottle(db),
			sessionId: "test-session",
		};
	}

	it("executes a bash script file and returns stdout", async () => {
		const deps = setup();
		const scriptPath = join(tmpDir, "hello.sh");
		writeFileSync(scriptPath, '#!/bin/bash\necho "hello from file"');

		const result = await handleSiaExecuteFile(
			db,
			{ file_path: scriptPath, language: "bash" },
			deps.embedder,
			deps.throttle,
			deps.sessionId,
		);

		expect(result.stdout?.trim()).toBe("hello from file");
		expect(result.exitCode).toBe(0);
		expect(result.error).toBeUndefined();
	});

	it("returns error for nonexistent file", async () => {
		const deps = setup();
		const result = await handleSiaExecuteFile(
			db,
			{ file_path: "/nonexistent/path/script.sh", language: "bash" },
			deps.embedder,
			deps.throttle,
			deps.sessionId,
		);

		expect(result.error).toBeDefined();
		expect(result.error).toMatch(/not found|does not exist/i);
	});

	it("auto-detects language from extension", async () => {
		const deps = setup();
		const scriptPath = join(tmpDir, "greet.sh");
		writeFileSync(scriptPath, '#!/bin/bash\necho "auto-detected"');

		// No `language` provided — should detect from .sh extension
		const result = await handleSiaExecuteFile(
			db,
			{ file_path: scriptPath },
			deps.embedder,
			deps.throttle,
			deps.sessionId,
		);

		expect(result.stdout?.trim()).toBe("auto-detected");
		expect(result.exitCode).toBe(0);
	});
});
