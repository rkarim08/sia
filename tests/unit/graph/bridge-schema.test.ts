import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openBridgeDb } from "@/graph/bridge-db";
import type { SiaDb } from "@/graph/db-interface";

describe("bridge.db schema", () => {
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

	it("schema applies without error", async () => {
		tmpDir = makeTmp();
		db = openBridgeDb(tmpDir);

		// If we get here without throwing, the migration applied successfully.
		const result = await db.execute(
			"SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'cross_repo_edges'",
		);
		expect(result.rows).toHaveLength(1);
	});

	it("cross_repo_edges table exists", async () => {
		tmpDir = makeTmp();
		db = openBridgeDb(tmpDir);

		const result = await db.execute(
			"SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'cross_repo_edges'",
		);
		expect(result.rows).toHaveLength(1);
		expect(result.rows[0]?.name).toBe("cross_repo_edges");
	});

	it("all four bi-temporal columns present", async () => {
		tmpDir = makeTmp();
		db = openBridgeDb(tmpDir);

		const result = await db.execute("PRAGMA table_info(cross_repo_edges)");
		const columnNames = result.rows.map((r) => r.name as string);

		expect(columnNames).toContain("t_created");
		expect(columnNames).toContain("t_expired");
		expect(columnNames).toContain("t_valid_from");
		expect(columnNames).toContain("t_valid_until");
	});

	it("both partial indexes created (idx_bridge_source, idx_bridge_target)", async () => {
		tmpDir = makeTmp();
		db = openBridgeDb(tmpDir);

		const result = await db.execute("SELECT name FROM sqlite_master WHERE type = 'index'");
		const indexNames = result.rows.map((r) => r.name as string);

		expect(indexNames).toContain("idx_bridge_source");
		expect(indexNames).toContain("idx_bridge_target");
	});

	it("t_valid_from and t_expired are present (regression check from v3)", async () => {
		tmpDir = makeTmp();
		db = openBridgeDb(tmpDir);

		const result = await db.execute("PRAGMA table_info(cross_repo_edges)");
		const columnNames = result.rows.map((r) => r.name as string);

		// These columns were missing in v3 — this test guards against regression.
		expect(columnNames).toContain("t_valid_from");
		expect(columnNames).toContain("t_expired");
	});
});
