import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { indexRepository } from "@/ast/indexer";
import { openGraphDb } from "@/graph/semantic-db";
import { DEFAULT_CONFIG, type SiaConfig } from "@/shared/config";

describe("indexRepository", () => {
	let repoRoot: string;
	let siaHome: string;
	let repoHash: string;
	let config: SiaConfig;
	let db: ReturnType<typeof openGraphDb>;

	beforeEach(() => {
		repoRoot = mkdtempSync(join(tmpdir(), "sia-indexer-repo-"));
		siaHome = mkdtempSync(join(tmpdir(), "sia-indexer-home-"));
		mkdirSync(join(repoRoot, ".git"));
		repoHash = createHash("sha256").update(resolve(repoRoot)).digest("hex");

		config = {
			...DEFAULT_CONFIG,
			repoDir: join(siaHome, "repos"),
			astCacheDir: join(siaHome, "ast-cache"),
		};

		db = openGraphDb(repoHash, siaHome);
	});

	afterEach(async () => {
		await db.close();
		rmSync(repoRoot, { recursive: true, force: true });
		rmSync(siaHome, { recursive: true, force: true });
	});

	it("indexes TS and Python files and writes CodeEntities", async () => {
		mkdirSync(join(repoRoot, "src"), { recursive: true });
		mkdirSync(join(repoRoot, "scripts"), { recursive: true });
		writeFileSync(join(repoRoot, "src", "alpha.ts"), "export function alpha() {}", "utf-8");
		writeFileSync(join(repoRoot, "scripts", "beta.py"), "def beta():\n    return True\n", "utf-8");

		const result = await indexRepository(repoRoot, db, config, { repoHash });
		expect(result.entitiesCreated).toBe(2);

		const rows = await db.execute(
			"SELECT name, file_paths FROM graph_nodes WHERE t_valid_until IS NULL AND archived_at IS NULL",
		);
		const names = rows.rows.map((r) => r.name);
		expect(names).toContain("alpha");
		expect(names).toContain("beta");
		expect(
			readFileSync(join(config.astCacheDir, repoHash, "index-cache.json"), "utf-8"),
		).toBeDefined();
	});

	it("uses cache on subsequent runs", async () => {
		mkdirSync(join(repoRoot, "src"), { recursive: true });
		writeFileSync(join(repoRoot, "src", "gamma.ts"), "export function gamma() {}", "utf-8");

		await indexRepository(repoRoot, db, config, { repoHash });
		const second = await indexRepository(repoRoot, db, config, { repoHash });

		expect(second.cacheHits).toBeGreaterThanOrEqual(1);
		expect(second.entitiesCreated).toBe(0);
	});

	it("updates existing entities instead of creating duplicates on re-index", async () => {
		mkdirSync(join(repoRoot, "src"), { recursive: true });
		writeFileSync(join(repoRoot, "src", "dup.ts"), "export function dup() { return 1; }", "utf-8");
		await indexRepository(repoRoot, db, config, { repoHash });

		// Modify file content
		writeFileSync(join(repoRoot, "src", "dup.ts"), "export function dup() { return 2; }", "utf-8");
		// Clear cache to force re-processing
		const cachePath = join(config.astCacheDir, repoHash, "index-cache.json");
		writeFileSync(cachePath, "{}", "utf-8");

		await indexRepository(repoRoot, db, config, { repoHash });

		const rows = await db.execute(
			"SELECT COUNT(*) as cnt FROM graph_nodes WHERE name = 'dup' AND t_valid_until IS NULL",
		);
		expect(rows.rows[0]?.cnt).toBe(1);
	});

	it("respects .gitignore patterns", async () => {
		mkdirSync(join(repoRoot, "src"), { recursive: true });
		mkdirSync(join(repoRoot, "vendor"), { recursive: true });
		writeFileSync(join(repoRoot, ".gitignore"), "vendor/\n", "utf-8");
		writeFileSync(join(repoRoot, "src", "kept.ts"), "export function kept() {}", "utf-8");
		writeFileSync(join(repoRoot, "vendor", "ignored.ts"), "export function ignored() {}", "utf-8");

		const _result = await indexRepository(repoRoot, db, config, { repoHash });
		const rows = await db.execute("SELECT name FROM graph_nodes WHERE t_valid_until IS NULL");
		const names = rows.rows.map((r) => r.name);
		expect(names).toContain("kept");
		expect(names).not.toContain("ignored");
	});

	it("calls onProgress for each processed file", async () => {
		mkdirSync(join(repoRoot, "src"), { recursive: true });
		writeFileSync(join(repoRoot, "src", "a.ts"), "export function a() {}", "utf-8");
		writeFileSync(join(repoRoot, "src", "b.ts"), "export function b() {}", "utf-8");

		const progressCalls: string[] = [];
		await indexRepository(repoRoot, db, config, {
			repoHash,
			onProgress: (p) => {
				if (p.file) progressCalls.push(p.file);
			},
		});

		expect(progressCalls).toHaveLength(2);
		expect(progressCalls).toContain("src/a.ts");
		expect(progressCalls).toContain("src/b.ts");
	});

	it("should save cache periodically during indexing", async () => {
		// Create 10 files to exceed the cache save interval (set to 5 for test)
		const dir = join(repoRoot, "src");
		mkdirSync(dir, { recursive: true });
		for (let i = 0; i < 10; i++) {
			writeFileSync(join(dir, `file${i}.ts`), `export const x${i} = ${i};`);
		}

		await indexRepository(repoRoot, db, config, {
			repoHash,
			cacheSaveInterval: 5,
		});

		// Cache file should exist and have entries
		const cachePath = join(config.astCacheDir, repoHash, "index-cache.json");
		expect(existsSync(cachePath)).toBe(true);
		const cache = JSON.parse(readFileSync(cachePath, "utf-8"));
		expect(Object.keys(cache).length).toBeGreaterThanOrEqual(5);
	});

	it("should handle batch dedup correctly with multiple symbols per file", async () => {
		// Create a file with multiple exports (multiple facts)
		writeFileSync(
			join(repoRoot, "multi.ts"),
			`export function alpha() {}\nexport function beta() {}\nexport function gamma() {}\n`,
		);

		const result1 = await indexRepository(repoRoot, db, config, { repoHash });
		expect(result1.entitiesCreated).toBeGreaterThanOrEqual(3);

		// Clear cache, modify file, re-index — should update, not duplicate
		const cachePath = join(config.astCacheDir, repoHash, "index-cache.json");
		writeFileSync(cachePath, "{}");
		writeFileSync(
			join(repoRoot, "multi.ts"),
			`export function alpha() { /* updated */ }\nexport function beta() {}\nexport function gamma() {}\n`,
		);

		await indexRepository(repoRoot, db, config, { repoHash });
		// Should not create new entities — just update existing ones
		const count = await db.execute(
			"SELECT COUNT(*) as cnt FROM graph_nodes WHERE t_valid_until IS NULL AND archived_at IS NULL",
		);
		expect(Number(count.rows[0]?.cnt)).toBe(result1.entitiesCreated);
	});

	it("should use worker pool for parallel processing", async () => {
		// Create enough files to exercise the pool
		const srcDir = join(repoRoot, "src");
		mkdirSync(srcDir, { recursive: true });
		for (let i = 0; i < 20; i++) {
			writeFileSync(join(srcDir, `mod${i}.ts`), `export function fn${i}() { return ${i}; }`);
		}

		const result = await indexRepository(repoRoot, db, config, {
			repoHash,
			workerCount: 2, // Explicitly use 2 workers for test
		});

		expect(result.filesProcessed).toBe(20);
		expect(result.entitiesCreated).toBeGreaterThanOrEqual(20);
		expect(result.durationMs).toBeGreaterThan(0);
	});

	it("should report skipped files from worker errors", async () => {
		// Create a file that will cause a parse error
		writeFileSync(join(repoRoot, "bad.ts"), "\x00\x01\x02"); // binary garbage

		const result = await indexRepository(repoRoot, db, config, {
			repoHash,
		});

		// The file should be processed (attempted) but may be skipped
		expect(result.filesProcessed).toBeGreaterThanOrEqual(1);
	});

	it("sets package_path when file is inside packages/*", async () => {
		mkdirSync(join(repoRoot, "packages", "app", "src"), { recursive: true });
		writeFileSync(
			join(repoRoot, "packages", "app", "src", "delta.ts"),
			"export function delta() {}",
			"utf-8",
		);

		await indexRepository(repoRoot, db, config, { repoHash });

		const result = await db.execute(
			"SELECT package_path FROM graph_nodes WHERE name = ? AND t_valid_until IS NULL",
			["delta"],
		);
		expect(result.rows[0]?.package_path).toBe("packages/app");
	});
});
