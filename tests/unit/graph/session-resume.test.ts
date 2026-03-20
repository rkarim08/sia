import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SiaDb } from "@/graph/db-interface";
import { openGraphDb } from "@/graph/semantic-db";
import { deleteResume, loadSubgraph, saveSubgraph } from "@/graph/session-resume";

const CREATE_SESSION_RESUME_TABLE = `
	CREATE TABLE IF NOT EXISTS session_resume (
		session_id    TEXT PRIMARY KEY,
		subgraph_json TEXT NOT NULL,
		last_prompt   TEXT,
		budget_used   INTEGER DEFAULT 0,
		created_at    INTEGER NOT NULL,
		updated_at    INTEGER NOT NULL
	)
`;

describe("session-resume CRUD", () => {
	let tmpDir: string;
	let db: SiaDb | undefined;

	function makeTmp(): string {
		const dir = join(tmpdir(), `sia-test-${randomUUID()}`);
		mkdirSync(dir, { recursive: true });
		return dir;
	}

	beforeEach(async () => {
		tmpDir = makeTmp();
		db = openGraphDb(`resume-${randomUUID()}`, tmpDir);
		// Manually create the table — migration comes in a future task
		await db.execute(CREATE_SESSION_RESUME_TABLE);
	});

	afterEach(async () => {
		if (db) {
			await db.close();
			db = undefined;
		}
		if (tmpDir) {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	// -----------------------------------------------------------------------
	// round-trip: save → load → verify all fields
	// -----------------------------------------------------------------------

	it("saves and loads a session resume record (round-trip)", async () => {
		const sessionId = "sess-roundtrip";
		const subgraphJson = JSON.stringify({ nodes: ["A", "B"], edges: [["A", "B"]] });
		const lastPrompt = "What files changed?";
		const budgetUsed = 42;

		await saveSubgraph(db!, sessionId, subgraphJson, lastPrompt, budgetUsed);

		const row = await loadSubgraph(db!, sessionId);

		expect(row).not.toBeNull();
		expect(row?.subgraph_json).toBe(subgraphJson);
		expect(row?.last_prompt).toBe(lastPrompt);
		expect(row?.budget_used).toBe(budgetUsed);
	});

	// -----------------------------------------------------------------------
	// round-trip with null last_prompt
	// -----------------------------------------------------------------------

	it("saves and loads with null last_prompt", async () => {
		const sessionId = "sess-null-prompt";

		await saveSubgraph(db!, sessionId, "{}", null, 0);

		const row = await loadSubgraph(db!, sessionId);

		expect(row).not.toBeNull();
		expect(row?.last_prompt).toBeNull();
		expect(row?.budget_used).toBe(0);
	});

	// -----------------------------------------------------------------------
	// upsert: save twice with same session_id → load returns latest data
	// -----------------------------------------------------------------------

	it("upserts: second save overwrites the first for the same session_id", async () => {
		const sessionId = "sess-upsert";

		await saveSubgraph(db!, sessionId, '{"first":true}', "initial prompt", 10);
		await saveSubgraph(db!, sessionId, '{"second":true}', "updated prompt", 99);

		const row = await loadSubgraph(db!, sessionId);

		expect(row).not.toBeNull();
		expect(row?.subgraph_json).toBe('{"second":true}');
		expect(row?.last_prompt).toBe("updated prompt");
		expect(row?.budget_used).toBe(99);
	});

	// -----------------------------------------------------------------------
	// upsert does not create duplicate rows
	// -----------------------------------------------------------------------

	it("upsert does not create duplicate rows", async () => {
		const sessionId = "sess-no-dupe";

		await saveSubgraph(db!, sessionId, '{"v":1}', null, 0);
		await saveSubgraph(db!, sessionId, '{"v":2}', null, 0);

		const result = await db?.execute(
			"SELECT COUNT(*) as cnt FROM session_resume WHERE session_id = ?",
			[sessionId],
		);
		expect(result.rows[0]?.cnt).toBe(1);
	});

	// -----------------------------------------------------------------------
	// delete: save → delete → load returns null
	// -----------------------------------------------------------------------

	it("delete removes the record so loadSubgraph returns null", async () => {
		const sessionId = "sess-delete";

		await saveSubgraph(db!, sessionId, '{"data":1}', "some prompt", 7);

		// Confirm it exists first
		const before = await loadSubgraph(db!, sessionId);
		expect(before).not.toBeNull();

		await deleteResume(db!, sessionId);

		const after = await loadSubgraph(db!, sessionId);
		expect(after).toBeNull();
	});

	// -----------------------------------------------------------------------
	// load non-existent: returns null
	// -----------------------------------------------------------------------

	it("loadSubgraph returns null for a session_id that was never saved", async () => {
		const row = await loadSubgraph(db!, "sess-does-not-exist");
		expect(row).toBeNull();
	});

	// -----------------------------------------------------------------------
	// deleteResume on non-existent row is a no-op (no error)
	// -----------------------------------------------------------------------

	it("deleteResume on a non-existent row does not throw", async () => {
		await expect(deleteResume(db!, "sess-ghost")).resolves.toBeUndefined();
	});
});
