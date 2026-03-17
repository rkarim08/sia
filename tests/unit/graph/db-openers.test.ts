import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openBridgeDb } from "@/graph/bridge-db";
import type { SiaDb } from "@/graph/db-interface";
import { openMetaDb } from "@/graph/meta-db";
import { openEpisodicDb, openGraphDb } from "@/graph/semantic-db";

describe("database opener helpers", () => {
	let tmpDir: string;
	let db: SiaDb | undefined;

	function makeTmp(): string {
		const dir = join(tmpdir(), `sia-test-${randomUUID()}`);
		mkdirSync(dir, { recursive: true });
		return dir;
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

	it("openGraphDb opens graph.db with _migrations table present", async () => {
		tmpDir = makeTmp();
		const repoHash = "abc123";

		db = openGraphDb(repoHash, tmpDir);

		// Verify the database file was created at the expected path.
		const expectedPath = join(tmpDir, "repos", repoHash, "graph.db");
		expect(existsSync(expectedPath)).toBe(true);

		// Verify _migrations table exists.
		const result = await db.execute(
			"SELECT name FROM sqlite_master WHERE type = 'table' AND name = '_migrations'",
		);
		expect(result.rows).toHaveLength(1);
		expect(result.rows[0]?.name).toBe("_migrations");
	});

	it("openEpisodicDb opens episodic.db with _migrations table present", async () => {
		tmpDir = makeTmp();
		const repoHash = "def456";

		db = openEpisodicDb(repoHash, tmpDir);

		// Verify the database file was created at the expected path.
		const expectedPath = join(tmpDir, "repos", repoHash, "episodic.db");
		expect(existsSync(expectedPath)).toBe(true);

		// Verify _migrations table exists.
		const result = await db.execute(
			"SELECT name FROM sqlite_master WHERE type = 'table' AND name = '_migrations'",
		);
		expect(result.rows).toHaveLength(1);
		expect(result.rows[0]?.name).toBe("_migrations");
	});

	it("openMetaDb opens meta.db at sia home root", async () => {
		tmpDir = makeTmp();

		db = openMetaDb(tmpDir);

		// Verify the database file is at {siaHome}/meta.db, not under repos/.
		const expectedPath = join(tmpDir, "meta.db");
		expect(existsSync(expectedPath)).toBe(true);

		// Should NOT be under repos/.
		const reposDir = join(tmpDir, "repos");
		expect(existsSync(reposDir)).toBe(false);

		// Verify _migrations table exists.
		const result = await db.execute(
			"SELECT name FROM sqlite_master WHERE type = 'table' AND name = '_migrations'",
		);
		expect(result.rows).toHaveLength(1);
		expect(result.rows[0]?.name).toBe("_migrations");
	});

	it("openBridgeDb opens bridge.db at sia home root", async () => {
		tmpDir = makeTmp();

		db = openBridgeDb(tmpDir);

		// Verify the database file is at {siaHome}/bridge.db, not under repos/.
		const expectedPath = join(tmpDir, "bridge.db");
		expect(existsSync(expectedPath)).toBe(true);

		// Should NOT be under repos/.
		const reposDir = join(tmpDir, "repos");
		expect(existsSync(reposDir)).toBe(false);

		// Verify _migrations table exists.
		const result = await db.execute(
			"SELECT name FROM sqlite_master WHERE type = 'table' AND name = '_migrations'",
		);
		expect(result.rows).toHaveLength(1);
		expect(result.rows[0]?.name).toBe("_migrations");
	});
});
