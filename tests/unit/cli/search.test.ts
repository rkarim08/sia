import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { searchGraph } from "@/cli/commands/search";
import type { SiaDb } from "@/graph/db-interface";
import { archiveEntity, insertEntity, invalidateEntity } from "@/graph/entities";
import { openGraphDb } from "@/graph/semantic-db";

function makeTmp(): string {
	const dir = join(tmpdir(), `sia-test-${randomUUID()}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

describe("CLI search", () => {
	let tmpDir: string;
	let db: SiaDb | undefined;

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
	// finds entities by name via FTS5 or LIKE fallback
	// ---------------------------------------------------------------

	it("finds entities by name via FTS5 or LIKE fallback", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("search-fts", tmpDir);

		await insertEntity(db, {
			type: "Concept",
			name: "authentication handler",
			content: "Handles user authentication via OAuth2 tokens and session cookies",
			summary: "Auth handler module",
		});

		const results = await searchGraph(db, "authentication");

		expect(results.length).toBeGreaterThanOrEqual(1);
		expect(results[0]).toHaveProperty("name");
		expect(results[0]).toHaveProperty("type");
		expect(results[0]).toHaveProperty("content");
	});

	// ---------------------------------------------------------------
	// returns empty array when no match
	// ---------------------------------------------------------------

	it("returns empty array when no match", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("search-empty", tmpDir);

		await insertEntity(db, {
			type: "Concept",
			name: "database connector",
			content: "Connects to PostgreSQL databases",
			summary: "DB connector",
		});

		const results = await searchGraph(db, "zzzznonexistent");

		expect(results).toEqual([]);
	});

	// ---------------------------------------------------------------
	// respects limit parameter
	// ---------------------------------------------------------------

	it("respects limit parameter", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("search-limit", tmpDir);

		// Insert 5 entities with "test" in their names
		for (let i = 0; i < 5; i++) {
			await insertEntity(db, {
				type: "Concept",
				name: `test entity ${i}`,
				content: `Content for test entity number ${i}`,
				summary: `Test entity ${i}`,
			});
		}

		const results = await searchGraph(db, "test", { limit: 2 });

		expect(results.length).toBeLessThanOrEqual(2);
	});

	// ---------------------------------------------------------------
	// excludes archived and invalidated entities
	// ---------------------------------------------------------------

	it("excludes archived and invalidated entities", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("search-exclude", tmpDir);

		// Active entity matching "test"
		await insertEntity(db, {
			type: "Concept",
			name: "test active entity",
			content: "This is an active test entity",
			summary: "Active test",
		});

		// Archived entity matching "test"
		const archived = await insertEntity(db, {
			type: "Concept",
			name: "test archived entity",
			content: "This is an archived test entity",
			summary: "Archived test",
		});
		await archiveEntity(db, archived.id);

		// Invalidated entity matching "test"
		const invalidated = await insertEntity(db, {
			type: "Concept",
			name: "test invalidated entity",
			content: "This is an invalidated test entity",
			summary: "Invalidated test",
		});
		await invalidateEntity(db, invalidated.id);

		const results = await searchGraph(db, "test");

		// Only the active entity should be returned
		expect(results).toHaveLength(1);
		expect(results[0]?.name).toBe("test active entity");
	});
});
