import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { detectCrossRepoEdges, resetCircuitBreaker, runPipeline } from "@/capture/pipeline";
import type { CandidateFact, HookPayload } from "@/capture/types";
import { openBridgeDb } from "@/graph/bridge-db";
import { openMetaDb } from "@/graph/meta-db";
import { openEpisodicDb, openGraphDb } from "@/graph/semantic-db";
import { DEFAULT_CONFIG, type SiaConfig } from "@/shared/config";

function makeTmp(): string {
	const dir = join(tmpdir(), `sia-test-${randomUUID()}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

function makeConfig(overrides: Partial<SiaConfig> = {}): SiaConfig {
	return { ...DEFAULT_CONFIG, ...overrides };
}

function makePayload(tmpDir: string, overrides: Partial<HookPayload> = {}): HookPayload {
	return {
		cwd: tmpDir,
		type: "PostToolUse",
		sessionId: `sess-${randomUUID()}`,
		content: "export function handleRequest(req: Request): Response { return new Response('ok'); }",
		toolName: "Write",
		filePath: "src/server.ts",
		...overrides,
	};
}

describe("runPipeline", () => {
	let tmpDir: string;

	beforeEach(() => {
		resetCircuitBreaker();
	});

	afterEach(() => {
		if (tmpDir) {
			rmSync(tmpDir, { recursive: true, force: true });
		}
		resetCircuitBreaker();
	});

	// ---------------------------------------------------------------
	// Pipeline completes and returns PipelineResult with all fields
	// ---------------------------------------------------------------

	it("completes and returns PipelineResult with all fields", async () => {
		tmpDir = makeTmp();
		const payload = makePayload(tmpDir);
		const config = makeConfig();

		const result = await runPipeline(payload, { siaHome: tmpDir, config });

		expect(result).toBeDefined();
		expect(typeof result.candidates).toBe("number");
		expect(result.candidates).toBeGreaterThanOrEqual(1);
		expect(result.consolidation).toBeDefined();
		expect(typeof result.consolidation.added).toBe("number");
		expect(typeof result.consolidation.updated).toBe("number");
		expect(typeof result.consolidation.invalidated).toBe("number");
		expect(typeof result.consolidation.noops).toBe("number");
		expect(typeof result.edgesCreated).toBe("number");
		expect(typeof result.flagsProcessed).toBe("number");
		expect(typeof result.durationMs).toBe("number");
		expect(result.durationMs).toBeGreaterThan(0);
		expect(typeof result.circuitBreakerActive).toBe("boolean");
		expect(result.circuitBreakerActive).toBe(false);
	});

	// ---------------------------------------------------------------
	// Track A and Track B results are both included in candidates count
	// ---------------------------------------------------------------

	it("includes Track A and Track B results in candidates count", async () => {
		tmpDir = makeTmp();
		// Content with an exported function (Track A) and a decision keyword (Track B)
		const payload = makePayload(tmpDir, {
			content:
				"export function parseConfig(input: string): Config { return JSON.parse(input); }\n\nWe decided to use JSON for all config files. This is a convention rule: always use JSON.",
			filePath: "src/config.ts",
		});
		const config = makeConfig({ airGapped: false });

		const result = await runPipeline(payload, { siaHome: tmpDir, config });

		// Should have: at least 1 from chunker + 1 from Track A (parseConfig) + at least 1 from Track B (Decision/Convention)
		expect(result.candidates).toBeGreaterThanOrEqual(3);
	});

	// ---------------------------------------------------------------
	// sessions_processed written with 'complete' on success
	// ---------------------------------------------------------------

	it("writes sessions_processed with 'complete' on success", async () => {
		tmpDir = makeTmp();
		const payload = makePayload(tmpDir);
		const config = makeConfig();
		const repoHash = (() => {
			const { createHash } = require("node:crypto");
			const { realpathSync } = require("node:fs");
			const absPath = realpathSync(tmpDir);
			return createHash("sha256").update(absPath).digest("hex");
		})();

		await runPipeline(payload, { siaHome: tmpDir, config });

		// Open episodic DB to verify
		const episodicDb = openEpisodicDb(repoHash, tmpDir);
		try {
			const result = await episodicDb.execute(
				"SELECT processing_status FROM sessions_processed WHERE session_id = ?",
				[payload.sessionId],
			);
			expect(result.rows).toHaveLength(1);
			expect((result.rows[0] as { processing_status: string }).processing_status).toBe("complete");
		} finally {
			await episodicDb.close();
		}
	});

	// ---------------------------------------------------------------
	// Circuit breaker activates after 3 failures
	// ---------------------------------------------------------------

	it("circuit breaker activates after 3 consolidation failures", async () => {
		tmpDir = makeTmp();
		const config = makeConfig();

		// Mock consolidation to throw by using a payload that triggers candidates
		// We'll run the pipeline 3 times with a broken consolidate mock
		const consolidateMod = await import("@/capture/consolidate");
		const _originalConsolidate = consolidateMod.consolidate;

		// Replace consolidate temporarily
		const mockConsolidate = vi.fn().mockRejectedValue(new Error("Consolidation DB error"));
		vi.spyOn(consolidateMod, "consolidate").mockImplementation(mockConsolidate);

		try {
			// Run 3 times to trigger breaker
			for (let i = 0; i < 3; i++) {
				const payload = makePayload(tmpDir, { sessionId: `sess-fail-${i}` });
				await runPipeline(payload, { siaHome: tmpDir, config });
			}

			// Fourth run: circuit breaker should be active, uses direct-write
			const payload = makePayload(tmpDir, { sessionId: "sess-breaker" });
			const result = await runPipeline(payload, { siaHome: tmpDir, config });

			expect(result.circuitBreakerActive).toBe(true);
			// Direct-write should still produce added entities
			expect(result.consolidation.added).toBeGreaterThanOrEqual(1);
		} finally {
			vi.restoreAllMocks();
		}
	});

	// ---------------------------------------------------------------
	// Circuit breaker resets via resetCircuitBreaker()
	// ---------------------------------------------------------------

	it("circuit breaker resets via resetCircuitBreaker()", async () => {
		tmpDir = makeTmp();
		const config = makeConfig();

		const consolidateMod = await import("@/capture/consolidate");
		const mockConsolidate = vi.fn().mockRejectedValue(new Error("Consolidation DB error"));
		vi.spyOn(consolidateMod, "consolidate").mockImplementation(mockConsolidate);

		try {
			// Trigger breaker
			for (let i = 0; i < 3; i++) {
				const payload = makePayload(tmpDir, { sessionId: `sess-reset-${i}` });
				await runPipeline(payload, { siaHome: tmpDir, config });
			}

			// Verify breaker is active
			const payload1 = makePayload(tmpDir, { sessionId: "sess-active" });
			const result1 = await runPipeline(payload1, { siaHome: tmpDir, config });
			expect(result1.circuitBreakerActive).toBe(true);

			// Reset breaker
			resetCircuitBreaker();

			// Now restore mocks so consolidation works
			vi.restoreAllMocks();

			// Pipeline should succeed with breaker inactive
			const payload2 = makePayload(tmpDir, { sessionId: "sess-after-reset" });
			const result2 = await runPipeline(payload2, { siaHome: tmpDir, config });
			expect(result2.circuitBreakerActive).toBe(false);
		} finally {
			vi.restoreAllMocks();
		}
	});

	// ---------------------------------------------------------------
	// Episodic archive written (verify episode exists in episodic.db)
	// ---------------------------------------------------------------

	it("writes episode to episodic.db", async () => {
		tmpDir = makeTmp();
		const payload = makePayload(tmpDir);
		const config = makeConfig();
		const repoHash = (() => {
			const { createHash } = require("node:crypto");
			const { realpathSync } = require("node:fs");
			const absPath = realpathSync(tmpDir);
			return createHash("sha256").update(absPath).digest("hex");
		})();

		await runPipeline(payload, { siaHome: tmpDir, config });

		// Open episodic DB to verify
		const episodicDb = openEpisodicDb(repoHash, tmpDir);
		try {
			const result = await episodicDb.execute("SELECT * FROM episodes WHERE session_id = ?", [
				payload.sessionId,
			]);
			expect(result.rows).toHaveLength(1);
			const episode = result.rows[0] as Record<string, unknown>;
			expect(episode.session_id).toBe(payload.sessionId);
			expect(episode.content).toBe(payload.content);
			expect(episode.tool_name).toBe(payload.toolName);
			expect(episode.file_path).toBe(payload.filePath);
		} finally {
			await episodicDb.close();
		}
	});
});

// ---------------------------------------------------------------------------
// detectCrossRepoEdges — writes bridge edges when metaDb has matching contracts
// ---------------------------------------------------------------------------

describe("detectCrossRepoEdges", () => {
	let tmpDir: string;

	afterEach(() => {
		if (tmpDir) {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("returns 0 when no metaDb is provided", async () => {
		tmpDir = makeTmp();
		const graphDb = openGraphDb("test-repo", tmpDir);
		const bridgeDb = openBridgeDb(tmpDir);
		const candidates: CandidateFact[] = [
			{
				type: "Decision",
				name: "workspace-dep",
				content: '{"workspace:*": true}',
				summary: "workspace dep",
				tags: [],
				file_paths: [],
				trust_tier: 2,
				confidence: 0.9,
			},
		];
		try {
			const count = await detectCrossRepoEdges(graphDb, bridgeDb, candidates, "test-repo");
			expect(count).toBe(0);
		} finally {
			await graphDb.close();
			await bridgeDb.close();
		}
	});

	it("writes depends_on edges to bridge.db for matching candidates and contracts", async () => {
		tmpDir = makeTmp();

		// Compute real repoHash matching what runPipeline would use
		const absPath = realpathSync(tmpDir);
		const repoHash = createHash("sha256").update(absPath).digest("hex");

		// Set up meta.db with a contract where current repo is consumer
		const metaDb = openMetaDb(tmpDir);
		const providerRepoId = randomUUID();
		const contractId = randomUUID();
		// Insert provider repo (required FK)
		await metaDb.execute("INSERT INTO repos (id, path, created_at) VALUES (?, ?, ?)", [
			providerRepoId,
			"/some/provider/path",
			Date.now(),
		]);
		// Insert consumer repo (required FK)
		await metaDb.execute("INSERT INTO repos (id, path, created_at) VALUES (?, ?, ?)", [
			repoHash,
			absPath,
			Date.now(),
		]);
		// Insert api_contract with consumer = repoHash
		await metaDb.execute(
			"INSERT INTO api_contracts (id, provider_repo_id, consumer_repo_id, contract_type, detected_at) VALUES (?, ?, ?, ?, ?)",
			[contractId, providerRepoId, repoHash, "npm-package", Date.now()],
		);

		// Set up graph.db and bridge.db
		const graphDb = openGraphDb(repoHash, tmpDir);
		const bridgeDb = openBridgeDb(tmpDir);

		// Create candidates with workspace:* pattern
		const candidates: CandidateFact[] = [
			{
				type: "Decision",
				name: "workspace-dep-candidate",
				content: 'uses "workspace:*" packages from provider',
				summary: "workspace dep",
				tags: [],
				file_paths: [],
				trust_tier: 2,
				confidence: 0.9,
			},
		];

		try {
			const count = await detectCrossRepoEdges(graphDb, bridgeDb, candidates, repoHash, metaDb);

			// Should have written 1 edge (1 candidate × 1 contract)
			expect(count).toBe(1);

			// Verify edge was actually written to bridge.db
			const { rows } = await bridgeDb.execute(
				"SELECT * FROM cross_repo_edges WHERE source_repo_id = ? AND target_repo_id = ? AND type = 'depends_on'",
				[repoHash, providerRepoId],
			);
			expect(rows).toHaveLength(1);
			const edge = rows[0] as Record<string, unknown>;
			expect(edge.source_entity_id).toBe("workspace-dep-candidate");
			expect(edge.created_by).toBe("auto-detect");
			expect(edge.t_valid_until).toBeNull();
		} finally {
			await metaDb.close();
			await graphDb.close();
			await bridgeDb.close();
		}
	});

	it("returns 0 when candidates have no cross-repo patterns", async () => {
		tmpDir = makeTmp();
		const absPath = realpathSync(tmpDir);
		const repoHash = createHash("sha256").update(absPath).digest("hex");

		const metaDb = openMetaDb(tmpDir);
		const graphDb = openGraphDb(repoHash, tmpDir);
		const bridgeDb = openBridgeDb(tmpDir);

		const candidates: CandidateFact[] = [
			{
				type: "Decision",
				name: "normal-entity",
				content: "just a normal decision with no workspace imports",
				summary: "normal",
				tags: [],
				file_paths: [],
				trust_tier: 2,
				confidence: 0.9,
			},
		];

		try {
			const count = await detectCrossRepoEdges(graphDb, bridgeDb, candidates, repoHash, metaDb);
			expect(count).toBe(0);
		} finally {
			await metaDb.close();
			await graphDb.close();
			await bridgeDb.close();
		}
	});

	it("returns 0 when metaDb has no matching contracts for this repo", async () => {
		tmpDir = makeTmp();
		const absPath = realpathSync(tmpDir);
		const repoHash = createHash("sha256").update(absPath).digest("hex");

		// meta.db with no contracts for this repo
		const metaDb = openMetaDb(tmpDir);
		const graphDb = openGraphDb(repoHash, tmpDir);
		const bridgeDb = openBridgeDb(tmpDir);

		const candidates: CandidateFact[] = [
			{
				type: "Decision",
				name: "workspace-dep-candidate",
				content: 'uses "workspace:*" packages',
				summary: "workspace dep",
				tags: [],
				file_paths: [],
				trust_tier: 2,
				confidence: 0.9,
			},
		];

		try {
			const count = await detectCrossRepoEdges(graphDb, bridgeDb, candidates, repoHash, metaDb);
			expect(count).toBe(0);
		} finally {
			await metaDb.close();
			await graphDb.close();
			await bridgeDb.close();
		}
	});
});
