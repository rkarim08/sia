import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SiaDb } from "@/graph/db-interface";
import { openGraphDb } from "@/graph/semantic-db";
import { handleSiaSearch } from "@/mcp/tools/sia-search";

describe("sia_search tool", () => {
	let tmpDir: string;
	let db: SiaDb | undefined;

	function makeTmp(): string {
		const dir = join(tmpdir(), `sia-test-${randomUUID()}`);
		mkdirSync(dir, { recursive: true });
		return dir;
	}

	/** Insert a test entity directly via db.execute. */
	async function insertTestEntity(
		siaDb: SiaDb,
		overrides: Partial<{
			id: string;
			type: string;
			name: string;
			content: string;
			summary: string;
			package_path: string | null;
			tags: string;
			file_paths: string;
			trust_tier: number;
			confidence: number;
			importance: number;
			t_valid_from: number | null;
			t_valid_until: number | null;
			archived_at: number | null;
			conflict_group_id: string | null;
			extraction_method: string | null;
		}> = {},
	): Promise<string> {
		const now = Date.now();
		const id = overrides.id ?? randomUUID();
		await siaDb.execute(
			`INSERT INTO entities (
				id, type, name, content, summary,
				package_path, tags, file_paths,
				trust_tier, confidence, base_confidence,
				importance, base_importance,
				access_count, edge_count,
				last_accessed, created_at,
				t_created, t_expired, t_valid_from, t_valid_until,
				visibility, created_by,
				conflict_group_id, extraction_method,
				archived_at
			) VALUES (
				?, ?, ?, ?, ?,
				?, ?, ?,
				?, ?, 0.7,
				?, 0.5,
				0, 0,
				?, ?,
				?, NULL, ?, ?,
				'private', 'dev-1',
				?, ?,
				?
			)`,
			[
				id,
				overrides.type ?? "Concept",
				overrides.name ?? "Test Entity",
				overrides.content ?? "test content",
				overrides.summary ?? "test summary",
				overrides.package_path ?? null,
				overrides.tags ?? "[]",
				overrides.file_paths ?? '["src/foo.ts"]',
				overrides.trust_tier ?? 3,
				overrides.confidence ?? 0.7,
				overrides.importance ?? 0.5,
				now,
				now,
				now,
				overrides.t_valid_from ?? null,
				overrides.t_valid_until ?? null,
				overrides.conflict_group_id ?? null,
				overrides.extraction_method ?? null,
				overrides.archived_at ?? null,
			],
		);
		return id;
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

	// ---------------------------------------------------------------
	// Returns results from entities table
	// ---------------------------------------------------------------

	it("returns results from entities table", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("search-basic", tmpDir);

		const id = await insertTestEntity(db, {
			name: "Auth Module",
			type: "Concept",
			summary: "Authentication module",
			content: "Handles auth flows",
		});

		const results = await handleSiaSearch(db, { query: "auth" });
		expect(results).toHaveLength(1);
		expect(results[0].id).toBe(id);
		expect(results[0].name).toBe("Auth Module");
		expect(results[0].type).toBe("Concept");
		expect(results[0].summary).toBe("Authentication module");
		expect(results[0].content).toBe("Handles auth flows");
		expect(results[0].source_repo_name).toBeNull();
	});

	// ---------------------------------------------------------------
	// Respects limit parameter
	// ---------------------------------------------------------------

	it("respects limit parameter", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("search-limit", tmpDir);

		for (let i = 0; i < 10; i++) {
			await insertTestEntity(db, { name: `Entity ${i}`, importance: 0.5 + i * 0.01 });
		}

		const limited = await handleSiaSearch(db, { query: "test", limit: 3 });
		expect(limited).toHaveLength(3);

		// Default limit is 5
		const defaulted = await handleSiaSearch(db, { query: "test" });
		expect(defaulted).toHaveLength(5);
	});

	// ---------------------------------------------------------------
	// Limit is capped at 15
	// ---------------------------------------------------------------

	it("caps limit at 15", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("search-max-limit", tmpDir);

		for (let i = 0; i < 20; i++) {
			await insertTestEntity(db, { name: `Entity ${i}` });
		}

		const results = await handleSiaSearch(db, { query: "test", limit: 100 });
		expect(results).toHaveLength(15);
	});

	// ---------------------------------------------------------------
	// Paranoid mode excludes Tier 4 entities
	// ---------------------------------------------------------------

	it("paranoid mode excludes Tier 4 entities", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("search-paranoid", tmpDir);

		await insertTestEntity(db, { name: "Trusted", trust_tier: 2 });
		await insertTestEntity(db, { name: "LLM Inferred", trust_tier: 3 });
		await insertTestEntity(db, { name: "External", trust_tier: 4 });

		const paranoidResults = await handleSiaSearch(db, { query: "test", paranoid: true });
		expect(paranoidResults).toHaveLength(2);
		expect(paranoidResults.map((r) => r.name).sort()).toEqual(["LLM Inferred", "Trusted"]);

		const normalResults = await handleSiaSearch(db, { query: "test", paranoid: false });
		expect(normalResults).toHaveLength(3);
	});

	// ---------------------------------------------------------------
	// node_types filter works
	// ---------------------------------------------------------------

	it("node_types filter works", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("search-node-types", tmpDir);

		await insertTestEntity(db, { name: "A Concept", type: "Concept" });
		await insertTestEntity(db, { name: "A Decision", type: "Decision" });
		await insertTestEntity(db, { name: "A Bug", type: "Bug" });

		const conceptsOnly = await handleSiaSearch(db, {
			query: "test",
			node_types: ["Concept"],
		});
		expect(conceptsOnly).toHaveLength(1);
		expect(conceptsOnly[0].type).toBe("Concept");

		const mixed = await handleSiaSearch(db, {
			query: "test",
			node_types: ["Concept", "Bug"],
		});
		expect(mixed).toHaveLength(2);
		expect(mixed.map((r) => r.type).sort()).toEqual(["Bug", "Concept"]);
	});

	// ---------------------------------------------------------------
	// package_path filter works
	// ---------------------------------------------------------------

	it("package_path filter works", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("search-pkg-path", tmpDir);

		await insertTestEntity(db, {
			name: "Frontend Entity",
			package_path: "packages/frontend",
		});
		await insertTestEntity(db, {
			name: "Backend Entity",
			package_path: "packages/backend",
		});
		await insertTestEntity(db, { name: "Root Entity" });

		const frontend = await handleSiaSearch(db, {
			query: "test",
			package_path: "packages/frontend",
		});
		expect(frontend).toHaveLength(1);
		expect(frontend[0].name).toBe("Frontend Entity");
	});

	// ---------------------------------------------------------------
	// Returns conflict_group_id and t_valid_from on each result
	// ---------------------------------------------------------------

	it("returns conflict_group_id and t_valid_from on each result", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("search-conflict", tmpDir);

		const tFrom = Date.now() - 10000;
		await insertTestEntity(db, {
			name: "Conflicted Entity",
			conflict_group_id: "cg-abc-123",
			t_valid_from: tFrom,
		});

		const results = await handleSiaSearch(db, { query: "test" });
		expect(results).toHaveLength(1);
		expect(results[0].conflict_group_id).toBe("cg-abc-123");
		expect(results[0].t_valid_from).toBe(tFrom);
	});

	// ---------------------------------------------------------------
	// include_provenance adds extraction_method
	// ---------------------------------------------------------------

	it("include_provenance adds extraction_method", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("search-provenance", tmpDir);

		await insertTestEntity(db, {
			name: "LLM Extracted",
			extraction_method: "llm-haiku",
		});

		const withProv = await handleSiaSearch(db, { query: "test", include_provenance: true });
		expect(withProv).toHaveLength(1);
		expect(withProv[0].extraction_method).toBe("llm-haiku");

		const withoutProv = await handleSiaSearch(db, { query: "test", include_provenance: false });
		expect(withoutProv).toHaveLength(1);
		expect(withoutProv[0].extraction_method).toBeUndefined();
	});

	// ---------------------------------------------------------------
	// Empty graph returns empty array
	// ---------------------------------------------------------------

	it("empty graph returns empty array", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("search-empty", tmpDir);

		const results = await handleSiaSearch(db, { query: "anything" });
		expect(results).toEqual([]);
	});

	// ---------------------------------------------------------------
	// Excludes invalidated and archived entities
	// ---------------------------------------------------------------

	it("excludes invalidated and archived entities", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("search-excl", tmpDir);

		await insertTestEntity(db, { name: "Active", importance: 0.9 });
		await insertTestEntity(db, {
			name: "Invalidated",
			t_valid_until: Date.now(),
			importance: 0.8,
		});
		await insertTestEntity(db, {
			name: "Archived",
			archived_at: Date.now(),
			importance: 0.7,
		});

		const results = await handleSiaSearch(db, { query: "test" });
		expect(results).toHaveLength(1);
		expect(results[0].name).toBe("Active");
	});

	// ---------------------------------------------------------------
	// Results are ordered by importance DESC
	// ---------------------------------------------------------------

	it("results are ordered by importance DESC", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("search-order", tmpDir);

		await insertTestEntity(db, { name: "Low", importance: 0.2 });
		await insertTestEntity(db, { name: "High", importance: 0.9 });
		await insertTestEntity(db, { name: "Mid", importance: 0.5 });

		const results = await handleSiaSearch(db, { query: "test" });
		expect(results).toHaveLength(3);
		expect(results[0].name).toBe("High");
		expect(results[1].name).toBe("Mid");
		expect(results[2].name).toBe("Low");
	});
});
