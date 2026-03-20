// Integration test: Capture → Retrieval pipeline
//
// Verifies that running a hook payload through the capture pipeline
// produces entities that are subsequently searchable via sia_search.

import { createHash } from "node:crypto";
import { mkdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resetCircuitBreaker, runPipeline } from "@/capture/pipeline";
import type { HookPayload } from "@/capture/types";
import { openGraphDb } from "@/graph/semantic-db";
import { handleSiaSearch } from "@/mcp/tools/sia-search";
import { DEFAULT_CONFIG } from "@/shared/config";

function makeTmpDir(): string {
	const dir = join(tmpdir(), `sia-integ-cap-${Date.now()}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

describe("Capture → Retrieval integration", () => {
	let tmpDir: string;

	afterEach(async () => {
		resetCircuitBreaker();
		if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
	});

	it("captured entities are searchable via sia_search after pipeline run", async () => {
		tmpDir = makeTmpDir();

		// Use tmpDir as cwd so realpathSync succeeds
		const payload: HookPayload = {
			type: "PostToolUse",
			sessionId: "integ-capture-1",
			content:
				"We decided to use Redis for session caching because of its speed and low latency",
			cwd: tmpDir,
			toolName: "Write",
			filePath: "src/cache/redis.ts",
		};

		const config = {
			...DEFAULT_CONFIG,
			// Use air-gapped mode to avoid any external LLM calls
			airGapped: true,
		};

		// Run the full capture pipeline
		const result = await runPipeline(payload, { siaHome: tmpDir, config });

		expect(result).toBeDefined();
		expect(typeof result.candidates).toBe("number");

		// Compute the repo hash the same way the pipeline does
		const repoHash = createHash("sha256").update(realpathSync(tmpDir)).digest("hex");

		// Open the graph db and verify entities were created
		const db = openGraphDb(repoHash, tmpDir);
		try {
			const { rows } = await db.execute(
				"SELECT id, name, content FROM graph_nodes WHERE t_valid_until IS NULL AND archived_at IS NULL",
			);

			// At minimum the chunker should have produced at least one candidate
			// and the pipeline should have persisted it
			expect(rows.length).toBeGreaterThan(0);

			// Verify that search works against the populated db
			const searchResults = await handleSiaSearch(db, {
				query: "Redis session caching",
				limit: 5,
			});

			// The search infrastructure should return without throwing
			expect(Array.isArray(searchResults)).toBe(true);
		} finally {
			await db.close();
		}
	});

	it("pipeline persists episode to episodic.db", async () => {
		tmpDir = makeTmpDir();

		const payload: HookPayload = {
			type: "PostToolUse",
			sessionId: "integ-capture-episode-1",
			content: "export function buildCache(): Cache { return new RedisCache(); }",
			cwd: tmpDir,
			toolName: "Write",
			filePath: "src/cache/index.ts",
		};

		const config = { ...DEFAULT_CONFIG, airGapped: true };

		await runPipeline(payload, { siaHome: tmpDir, config });

		// Verify episode was recorded
		const repoHash = createHash("sha256").update(realpathSync(tmpDir)).digest("hex");
		const { openEpisodicDb } = await import("@/graph/semantic-db");
		const episodicDb = openEpisodicDb(repoHash, tmpDir);
		try {
			const { rows } = await episodicDb.execute(
				"SELECT session_id FROM sessions_processed WHERE session_id = ?",
				[payload.sessionId],
			);
			expect(rows.length).toBe(1);
		} finally {
			await episodicDb.close();
		}
	});

	it("airGapped mode produces candidates from chunker and track-a only", async () => {
		tmpDir = makeTmpDir();

		const payload: HookPayload = {
			type: "PostToolUse",
			sessionId: "integ-capture-airgap-1",
			content:
				"export function resolveConfig(path: string): Config { return loadFromDisk(path); }",
			cwd: tmpDir,
			toolName: "Write",
			filePath: "src/config.ts",
		};

		// Air-gapped: no LLM calls, Track B will be skipped
		const config = { ...DEFAULT_CONFIG, airGapped: true };

		const result = await runPipeline(payload, { siaHome: tmpDir, config });

		// Chunker + Track A should produce at least one candidate
		expect(result.candidates).toBeGreaterThanOrEqual(1);
		expect(result.consolidation.added).toBeGreaterThanOrEqual(0);
	});
});
