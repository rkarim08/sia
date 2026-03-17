import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SiaDb } from "@/graph/db-interface";
import { runMigrations } from "@/graph/semantic-db";

describe("runMigrations", () => {
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

	it("creates _migrations table", async () => {
		tmpDir = makeTmp();
		const dbPath = join(tmpDir, "test.db");
		const migrationsDir = join(tmpDir, "migrations");
		mkdirSync(migrationsDir, { recursive: true });

		db = runMigrations(dbPath, migrationsDir);

		const result = await db.execute(
			"SELECT name FROM sqlite_master WHERE type = 'table' AND name = '_migrations'",
		);
		expect(result.rows).toHaveLength(1);
		expect(result.rows[0]?.name).toBe("_migrations");
	});

	it("applies a single SQL migration", async () => {
		tmpDir = makeTmp();
		const dbPath = join(tmpDir, "test.db");
		const migrationsDir = join(tmpDir, "migrations");
		mkdirSync(migrationsDir, { recursive: true });

		writeFileSync(
			join(migrationsDir, "001-create-nodes.sql"),
			"CREATE TABLE nodes (id INTEGER PRIMARY KEY, label TEXT NOT NULL);",
		);

		db = runMigrations(dbPath, migrationsDir);

		const result = await db.execute(
			"SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'nodes'",
		);
		expect(result.rows).toHaveLength(1);
		expect(result.rows[0]?.name).toBe("nodes");
	});

	it("applies migrations in numeric order", async () => {
		tmpDir = makeTmp();
		const dbPath = join(tmpDir, "test.db");
		const migrationsDir = join(tmpDir, "migrations");
		mkdirSync(migrationsDir, { recursive: true });

		// Write in reverse order to verify sort handles it.
		writeFileSync(
			join(migrationsDir, "002-create-edges.sql"),
			"CREATE TABLE edges (src INTEGER REFERENCES nodes(id), dst INTEGER REFERENCES nodes(id));",
		);
		writeFileSync(
			join(migrationsDir, "001-create-nodes.sql"),
			"CREATE TABLE nodes (id INTEGER PRIMARY KEY, label TEXT NOT NULL);",
		);

		db = runMigrations(dbPath, migrationsDir);

		// Both tables should exist.
		const nodes = await db.execute(
			"SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'nodes'",
		);
		const edges = await db.execute(
			"SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'edges'",
		);
		expect(nodes.rows).toHaveLength(1);
		expect(edges.rows).toHaveLength(1);
	});

	it("does not re-apply on second open", async () => {
		tmpDir = makeTmp();
		const dbPath = join(tmpDir, "test.db");
		const migrationsDir = join(tmpDir, "migrations");
		mkdirSync(migrationsDir, { recursive: true });

		writeFileSync(
			join(migrationsDir, "001-create-nodes.sql"),
			"CREATE TABLE nodes (id INTEGER PRIMARY KEY, label TEXT NOT NULL);",
		);

		// First run — applies migration.
		const db1 = runMigrations(dbPath, migrationsDir);
		await db1.close();

		// Second run — should NOT fail with "table already exists".
		db = runMigrations(dbPath, migrationsDir);

		const result = await db.execute(
			"SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'nodes'",
		);
		expect(result.rows).toHaveLength(1);
	});

	it("tracks migration filenames in _migrations", async () => {
		tmpDir = makeTmp();
		const dbPath = join(tmpDir, "test.db");
		const migrationsDir = join(tmpDir, "migrations");
		mkdirSync(migrationsDir, { recursive: true });

		writeFileSync(
			join(migrationsDir, "001-create-nodes.sql"),
			"CREATE TABLE nodes (id INTEGER PRIMARY KEY);",
		);
		writeFileSync(
			join(migrationsDir, "002-create-edges.sql"),
			"CREATE TABLE edges (id INTEGER PRIMARY KEY);",
		);

		db = runMigrations(dbPath, migrationsDir);

		const result = await db.execute("SELECT name FROM _migrations ORDER BY name");
		expect(result.rows).toHaveLength(2);
		expect(result.rows[0]?.name).toBe("001-create-nodes.sql");
		expect(result.rows[1]?.name).toBe("002-create-edges.sql");
	});

	it("sets WAL and foreign_keys pragmas", async () => {
		tmpDir = makeTmp();
		const dbPath = join(tmpDir, "test.db");
		const migrationsDir = join(tmpDir, "migrations");
		mkdirSync(migrationsDir, { recursive: true });

		db = runMigrations(dbPath, migrationsDir);

		const walResult = await db.execute("PRAGMA journal_mode");
		expect(walResult.rows[0]?.journal_mode).toBe("wal");

		const fkResult = await db.execute("PRAGMA foreign_keys");
		expect(fkResult.rows[0]?.foreign_keys).toBe(1);
	});

	it("handles empty migrations directory", async () => {
		tmpDir = makeTmp();
		const dbPath = join(tmpDir, "test.db");
		const migrationsDir = join(tmpDir, "migrations");
		mkdirSync(migrationsDir, { recursive: true });

		// Empty dir — no .sql files.
		db = runMigrations(dbPath, migrationsDir);

		const result = await db.execute("SELECT name FROM _migrations");
		expect(result.rows).toHaveLength(0);

		// _migrations table should still be created.
		const tables = await db.execute(
			"SELECT name FROM sqlite_master WHERE type = 'table' AND name = '_migrations'",
		);
		expect(tables.rows).toHaveLength(1);
	});
});
