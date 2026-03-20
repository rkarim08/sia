import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { promoteFailedSessions } from "@/decay/episodic-promoter";
import type { SiaDb } from "@/graph/db-interface";
import { openEpisodicDb, openGraphDb } from "@/graph/semantic-db";

function makeTmp(): string {
	const dir = join(tmpdir(), `sia-test-${randomUUID()}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

describe("episodic promoter", () => {
	let tmpDir: string;
	let graphDb: SiaDb | undefined;
	let episodicDb: SiaDb | undefined;

	afterEach(async () => {
		if (graphDb) {
			await graphDb.close();
			graphDb = undefined;
		}
		if (episodicDb) {
			await episodicDb.close();
			episodicDb = undefined;
		}
		if (tmpDir) {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	// ---------------------------------------------------------------
	// promotes failed session
	// ---------------------------------------------------------------

	it("promotes failed session", async () => {
		tmpDir = makeTmp();
		const repoHash = "ep-promote-failed";
		graphDb = openGraphDb(repoHash, tmpDir);
		episodicDb = openEpisodicDb(repoHash, tmpDir);

		const sessionId = randomUUID();
		const episodeId = randomUUID();
		const now = Date.now();

		// Insert episode into episodicDb
		await episodicDb.execute(
			"INSERT INTO episodes (id, session_id, ts, type, role, content, trust_tier) VALUES (?, ?, ?, 'conversation', 'assistant', ?, 3)",
			[
				episodeId,
				sessionId,
				now,
				"The authentication module uses JWT tokens with RS256 signing for all API endpoints",
			],
		);

		// Insert sessions_processed row with processing_status = 'failed'
		await episodicDb.execute(
			"INSERT INTO sessions_processed (session_id, processing_status, processed_at, entity_count, pipeline_version) VALUES (?, 'failed', ?, 0, 'v1')",
			[sessionId, now],
		);

		const promoted = await promoteFailedSessions(graphDb, episodicDb);
		expect(promoted).toBe(1);

		// Check sessions_processed -> status should now be 'complete'
		const { rows: sessionRows } = await episodicDb.execute(
			"SELECT processing_status FROM sessions_processed WHERE session_id = ?",
			[sessionId],
		);
		expect(sessionRows).toHaveLength(1);
		expect(sessionRows[0]?.processing_status).toBe("complete");

		// Check entities table in graphDb -> should have entities from the episode content
		const { rows: entityRows } = await graphDb.execute(
			"SELECT * FROM graph_nodes WHERE extraction_method = 'episodic-promoter'",
		);
		expect(entityRows.length).toBeGreaterThanOrEqual(1);
	});

	// ---------------------------------------------------------------
	// detects abrupt terminations (no sessions_processed row)
	// ---------------------------------------------------------------

	it("detects abrupt terminations (no sessions_processed row)", async () => {
		tmpDir = makeTmp();
		const repoHash = "ep-promote-orphan";
		graphDb = openGraphDb(repoHash, tmpDir);
		episodicDb = openEpisodicDb(repoHash, tmpDir);

		const sessionId = randomUUID();
		const episodeId = randomUUID();
		const now = Date.now();

		// Insert episodes but do NOT insert any sessions_processed row
		await episodicDb.execute(
			"INSERT INTO episodes (id, session_id, ts, type, role, content, trust_tier) VALUES (?, ?, ?, 'conversation', 'assistant', ?, 3)",
			[
				episodeId,
				sessionId,
				now,
				"Database connection pooling uses pgBouncer in transaction mode for optimal throughput",
			],
		);

		const promoted = await promoteFailedSessions(graphDb, episodicDb);
		expect(promoted).toBe(1);

		// Check sessions_processed -> should now have 'complete' row
		const { rows: sessionRows } = await episodicDb.execute(
			"SELECT processing_status FROM sessions_processed WHERE session_id = ?",
			[sessionId],
		);
		expect(sessionRows).toHaveLength(1);
		expect(sessionRows[0]?.processing_status).toBe("complete");
	});

	// ---------------------------------------------------------------
	// skips already-complete sessions
	// ---------------------------------------------------------------

	it("skips already-complete sessions", async () => {
		tmpDir = makeTmp();
		const repoHash = "ep-promote-skip";
		graphDb = openGraphDb(repoHash, tmpDir);
		episodicDb = openEpisodicDb(repoHash, tmpDir);

		const sessionId = randomUUID();
		const episodeId = randomUUID();
		const now = Date.now();

		// Insert episodes AND sessions_processed with processing_status = 'complete'
		await episodicDb.execute(
			"INSERT INTO episodes (id, session_id, ts, type, role, content, trust_tier) VALUES (?, ?, ?, 'conversation', 'assistant', ?, 3)",
			[
				episodeId,
				sessionId,
				now,
				"The caching layer uses Redis with a 5-minute TTL for user sessions",
			],
		);

		await episodicDb.execute(
			"INSERT INTO sessions_processed (session_id, processing_status, processed_at, entity_count, pipeline_version) VALUES (?, 'complete', ?, 1, 'v1')",
			[sessionId, now],
		);

		const promoted = await promoteFailedSessions(graphDb, episodicDb);
		expect(promoted).toBe(0);
	});

	// ---------------------------------------------------------------
	// handles empty episode content gracefully
	// ---------------------------------------------------------------

	it("handles empty episode content gracefully", async () => {
		tmpDir = makeTmp();
		const repoHash = "ep-promote-empty";
		graphDb = openGraphDb(repoHash, tmpDir);
		episodicDb = openEpisodicDb(repoHash, tmpDir);

		const sessionId = randomUUID();
		const episodeId = randomUUID();
		const now = Date.now();

		// Insert episode with empty content
		await episodicDb.execute(
			"INSERT INTO episodes (id, session_id, ts, type, role, content, trust_tier) VALUES (?, ?, ?, 'conversation', 'assistant', ?, 3)",
			[episodeId, sessionId, now, ""],
		);

		// No sessions_processed row, so it's treated as orphan
		const promoted = await promoteFailedSessions(graphDb, episodicDb);

		// Should not crash; returns 1 (session marked complete even if no candidates)
		expect(promoted).toBe(1);

		// Session should now be marked complete
		const { rows: sessionRows } = await episodicDb.execute(
			"SELECT processing_status FROM sessions_processed WHERE session_id = ?",
			[sessionId],
		);
		expect(sessionRows).toHaveLength(1);
		expect(sessionRows[0]?.processing_status).toBe("complete");
	});
});
