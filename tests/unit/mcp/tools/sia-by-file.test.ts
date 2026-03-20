import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SiaDb } from "@/graph/db-interface";
import { openGraphDb } from "@/graph/semantic-db";
import { handleSiaByFile } from "@/mcp/tools/sia-by-file";

describe("sia_by_file tool", () => {
	let tmpDir: string;
	let db: SiaDb | undefined;

	function makeTmp(): string {
		const dir = join(tmpdir(), `sia-test-${randomUUID()}`);
		mkdirSync(dir, { recursive: true });
		return dir;
	}

	/** Insert a minimal entity with file_paths directly. */
	async function insertTestEntity(
		siaDb: SiaDb,
		opts: {
			id: string;
			name: string;
			filePaths: string[];
			importance?: number;
			invalidated?: boolean;
			archived?: boolean;
		},
	): Promise<void> {
		const now = Date.now();
		await siaDb.execute(
			`INSERT INTO graph_nodes (
				id, type, name, content, summary,
				tags, file_paths, trust_tier, confidence, base_confidence,
				importance, base_importance, access_count, edge_count,
				last_accessed, created_at,
				t_created, t_expired, t_valid_from, t_valid_until,
				visibility, created_by, archived_at
			) VALUES (
				?, 'CodeEntity', ?, 'test content', 'test summary',
				'[]', ?, 3, 0.7, 0.7,
				?, 0.5, 0, 0,
				?, ?,
				?, NULL, NULL, ?,
				'private', 'dev-1', ?
			)`,
			[
				opts.id,
				opts.name,
				JSON.stringify(opts.filePaths),
				opts.importance ?? 0.5,
				now,
				now,
				now,
				opts.invalidated ? now : null,
				opts.archived ? now : null,
			],
		);
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
	// Exact file_path match returns entity
	// ---------------------------------------------------------------

	it("exact file_path match returns entity", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("by-file-exact", tmpDir);

		const entityId = randomUUID();
		await insertTestEntity(db, {
			id: entityId,
			name: "Auth Module",
			filePaths: ["src/auth/index.ts", "src/auth/middleware.ts"],
			importance: 0.9,
		});

		const result = await handleSiaByFile(db, { file_path: "src/auth/index.ts" });
		expect(result.entities).toHaveLength(1);
		expect(result.entities[0]?.id).toBe(entityId);
		expect(result.entities[0]?.name).toBe("Auth Module");
	});

	// ---------------------------------------------------------------
	// Filename stem fallback works
	// ---------------------------------------------------------------

	it("filename stem fallback works when exact match fails", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("by-file-stem", tmpDir);

		const entityId = randomUUID();
		await insertTestEntity(db, {
			id: entityId,
			name: "Config Loader",
			filePaths: ["src/config/loader.ts"],
			importance: 0.8,
		});

		// Query with a different path prefix but same filename
		const result = await handleSiaByFile(db, { file_path: "packages/core/loader.ts" });
		expect(result.entities).toHaveLength(1);
		expect(result.entities[0]?.id).toBe(entityId);
		expect(result.entities[0]?.name).toBe("Config Loader");
	});

	// ---------------------------------------------------------------
	// Invalidated entities excluded
	// ---------------------------------------------------------------

	it("invalidated entities are excluded from results", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("by-file-invalidated", tmpDir);

		const activeId = randomUUID();
		const invalidatedId = randomUUID();

		await insertTestEntity(db, {
			id: activeId,
			name: "Active Entity",
			filePaths: ["src/utils.ts"],
			importance: 0.7,
		});

		await insertTestEntity(db, {
			id: invalidatedId,
			name: "Invalidated Entity",
			filePaths: ["src/utils.ts"],
			importance: 0.9,
			invalidated: true,
		});

		const result = await handleSiaByFile(db, { file_path: "src/utils.ts" });
		expect(result.entities).toHaveLength(1);
		expect(result.entities[0]?.id).toBe(activeId);
	});

	// ---------------------------------------------------------------
	// Empty result for unknown file
	// ---------------------------------------------------------------

	it("returns empty for unknown file path", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("by-file-unknown", tmpDir);

		await insertTestEntity(db, {
			id: randomUUID(),
			name: "Some Entity",
			filePaths: ["src/known.ts"],
		});

		const result = await handleSiaByFile(db, { file_path: "src/nonexistent.ts" });
		expect(result.entities).toHaveLength(0);
	});

	// ---------------------------------------------------------------
	// Respects limit
	// ---------------------------------------------------------------

	it("respects limit parameter", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("by-file-limit", tmpDir);

		for (let i = 0; i < 5; i++) {
			await insertTestEntity(db, {
				id: randomUUID(),
				name: `Entity ${i}`,
				filePaths: ["src/shared.ts"],
				importance: 0.5 + i * 0.1,
			});
		}

		const result = await handleSiaByFile(db, { file_path: "src/shared.ts", limit: 3 });
		expect(result.entities).toHaveLength(3);
	});

	// ---------------------------------------------------------------
	// Results ordered by importance DESC
	// ---------------------------------------------------------------

	it("results are ordered by importance descending", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("by-file-order", tmpDir);

		const lowId = randomUUID();
		const highId = randomUUID();

		await insertTestEntity(db, {
			id: lowId,
			name: "Low Importance",
			filePaths: ["src/app.ts"],
			importance: 0.2,
		});

		await insertTestEntity(db, {
			id: highId,
			name: "High Importance",
			filePaths: ["src/app.ts"],
			importance: 0.9,
		});

		const result = await handleSiaByFile(db, { file_path: "src/app.ts" });
		expect(result.entities).toHaveLength(2);
		expect(result.entities[0]?.id).toBe(highId);
		expect(result.entities[1]?.id).toBe(lowId);
	});

	// ---------------------------------------------------------------
	// Archived entities excluded
	// ---------------------------------------------------------------

	it("archived entities are excluded from results", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("by-file-archived", tmpDir);

		const activeId = randomUUID();
		const archivedId = randomUUID();

		await insertTestEntity(db, {
			id: activeId,
			name: "Active Entity",
			filePaths: ["src/core.ts"],
		});

		await insertTestEntity(db, {
			id: archivedId,
			name: "Archived Entity",
			filePaths: ["src/core.ts"],
			archived: true,
		});

		const result = await handleSiaByFile(db, { file_path: "src/core.ts" });
		expect(result.entities).toHaveLength(1);
		expect(result.entities[0]?.id).toBe(activeId);
	});
});
