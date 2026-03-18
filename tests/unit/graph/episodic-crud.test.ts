import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SiaDb } from "@/graph/db-interface";
import {
	getEpisodesBySession,
	getRecentEpisodes,
	getUnprocessedSessions,
	insertEpisode,
	markSessionProcessed,
	openEpisodicDb,
} from "@/graph/episodic-db";

describe("episodic CRUD layer", () => {
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

	// ---------------------------------------------------------------
	// Insert and retrieve episode round-trip
	// ---------------------------------------------------------------

	it("insert and retrieve episode round-trip", async () => {
		tmpDir = makeTmp();
		db = openEpisodicDb("ep-roundtrip", tmpDir);

		const episode = await insertEpisode(db, {
			session_id: "session-abc",
			type: "conversation",
			role: "user",
			content: "Hello, world!",
		});

		expect(episode.id).toBeDefined();
		expect(episode.session_id).toBe("session-abc");
		expect(episode.type).toBe("conversation");
		expect(episode.role).toBe("user");
		expect(episode.content).toBe("Hello, world!");
		expect(episode.ts).toBeGreaterThan(0);
		expect(episode.tool_name).toBeNull();
		expect(episode.file_path).toBeNull();
		expect(episode.trust_tier).toBe(3);
	});

	it("insert episode with optional fields", async () => {
		tmpDir = makeTmp();
		db = openEpisodicDb("ep-optional", tmpDir);

		const episode = await insertEpisode(db, {
			session_id: "session-xyz",
			type: "tool_use",
			role: "assistant",
			content: "Running bash command",
			tool_name: "bash",
			file_path: "/some/path.ts",
			trust_tier: 1,
		});

		expect(episode.tool_name).toBe("bash");
		expect(episode.file_path).toBe("/some/path.ts");
		expect(episode.trust_tier).toBe(1);
		expect(episode.role).toBe("assistant");
	});

	// ---------------------------------------------------------------
	// getEpisodesBySession returns ordered results, filters by session
	// ---------------------------------------------------------------

	it("getEpisodesBySession returns episodes ordered by ts ASC", async () => {
		tmpDir = makeTmp();
		db = openEpisodicDb("ep-by-session", tmpDir);

		const sessionId = "session-order-test";

		// Insert three episodes with slight delays to ensure distinct timestamps
		const ep1 = await insertEpisode(db, {
			session_id: sessionId,
			type: "conversation",
			role: "user",
			content: "First message",
		});

		const ep2 = await insertEpisode(db, {
			session_id: sessionId,
			type: "conversation",
			role: "assistant",
			content: "Second message",
		});

		const ep3 = await insertEpisode(db, {
			session_id: sessionId,
			type: "tool_use",
			role: "assistant",
			content: "Third message",
			tool_name: "read_file",
		});

		const episodes = await getEpisodesBySession(db, sessionId);
		expect(episodes).toHaveLength(3);

		// Verify order is ascending by ts
		expect(episodes[0]?.id).toBe(ep1.id);
		expect(episodes[1]?.id).toBe(ep2.id);
		expect(episodes[2]?.id).toBe(ep3.id);

		// Verify ts is in ascending order (or at least non-descending)
		expect(episodes[0]?.ts).toBeLessThanOrEqual(episodes[1]?.ts ?? 0);
		expect(episodes[1]?.ts).toBeLessThanOrEqual(episodes[2]?.ts ?? 0);
	});

	it("getEpisodesBySession filters by session ID", async () => {
		tmpDir = makeTmp();
		db = openEpisodicDb("ep-filter-session", tmpDir);

		await insertEpisode(db, {
			session_id: "session-A",
			type: "conversation",
			role: "user",
			content: "Message in session A",
		});

		await insertEpisode(db, {
			session_id: "session-B",
			type: "conversation",
			role: "user",
			content: "Message in session B",
		});

		await insertEpisode(db, {
			session_id: "session-A",
			type: "conversation",
			role: "assistant",
			content: "Reply in session A",
		});

		const sessionA = await getEpisodesBySession(db, "session-A");
		expect(sessionA).toHaveLength(2);
		for (const ep of sessionA) {
			expect(ep.session_id).toBe("session-A");
		}

		const sessionB = await getEpisodesBySession(db, "session-B");
		expect(sessionB).toHaveLength(1);
		expect(sessionB[0]?.session_id).toBe("session-B");

		const sessionC = await getEpisodesBySession(db, "session-C");
		expect(sessionC).toHaveLength(0);
	});

	// ---------------------------------------------------------------
	// getRecentEpisodes respects limit
	// ---------------------------------------------------------------

	it("getRecentEpisodes returns episodes ordered by ts DESC", async () => {
		tmpDir = makeTmp();
		db = openEpisodicDb("ep-recent", tmpDir);

		const ids: string[] = [];
		for (let i = 0; i < 5; i++) {
			const ep = await insertEpisode(db, {
				session_id: `session-${i}`,
				type: "conversation",
				role: "user",
				content: `Episode number ${i}`,
			});
			ids.push(ep.id);
		}

		const recent = await getRecentEpisodes(db, 3);
		expect(recent).toHaveLength(3);

		// Should be in descending ts order (most recent first)
		expect(recent[0]?.ts).toBeGreaterThanOrEqual(recent[1]?.ts ?? 0);
		expect(recent[1]?.ts).toBeGreaterThanOrEqual(recent[2]?.ts ?? 0);
	});

	it("getRecentEpisodes uses default limit of 20", async () => {
		tmpDir = makeTmp();
		db = openEpisodicDb("ep-recent-default", tmpDir);

		// Insert 25 episodes
		for (let i = 0; i < 25; i++) {
			await insertEpisode(db, {
				session_id: `session-${i}`,
				type: "conversation",
				role: "user",
				content: `Episode ${i}`,
			});
		}

		const recent = await getRecentEpisodes(db);
		expect(recent).toHaveLength(20);
	});

	it("getRecentEpisodes returns all episodes when fewer than limit exist", async () => {
		tmpDir = makeTmp();
		db = openEpisodicDb("ep-recent-few", tmpDir);

		for (let i = 0; i < 5; i++) {
			await insertEpisode(db, {
				session_id: "session-X",
				type: "conversation",
				role: "user",
				content: `Episode ${i}`,
			});
		}

		const recent = await getRecentEpisodes(db, 20);
		expect(recent).toHaveLength(5);
	});

	// ---------------------------------------------------------------
	// markSessionProcessed + getUnprocessedSessions
	// ---------------------------------------------------------------

	it("processed sessions are excluded from getUnprocessedSessions", async () => {
		tmpDir = makeTmp();
		db = openEpisodicDb("ep-unprocessed-1", tmpDir);

		await insertEpisode(db, {
			session_id: "session-done",
			type: "conversation",
			role: "user",
			content: "A message",
		});

		await markSessionProcessed(db, "session-done", "complete", 5);

		const unprocessed = await getUnprocessedSessions(db);
		expect(unprocessed).not.toContain("session-done");
		expect(unprocessed).toHaveLength(0);
	});

	it("failed sessions are included in getUnprocessedSessions", async () => {
		tmpDir = makeTmp();
		db = openEpisodicDb("ep-unprocessed-2", tmpDir);

		await insertEpisode(db, {
			session_id: "session-failed",
			type: "conversation",
			role: "user",
			content: "A message",
		});

		await markSessionProcessed(db, "session-failed", "failed", 0);

		const unprocessed = await getUnprocessedSessions(db);
		expect(unprocessed).toContain("session-failed");
		expect(unprocessed).toHaveLength(1);
	});

	it("unprocessed sessions are included in getUnprocessedSessions", async () => {
		tmpDir = makeTmp();
		db = openEpisodicDb("ep-unprocessed-3", tmpDir);

		await insertEpisode(db, {
			session_id: "session-unprocessed",
			type: "conversation",
			role: "user",
			content: "A message",
		});

		const unprocessed = await getUnprocessedSessions(db);
		expect(unprocessed).toContain("session-unprocessed");
		expect(unprocessed).toHaveLength(1);
	});

	it("getUnprocessedSessions handles mixed session states correctly", async () => {
		tmpDir = makeTmp();
		db = openEpisodicDb("ep-unprocessed-mixed", tmpDir);

		// Insert episodes for three sessions
		await insertEpisode(db, {
			session_id: "session-complete",
			type: "conversation",
			role: "user",
			content: "Complete session",
		});
		await insertEpisode(db, {
			session_id: "session-failed",
			type: "conversation",
			role: "user",
			content: "Failed session",
		});
		await insertEpisode(db, {
			session_id: "session-never-processed",
			type: "conversation",
			role: "user",
			content: "Never processed session",
		});

		// Mark complete and failed
		await markSessionProcessed(db, "session-complete", "complete", 10);
		await markSessionProcessed(db, "session-failed", "failed", 0);

		const unprocessed = await getUnprocessedSessions(db);

		// complete session should be excluded
		expect(unprocessed).not.toContain("session-complete");

		// failed and never-processed should be included
		expect(unprocessed).toContain("session-failed");
		expect(unprocessed).toContain("session-never-processed");
		expect(unprocessed).toHaveLength(2);
	});

	it("markSessionProcessed with pipeline_version is stored", async () => {
		tmpDir = makeTmp();
		db = openEpisodicDb("ep-pipeline-ver", tmpDir);

		await insertEpisode(db, {
			session_id: "session-pv",
			type: "conversation",
			role: "user",
			content: "With pipeline version",
		});

		await markSessionProcessed(db, "session-pv", "complete", 7, "2.0.0");

		const result = await db.execute(
			"SELECT pipeline_version FROM sessions_processed WHERE session_id = ?",
			["session-pv"],
		);
		expect(result.rows[0]?.pipeline_version).toBe("2.0.0");
	});

	it("markSessionProcessed uses default pipeline_version of 1.0.0", async () => {
		tmpDir = makeTmp();
		db = openEpisodicDb("ep-pipeline-default", tmpDir);

		await insertEpisode(db, {
			session_id: "session-pv-default",
			type: "conversation",
			role: "user",
			content: "Default pipeline version",
		});

		await markSessionProcessed(db, "session-pv-default", "complete", 3);

		const result = await db.execute(
			"SELECT pipeline_version FROM sessions_processed WHERE session_id = ?",
			["session-pv-default"],
		);
		expect(result.rows[0]?.pipeline_version).toBe("1.0.0");
	});

	it("markSessionProcessed upserts when called twice", async () => {
		tmpDir = makeTmp();
		db = openEpisodicDb("ep-upsert", tmpDir);

		await insertEpisode(db, {
			session_id: "session-upsert",
			type: "conversation",
			role: "user",
			content: "Upsert test",
		});

		await markSessionProcessed(db, "session-upsert", "failed", 0);
		await markSessionProcessed(db, "session-upsert", "complete", 5, "1.1.0");

		const result = await db.execute(
			"SELECT processing_status, entity_count, pipeline_version FROM sessions_processed WHERE session_id = ?",
			["session-upsert"],
		);
		expect(result.rows).toHaveLength(1);
		expect(result.rows[0]?.processing_status).toBe("complete");
		expect(result.rows[0]?.entity_count).toBe(5);
		expect(result.rows[0]?.pipeline_version).toBe("1.1.0");

		// After upsert to complete, session should be excluded from unprocessed
		const unprocessed = await getUnprocessedSessions(db);
		expect(unprocessed).not.toContain("session-upsert");
	});
});
