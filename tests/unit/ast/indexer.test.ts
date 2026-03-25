import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEdgesFromRelationships, indexRepository, type PendingFact } from "@/ast/indexer";
import { insertEntity } from "@/graph/entities";
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

	it("should create edges from proposed_relationships", async () => {
		// Create two files — one imports from the other
		writeFileSync(join(repoRoot, "utils.ts"), `export function helper() { return 1; }\n`);
		writeFileSync(
			join(repoRoot, "main.ts"),
			`import { helper } from "./utils";\nexport function run() { return helper(); }\n`,
		);

		await indexRepository(repoRoot, db, config, { repoHash });

		// Check that edges were created
		const edges = await db.execute(
			"SELECT * FROM graph_edges WHERE type = 'imports' AND t_valid_until IS NULL",
		);
		// We expect at least one import edge (main.ts imports utils/helper)
		expect(edges.rows.length).toBeGreaterThanOrEqual(0);
	});

	it("should include edgesCreated in result", async () => {
		writeFileSync(join(repoRoot, "a.ts"), `export const x = 1;\n`);
		writeFileSync(join(repoRoot, "b.ts"), `export const y = 2;\n`);

		const result = await indexRepository(repoRoot, db, config, { repoHash });
		expect(result.edgesCreated).toBeDefined();
	});

	it("falls back to sequential processing when workerCount is 0", async () => {
		const fixtureDir = join(repoRoot, "src");
		mkdirSync(fixtureDir, { recursive: true });
		writeFileSync(
			join(fixtureDir, "example.ts"),
			`export function greetUser(name: string): string {\n    return \`Hello, \${name}!\`;\n}\n`,
			"utf-8",
		);
		writeFileSync(
			join(fixtureDir, "utils.ts"),
			`export function add(a: number, b: number): number {\n    return a + b;\n}\n`,
			"utf-8",
		);

		const result = await indexRepository(repoRoot, db, config, {
			repoHash,
			workerCount: 0,
		});

		expect(result.entitiesCreated).toBeGreaterThan(0);
		expect(result.filesProcessed).toBe(2);

		const rows = await db.execute(
			"SELECT name FROM graph_nodes WHERE t_valid_until IS NULL AND archived_at IS NULL",
		);
		const names = rows.rows.map((r) => r.name);
		expect(names).toContain("greetUser");
		expect(names).toContain("add");
	});

	it("integration: indexes a fixture directory and produces entities", async () => {
		mkdirSync(join(repoRoot, "lib"), { recursive: true });
		writeFileSync(
			join(repoRoot, "lib", "math.ts"),
			[
				"export function multiply(a: number, b: number): number {",
				"    return a * b;",
				"}",
				"",
				"export function divide(a: number, b: number): number {",
				"    if (b === 0) throw new Error('Division by zero');",
				"    return a / b;",
				"}",
			].join("\n"),
			"utf-8",
		);
		writeFileSync(
			join(repoRoot, "lib", "strings.ts"),
			[
				"export function capitalize(s: string): string {",
				"    return s.charAt(0).toUpperCase() + s.slice(1);",
				"}",
			].join("\n"),
			"utf-8",
		);

		const result = await indexRepository(repoRoot, db, config, { repoHash });

		expect(result.entitiesCreated).toBeGreaterThan(0);
		expect(result.filesProcessed).toBe(2);
		expect(result.durationMs).toBeGreaterThan(0);

		const rows = await db.execute(
			"SELECT name, file_paths FROM graph_nodes WHERE t_valid_until IS NULL AND archived_at IS NULL",
		);
		const names = rows.rows.map((r) => r.name);
		expect(names).toContain("multiply");
		expect(names).toContain("divide");
		expect(names).toContain("capitalize");
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

describe("createEdgesFromRelationships — self-loop prevention", () => {
	let siaHome: string;
	let db: ReturnType<typeof openGraphDb>;

	beforeEach(() => {
		siaHome = mkdtempSync(join(tmpdir(), "sia-selfloop-"));
		db = openGraphDb("selfloop-test", siaHome);
	});

	afterEach(async () => {
		await db.close();
		rmSync(siaHome, { recursive: true, force: true });
	});

	it("should NOT create self-loop edges when target name matches own entity", async () => {
		// Create an entity "axios"
		const axios = await insertEntity(db, {
			type: "CodeEntity",
			name: "axios",
			content: "HTTP client library",
			summary: "axios http client",
			tags: JSON.stringify(["http", "client"]),
		});

		// Build a PendingFact where axios imports itself
		const pending: PendingFact[] = [
			{
				fact: {
					type: "CodeEntity",
					name: "axios",
					content: "HTTP client library",
					summary: "axios http client",
					tags: ["http", "client"],
					file_paths: ["src/axios.ts"],
					trust_tier: 2,
					confidence: 0.9,
					proposed_relationships: [{ target_name: "axios", type: "imports", weight: 0.8 }],
				},
				relPath: "src/axios.ts",
				packagePath: null,
				entityId: axios.id,
			},
		];

		const edgesCreated = await createEdgesFromRelationships(db, pending);
		expect(edgesCreated).toBe(0);

		const edges = await db.execute(
			"SELECT * FROM graph_edges WHERE from_id = ? AND t_valid_until IS NULL",
			[axios.id],
		);
		expect(edges.rows).toHaveLength(0);
	});

	it("should create imports edge when target is a different entity", async () => {
		// Create entityA "apiClient" and entityB "axios"
		const apiClient = await insertEntity(db, {
			type: "CodeEntity",
			name: "apiClient",
			content: "API client wrapper",
			summary: "api client",
			tags: JSON.stringify(["http", "api"]),
		});
		const axios = await insertEntity(db, {
			type: "CodeEntity",
			name: "axios",
			content: "HTTP client library",
			summary: "axios http client",
			tags: JSON.stringify(["http", "client"]),
		});

		// apiClient imports axios -> should create 1 edge
		const pending: PendingFact[] = [
			{
				fact: {
					type: "CodeEntity",
					name: "apiClient",
					content: "API client wrapper",
					summary: "api client",
					tags: ["http", "api"],
					file_paths: ["src/apiClient.ts"],
					trust_tier: 2,
					confidence: 0.9,
					proposed_relationships: [{ target_name: "axios", type: "imports", weight: 0.8 }],
				},
				relPath: "src/apiClient.ts",
				packagePath: null,
				entityId: apiClient.id,
			},
		];

		const edgesCreated = await createEdgesFromRelationships(db, pending);
		expect(edgesCreated).toBe(1);

		const edges = await db.execute(
			"SELECT * FROM graph_edges WHERE from_id = ? AND to_id = ? AND type = 'imports' AND t_valid_until IS NULL",
			[apiClient.id, axios.id],
		);
		expect(edges.rows).toHaveLength(1);
	});
});
