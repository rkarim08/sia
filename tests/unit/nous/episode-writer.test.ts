import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SiaDb } from "@/graph/db-interface";
import { openGraphDb } from "@/graph/semantic-db";
import { writeEpisode } from "@/nous/episode-writer";
import { DEFAULT_SESSION_STATE } from "@/nous/types";
import { getSession, upsertSession } from "@/nous/working-memory";

function makeTmp() {
	return join(tmpdir(), `nous-ep-${randomUUID()}`);
}

describe("episode-writer", () => {
	let db: SiaDb | undefined;
	let tmpDir = "";

	afterEach(async () => {
		await db?.close();
		db = undefined;
		if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
		tmpDir = "";
	});

	it("writes an Episode node for primary sessions and deletes the session row", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("test-ep1", tmpDir);

		const now = Math.floor(Date.now() / 1000);
		upsertSession(db, {
			session_id: "ep-sess-1",
			parent_session_id: null,
			session_type: "primary",
			state: { ...DEFAULT_SESSION_STATE, driftScore: 0.3, toolCallCount: 5 },
			created_at: now,
			updated_at: now,
		});

		await writeEpisode(db, "ep-sess-1");

		// Session row should be deleted
		expect(getSession(db, "ep-sess-1")).toBeNull();

		// Episode node should exist
		const raw = db.rawSqlite();
		expect(raw).not.toBeNull();
		const episode = raw
			?.prepare("SELECT * FROM graph_nodes WHERE kind = 'Episode' AND captured_by_session_id = ?")
			.get("ep-sess-1") as Record<string, unknown> | undefined;
		expect(episode).toBeDefined();
		expect(episode?.trust_tier).toBe(2);
	});

	it("skips Episode write for subagent sessions", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("test-ep2", tmpDir);

		const now = Math.floor(Date.now() / 1000);
		upsertSession(db, {
			session_id: "ep-sess-2",
			parent_session_id: "parent-sess",
			session_type: "subagent",
			state: { ...DEFAULT_SESSION_STATE },
			created_at: now,
			updated_at: now,
		});

		await writeEpisode(db, "ep-sess-2");

		// Session row should be deleted
		expect(getSession(db, "ep-sess-2")).toBeNull();

		// No Episode node for subagents
		const raw = db.rawSqlite();
		const episode = raw
			?.prepare("SELECT * FROM graph_nodes WHERE kind = 'Episode' AND captured_by_session_id = ?")
			.get("ep-sess-2");
		expect(episode).toBeUndefined();
	});

	it("does nothing if session not found", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("test-ep3", tmpDir);
		await expect(writeEpisode(db, "nonexistent")).resolves.toBeUndefined();
	});
});
