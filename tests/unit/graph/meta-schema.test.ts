import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SiaDb } from "@/graph/db-interface";
import { openMetaDb } from "@/graph/meta-db";

describe("meta.db schema (001_initial)", () => {
	let tmpDir: string;
	let db: SiaDb | undefined;

	function makeTmp(): string {
		const dir = join(tmpdir(), `sia-meta-test-${randomUUID()}`);
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
		db = openMetaDb(tmpDir);

		// If we get here, the migration applied successfully.
		const result = await db.execute("SELECT name FROM _migrations WHERE name = '001_initial.sql'");
		expect(result.rows).toHaveLength(1);
	});

	it("all 7 tables exist", async () => {
		tmpDir = makeTmp();
		db = openMetaDb(tmpDir);

		const expected = [
			"repos",
			"workspaces",
			"workspace_repos",
			"api_contracts",
			"sync_config",
			"sync_peers",
			"sharing_rules",
		];

		const result = await db.execute(
			"SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_%' ESCAPE '\\'",
		);
		const tableNames = result.rows.map((r) => r.name as string).sort();

		for (const table of expected) {
			expect(tableNames).toContain(table);
		}
		expect(tableNames).toHaveLength(expected.length);
	});

	it("FK constraints work: workspace_repos rejects invalid workspace_id", async () => {
		tmpDir = makeTmp();
		db = openMetaDb(tmpDir);

		// Insert a valid repo first.
		await db.execute("INSERT INTO repos (id, path, created_at) VALUES (?, ?, ?)", [
			"repo-1",
			"/tmp/repo",
			Date.now(),
		]);

		// Inserting into workspace_repos with a non-existent workspace_id should fail.
		await expect(
			db.execute("INSERT INTO workspace_repos (workspace_id, repo_id, role) VALUES (?, ?, ?)", [
				"non-existent-ws",
				"repo-1",
				"member",
			]),
		).rejects.toThrow();
	});

	it("sync_config initializes correctly with enabled=0", async () => {
		tmpDir = makeTmp();
		db = openMetaDb(tmpDir);

		// Insert a row relying on the DEFAULT values.
		await db.execute("INSERT INTO sync_config (id) VALUES (?)", ["default"]);

		const result = await db.execute("SELECT id, enabled FROM sync_config WHERE id = 'default'");
		expect(result.rows).toHaveLength(1);
		expect(result.rows[0]?.enabled).toBe(0);
	});

	it("sharing_rules FK references workspaces correctly", async () => {
		tmpDir = makeTmp();
		db = openMetaDb(tmpDir);

		// Insert a valid workspace.
		const wsId = randomUUID();
		await db.execute("INSERT INTO workspaces (id, name, created_at) VALUES (?, ?, ?)", [
			wsId,
			"test-workspace",
			Date.now(),
		]);

		// Insert a valid sharing rule referencing that workspace.
		await db.execute(
			"INSERT INTO sharing_rules (id, workspace_id, default_visibility, created_at) VALUES (?, ?, ?, ?)",
			["rule-1", wsId, "team", Date.now()],
		);

		const result = await db.execute(
			"SELECT id, workspace_id, default_visibility FROM sharing_rules WHERE id = 'rule-1'",
		);
		expect(result.rows).toHaveLength(1);
		expect(result.rows[0]?.workspace_id).toBe(wsId);
		expect(result.rows[0]?.default_visibility).toBe("team");

		// Insert with an invalid workspace_id should fail.
		await expect(
			db.execute(
				"INSERT INTO sharing_rules (id, workspace_id, default_visibility, created_at) VALUES (?, ?, ?, ?)",
				["rule-2", "non-existent-ws", "private", Date.now()],
			),
		).rejects.toThrow();
	});
});
