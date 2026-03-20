import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryDb, LibSqlDb, type SiaDb } from "@/graph/db-interface";

describe("BunSqliteDb", () => {
	let db: SiaDb;

	afterEach(async () => {
		await db.close();
	});

	function setup(): SiaDb {
		db = createMemoryDb();
		return db;
	}

	it("execute INSERT and SELECT", async () => {
		setup();
		await db.execute("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)");
		await db.execute("INSERT INTO test (id, name) VALUES (?, ?)", [1, "alice"]);
		const result = await db.execute("SELECT * FROM test WHERE id = ?", [1]);
		expect(result.rows).toHaveLength(1);
		expect(result.rows[0]).toEqual({ id: 1, name: "alice" });
	});

	it("execute SELECT with no params", async () => {
		setup();
		await db.execute("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)");
		await db.execute("INSERT INTO test (id, name) VALUES (?, ?)", [1, "bob"]);
		await db.execute("INSERT INTO test (id, name) VALUES (?, ?)", [2, "carol"]);
		const result = await db.execute("SELECT * FROM test");
		expect(result.rows).toHaveLength(2);
	});

	it("executeMany runs multiple statements", async () => {
		setup();
		await db.execute("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)");
		await db.executeMany([
			{ sql: "INSERT INTO test (id, name) VALUES (?, ?)", params: [1, "alice"] },
			{ sql: "INSERT INTO test (id, name) VALUES (?, ?)", params: [2, "bob"] },
			{ sql: "INSERT INTO test (id, name) VALUES (?, ?)", params: [3, "carol"] },
		]);
		const result = await db.execute("SELECT * FROM test");
		expect(result.rows).toHaveLength(3);
	});

	it("transaction commits on success", async () => {
		setup();
		await db.execute("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)");
		await db.transaction(async (tx) => {
			await tx.execute("INSERT INTO test (id, name) VALUES (?, ?)", [1, "alice"]);
			await tx.execute("INSERT INTO test (id, name) VALUES (?, ?)", [2, "bob"]);
		});
		const result = await db.execute("SELECT * FROM test");
		expect(result.rows).toHaveLength(2);
	});

	it("transaction rolls back on error", async () => {
		setup();
		await db.execute("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)");
		await expect(
			db.transaction(async (tx) => {
				await tx.execute("INSERT INTO test (id, name) VALUES (?, ?)", [1, "alice"]);
				throw new Error("Boom");
			}),
		).rejects.toThrow("Boom");
		const result = await db.execute("SELECT * FROM test");
		expect(result.rows).toHaveLength(0);
	});

	it("nested transaction throws 'Nested transactions not supported'", async () => {
		setup();
		await db.execute("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)");
		await expect(
			db.transaction(async (tx) => {
				await tx.transaction(async () => {});
			}),
		).rejects.toThrow("Nested transactions not supported");
	});

	it("executeMany is atomic — rolls back all rows on mid-batch failure", async () => {
		setup();
		await db.execute("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)");
		// Pre-insert id=2 so the second INSERT in the batch will fail with a PK conflict
		await db.execute("INSERT INTO test (id, name) VALUES (?, ?)", [2, "existing"]);
		await expect(
			db.executeMany([
				{ sql: "INSERT INTO test (id, name) VALUES (?, ?)", params: [1, "alice"] },
				{ sql: "INSERT INTO test (id, name) VALUES (?, ?)", params: [2, "duplicate"] },
			]),
		).rejects.toThrow();
		// The first row (id=1) must have been rolled back — only id=2 (pre-existing) remains
		const result = await db.execute("SELECT * FROM test");
		expect(result.rows).toHaveLength(1);
		expect(result.rows[0]).toMatchObject({ id: 2, name: "existing" });
	});

	it("rawSqlite returns the underlying Database", () => {
		setup();
		const underlying = db.rawSqlite();
		expect(underlying).not.toBeNull();
		expect(underlying).toHaveProperty("prepare");
		expect(underlying).toHaveProperty("close");
	});
});

describe("LibSqlDb", () => {
	it("executeMany passes 'write' as the batch mode", async () => {
		const batchMock = vi.fn().mockResolvedValue(undefined);
		const mockClient = {
			execute: vi.fn().mockResolvedValue({ rows: [] }),
			batch: batchMock,
		};

		const libSqlDb = new LibSqlDb(mockClient);
		await libSqlDb.executeMany([
			{ sql: "INSERT INTO test VALUES (?)", params: [1] },
			{ sql: "INSERT INTO test VALUES (?)", params: [2] },
		]);

		expect(batchMock).toHaveBeenCalledOnce();
		const [_stmts, mode] = batchMock.mock.calls[0];
		expect(mode).toBe("write");
	});
});
