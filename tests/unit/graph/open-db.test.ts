import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BunSqliteDb, openDb, openSiaDb } from "@/graph/db-interface";
import { DEFAULT_SYNC_CONFIG, type SyncConfig } from "@/shared/config";

describe("openDb", () => {
	let tempDir: string;

	afterEach(() => {
		if (tempDir && existsSync(tempDir)) {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	function makeTempDir(): string {
		tempDir = mkdtempSync(join(tmpdir(), "sia-opendb-"));
		return tempDir;
	}

	it("creates database file in test directory", async () => {
		const home = makeTempDir();
		const repoHash = "abc123";
		const db = openDb(repoHash, { siaHome: home });

		const expectedPath = join(home, "repos", repoHash, "graph.db");
		expect(existsSync(expectedPath)).toBe(true);

		await db.close();
	});

	it("sets WAL mode", async () => {
		const home = makeTempDir();
		const db = openDb("wal-test", { siaHome: home });

		const result = await db.execute("PRAGMA journal_mode");
		expect(result.rows[0]).toHaveProperty("journal_mode", "wal");

		await db.close();
	});

	it("sets foreign_keys ON", async () => {
		const home = makeTempDir();
		const db = openDb("fk-test", { siaHome: home });

		const result = await db.execute("PRAGMA foreign_keys");
		expect(result.rows[0]).toHaveProperty("foreign_keys", 1);

		await db.close();
	});

	it("readonly does not crash", async () => {
		const home = makeTempDir();
		// First create the database so it exists on disk
		const writable = openDb("ro-test", { siaHome: home });
		await writable.close();

		// Now open readonly — should not throw
		const ro = openDb("ro-test", { siaHome: home, readonly: true });
		expect(ro).toBeInstanceOf(BunSqliteDb);
		await ro.close();
	});
});

describe("openSiaDb", () => {
	let tempDir: string;

	afterEach(() => {
		if (tempDir && existsSync(tempDir)) {
			rmSync(tempDir, { recursive: true, force: true });
		}
	});

	function makeTempDir(): string {
		tempDir = mkdtempSync(join(tmpdir(), "sia-opensia-"));
		return tempDir;
	}

	it("returns BunSqliteDb when sync disabled", async () => {
		const home = makeTempDir();
		const db = await openSiaDb("sync-off", DEFAULT_SYNC_CONFIG, { siaHome: home });
		expect(db).toBeInstanceOf(BunSqliteDb);
		await db.close();
	});

	it("returns BunSqliteDb when sync enabled but no serverUrl", async () => {
		const home = makeTempDir();
		const config: SyncConfig = {
			enabled: true,
			serverUrl: null,
			developerId: null,
			syncInterval: 30,
		};
		const db = await openSiaDb("sync-no-url", config, { siaHome: home });
		expect(db).toBeInstanceOf(BunSqliteDb);
		await db.close();
	});
});
