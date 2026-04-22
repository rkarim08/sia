import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	computeContentHash,
	getCurrentHead,
	incrementalReindex,
	readStoredHead,
} from "@/capture/incremental-reindexer";

// Minimal mock DB that tracks calls
function createMockDb() {
	const calls: Array<{ sql: string; params: unknown[] }> = [];
	return {
		calls,
		async execute(sql: string, params?: unknown[]) {
			calls.push({ sql, params: params ?? [] });
			return { rows: [] };
		},
		async close() {},
	};
}

describe("incremental-reindex integration", () => {
	let repoDir: string;
	let siaDataDir: string;
	let config: { repoDir: string; astCacheDir: string };

	beforeEach(() => {
		repoDir = mkdtempSync(join(tmpdir(), "sia-repo-"));
		siaDataDir = mkdtempSync(join(tmpdir(), "sia-data-"));
		execFileSync("git", ["init", "-b", "main"], { cwd: repoDir });
		execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: repoDir });
		execFileSync("git", ["config", "user.name", "Test"], { cwd: repoDir });
		config = {
			repoDir: join(siaDataDir, "repos"),
			astCacheDir: join(siaDataDir, "ast-cache"),
		};
		mkdirSync(config.repoDir, { recursive: true });
		mkdirSync(config.astCacheDir, { recursive: true });
	});

	afterEach(() => {
		rmSync(repoDir, { recursive: true, force: true });
		rmSync(siaDataDir, { recursive: true, force: true });
	});

	it("first run stores HEAD without reindexing", async () => {
		writeFileSync(join(repoDir, "a.ts"), "export const a = 1;");
		execFileSync("git", ["add", "."], { cwd: repoDir });
		execFileSync("git", ["commit", "-m", "init"], { cwd: repoDir });

		const db = createMockDb();
		const result = await incrementalReindex(db as any, repoDir, "testhash", config as any, null);

		expect(result.triggered).toBe(false);
		expect(result.reason).toContain("first run");
		expect(readStoredHead(join(config.repoDir, "testhash"))).toBe(getCurrentHead(repoDir));
	});

	it("reindexes only changed files after new commit", async () => {
		writeFileSync(join(repoDir, "a.ts"), "export const a = 1;");
		writeFileSync(join(repoDir, "b.ts"), "export const b = 1;");
		execFileSync("git", ["add", "."], { cwd: repoDir });
		execFileSync("git", ["commit", "-m", "init"], { cwd: repoDir });
		const oldHead = getCurrentHead(repoDir)!;

		// Change only a.ts
		writeFileSync(join(repoDir, "a.ts"), "export const a = 2;");
		execFileSync("git", ["add", "."], { cwd: repoDir });
		execFileSync("git", ["commit", "-m", "change"], { cwd: repoDir });

		const db = createMockDb();
		const result = await incrementalReindex(db as any, repoDir, "testhash", config as any, oldHead);

		expect(result.triggered).toBe(true);
		expect(result.filesChanged).toBe(1);
		expect(result.filesReparsed).toBe(1);
	});

	it("skips files with unchanged content hash on branch switch", async () => {
		writeFileSync(join(repoDir, "a.ts"), "export const a = 1;");
		execFileSync("git", ["add", "."], { cwd: repoDir });
		execFileSync("git", ["commit", "-m", "init"], { cwd: repoDir });

		// Create branch, change file, switch back
		execFileSync("git", ["checkout", "-b", "feature"], { cwd: repoDir });
		writeFileSync(join(repoDir, "a.ts"), "export const a = 2;");
		execFileSync("git", ["add", "."], { cwd: repoDir });
		execFileSync("git", ["commit", "-m", "feature"], { cwd: repoDir });
		const featureHead = getCurrentHead(repoDir)!;

		// Switch back to main — file content is back to original
		execFileSync("git", ["checkout", "main"], { cwd: repoDir });

		// Pre-populate cache with the original content hash
		const cacheDir = join(config.astCacheDir, "testhash");
		mkdirSync(cacheDir, { recursive: true });
		const cachePath = join(cacheDir, "index-cache.json");
		writeFileSync(
			cachePath,
			JSON.stringify({
				"a.ts": { mtimeMs: 0, contentHash: computeContentHash("export const a = 1;") },
			}),
		);

		const db = createMockDb();
		const result = await incrementalReindex(
			db as any,
			repoDir,
			"testhash",
			config as any,
			featureHead,
		);

		expect(result.triggered).toBe(true);
		expect(result.filesSkippedByHash).toBe(1);
		expect(result.filesReparsed).toBe(0);
	});

	it("handles HEAD unchanged gracefully", async () => {
		writeFileSync(join(repoDir, "a.ts"), "export const a = 1;");
		execFileSync("git", ["add", "."], { cwd: repoDir });
		execFileSync("git", ["commit", "-m", "init"], { cwd: repoDir });
		const head = getCurrentHead(repoDir)!;

		const db = createMockDb();
		const result = await incrementalReindex(db as any, repoDir, "testhash", config as any, head);

		expect(result.triggered).toBe(false);
		expect(result.reason).toBe("HEAD unchanged");
	});
});
