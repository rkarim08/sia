import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SiaDb } from "@/graph/db-interface";
import { openEpisodicDb } from "@/graph/semantic-db";

describe("episodic.db schema (001_initial)", () => {
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

	it("schema applies without error", () => {
		tmpDir = makeTmp();
		// openEpisodicDb runs migrations; should not throw.
		db = openEpisodicDb("test-repo", tmpDir);
		expect(db).toBeDefined();
	});

	it("episodes table exists", async () => {
		tmpDir = makeTmp();
		db = openEpisodicDb("test-repo", tmpDir);

		const result = await db.execute(
			"SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'episodes'",
		);
		expect(result.rows).toHaveLength(1);
		expect(result.rows[0]?.name).toBe("episodes");
	});

	it("episodes_fts is queryable (insert episode then FTS5 MATCH finds it)", async () => {
		tmpDir = makeTmp();
		db = openEpisodicDb("test-repo", tmpDir);

		// Insert an episode row.
		const id = randomUUID();
		await db.execute(
			`INSERT INTO episodes (id, session_id, ts, type, content, tool_name, file_path, trust_tier)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			[id, "sess-1", Date.now(), "conversation", "refactored the parser module", null, null, 3],
		);

		// Manually sync the FTS content table (content-sync triggers are not
		// automatic for external-content FTS5 tables — the caller must populate).
		const raw = db.rawSqlite();
		expect(raw).toBeDefined();
		raw
			?.prepare(
				`INSERT INTO episodes_fts (rowid, content, file_path, tool_name)
			 SELECT rowid, content, file_path, tool_name FROM episodes WHERE id = ?`,
			)
			.run(id);

		// FTS5 MATCH query should find the row.
		const fts = await db.execute("SELECT rowid FROM episodes_fts WHERE episodes_fts MATCH ?", [
			"parser",
		]);
		expect(fts.rows.length).toBeGreaterThanOrEqual(1);
	});

	it("sessions_processed table exists with correct columns", async () => {
		tmpDir = makeTmp();
		db = openEpisodicDb("test-repo", tmpDir);

		const result = await db.execute(
			"SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sessions_processed'",
		);
		expect(result.rows).toHaveLength(1);
		expect(result.rows[0]?.name).toBe("sessions_processed");

		// Verify column names via PRAGMA table_info.
		const cols = await db.execute("PRAGMA table_info(sessions_processed)");
		const colNames = cols.rows.map((r) => r.name as string);
		expect(colNames).toContain("session_id");
		expect(colNames).toContain("processing_status");
		expect(colNames).toContain("processed_at");
		expect(colNames).toContain("entity_count");
		expect(colNames).toContain("pipeline_version");
	});
});
