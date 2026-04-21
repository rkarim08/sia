// Phase 1 integration test — exercises the full Nous hook chain against an
// in-memory graph database. Verifies that SessionStart creates a session,
// PreToolUse/PostToolUse update working memory, and Stop writes an Episode.

import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SiaDb } from "@/graph/db-interface";
import { openGraphDb } from "@/graph/semantic-db";
import { runDiscomfortSignal } from "@/nous/discomfort-signal";
import { writeEpisode } from "@/nous/episode-writer";
import { runSessionStart } from "@/nous/self-monitor";
import { runSignificanceDetector } from "@/nous/significance-detector";
import { runSurpriseRouter } from "@/nous/surprise-router";
import { getSession } from "@/nous/working-memory";

function makeTmp() {
	return join(tmpdir(), `nous-phase1-${randomUUID()}`);
}

describe("nous Phase 1 integration", () => {
	let db: SiaDb | undefined;
	let tmpDir = "";

	afterEach(async () => {
		await db?.close();
		db = undefined;
		if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
		tmpDir = "";
	});

	it("runs the full hook chain: SessionStart → PreToolUse → PostToolUse → Stop", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("phase1", tmpDir);
		const raw = db.rawSqlite();
		expect(raw).not.toBeNull();
		if (!raw) return;

		const sessionId = "integration-sess-1";

		// 1. SessionStart — creates the session row and emits a baseline drift=0.
		const startResult = await runSessionStart(db, {
			session_id: sessionId,
			cwd: "/tmp/fake",
		});
		expect(startResult.session.session_id).toBe(sessionId);
		expect(startResult.driftWarning).toBeNull();

		// 2. PreToolUse — Write call bumps significance to 1.0.
		runSignificanceDetector(db, sessionId, "Write", { file_path: "/fake/file.ts" });
		let session = getSession(db, sessionId);
		expect(session?.state.currentCallSignificance).toBe(1.0);
		expect(session?.state.toolCallCount).toBe(1);

		// 3. PostToolUse — an approval-seeking response at high significance
		//    should fire a Signal node and append a discomfort history row.
		const discomfort = runDiscomfortSignal(
			db,
			sessionId,
			"You're absolutely right, I apologize for the confusion. That was a great point and I stand corrected.",
		);
		expect(discomfort.signalFired).toBe(true);
		expect(discomfort.signalNodeId).toBeDefined();

		// Surprise router is still a Phase 1 stub.
		const surprise = runSurpriseRouter(db, sessionId, "output");
		expect(surprise.surpriseDetected).toBe(false);

		// Verify Signal node persisted with session provenance fields.
		const signals = raw
			.prepare(
				"SELECT id, kind, captured_by_session_id, captured_by_session_type FROM graph_nodes WHERE kind = 'Signal' AND captured_by_session_id = ?",
			)
			.all(sessionId) as Array<Record<string, unknown>>;
		expect(signals.length).toBe(1);
		expect(signals[0].captured_by_session_type).toBe("primary");

		// discomfortRunningScore should have been updated from the signal call.
		session = getSession(db, sessionId);
		expect(session?.state.discomfortRunningScore).toBeGreaterThan(0.6);

		// 4. Stop — writes an Episode node and deletes the session row.
		await writeEpisode(db, sessionId);
		expect(getSession(db, sessionId)).toBeNull();

		const episode = raw
			.prepare(
				"SELECT * FROM graph_nodes WHERE kind = 'Episode' AND captured_by_session_id = ?",
			)
			.get(sessionId) as Record<string, unknown> | undefined;
		expect(episode).toBeDefined();
		expect(episode?.captured_by_session_type).toBe("primary");
		expect((episode?.content as string).includes("Signal nodes written: 1")).toBe(true);

		// 5. History contains both the initial drift entry and a discomfort entry.
		const history = raw
			.prepare("SELECT event_type FROM nous_history ORDER BY id")
			.all() as Array<{ event_type: string }>;
		const events = history.map((h) => h.event_type);
		expect(events).toContain("drift");
		expect(events).toContain("discomfort");
	});

	it("subagent sessions skip Episode creation but still clean up working memory", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("phase1-subagent", tmpDir);
		const raw = db.rawSqlite();
		if (!raw) return;

		// Seed a primary session first so the next session is detected as a subagent.
		const now = Math.floor(Date.now() / 1000);
		await runSessionStart(db, { session_id: "primary-owner", cwd: "/tmp" });
		// Force primary-owner to look recent so the subagent detection fires.
		raw.prepare("UPDATE nous_sessions SET updated_at = ? WHERE session_id = ?").run(
			now,
			"primary-owner",
		);

		const subResult = await runSessionStart(db, {
			session_id: "subagent-1",
			cwd: "/tmp",
		});
		expect(subResult.session.session_type).toBe("subagent");

		await writeEpisode(db, "subagent-1");
		expect(getSession(db, "subagent-1")).toBeNull();

		const episode = raw
			.prepare(
				"SELECT * FROM graph_nodes WHERE kind = 'Episode' AND captured_by_session_id = ?",
			)
			.get("subagent-1");
		expect(episode).toBeUndefined();
	});
});
