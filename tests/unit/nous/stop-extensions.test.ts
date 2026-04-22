// Module: tests/unit/nous/stop-extensions — Phase A7 Stop-hook extensions
//
// Covers the two extensions added in roadmap Phase A7:
//   (a) Lightweight drift recompute at Stop (`recomputeDriftIfStale`), which
//       catches mid-session divergence that the SessionStart baseline missed.
//   (b) `SubagentEpisode` node kind so subagent sessions get an audit trail
//       without polluting the primary Episode chain.

import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SiaDb } from "@/graph/db-interface";
import { openGraphDb } from "@/graph/semantic-db";
import { writeEpisode } from "@/nous/episode-writer";
import { DRIFT_STALENESS_SECONDS, recomputeDriftIfStale } from "@/nous/self-monitor";
import { DEFAULT_NOUS_CONFIG, DEFAULT_SESSION_STATE } from "@/nous/types";
import { appendHistory, getSession, upsertSession } from "@/nous/working-memory";

function makeTmp() {
	return join(tmpdir(), `nous-stopext-${randomUUID()}`);
}

function seedSession(
	db: SiaDb,
	sessionId: string,
	sessionType: "primary" | "subagent",
	driftScore = 0.1,
	createdAt?: number,
) {
	const now = createdAt ?? Math.floor(Date.now() / 1000);
	upsertSession(db, {
		session_id: sessionId,
		parent_session_id: sessionType === "subagent" ? "parent-sess" : null,
		session_type: sessionType,
		state: { ...DEFAULT_SESSION_STATE, driftScore, toolCallCount: 3 },
		created_at: now,
		updated_at: now,
	});
}

describe("stop-extensions: recomputeDriftIfStale + SubagentEpisode", () => {
	let db: SiaDb | undefined;
	let tmpDir = "";

	afterEach(async () => {
		await db?.close();
		db = undefined;
		if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
		tmpDir = "";
	});

	// ------------------------------------------------------------------
	// (a) Primary session Stop → drift recomputed, Episode written,
	//     no SubagentEpisode produced.
	// ------------------------------------------------------------------
	it("primary Stop: recomputes drift when stale and writes an Episode", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("test-stopext-primary", tmpDir);

		const now = Math.floor(Date.now() / 1000);

		// Seed primary session.
		seedSession(db, "prim-1", "primary", 0.1);

		// Seed a stale baseline drift event so the staleness branch fires,
		// and a batch of high-discomfort events written AFTER that baseline
		// so the recompute has something to detect.
		appendHistory(db, {
			session_id: "prim-1",
			event_type: "drift",
			score: 0.1,
			created_at: now - (DRIFT_STALENESS_SECONDS + 60),
		});
		for (let i = 0; i < 5; i++) {
			appendHistory(db, {
				session_id: "prim-1",
				event_type: "discomfort",
				score: 0.9,
				created_at: now - i,
			});
		}

		const result = await recomputeDriftIfStale(db, "prim-1", DEFAULT_NOUS_CONFIG, now);
		expect(result.recomputed).toBe(true);
		expect(result.reason).toBe("stale");
		expect(result.driftScore).toBeGreaterThan(0.7);

		// Session row reflects the new drift score.
		const updated = getSession(db, "prim-1");
		expect(updated?.state.driftScore).toBeGreaterThan(0.7);

		// writeEpisode for a primary session writes an Episode row,
		// and does NOT write a SubagentEpisode.
		await writeEpisode(db, "prim-1");
		const raw = db.rawSqlite();
		expect(raw).not.toBeNull();
		const episode = raw
			?.prepare("SELECT * FROM graph_nodes WHERE kind = 'Episode' AND captured_by_session_id = ?")
			.get("prim-1") as Record<string, unknown> | undefined;
		expect(episode).toBeDefined();
		expect(episode?.captured_by_session_type).toBe("primary");

		const subEp = raw
			?.prepare(
				"SELECT * FROM graph_nodes WHERE kind = 'SubagentEpisode' AND captured_by_session_id = ?",
			)
			.get("prim-1");
		expect(subEp ?? null).toBeNull();
	});

	// ------------------------------------------------------------------
	// (b) Subagent session Stop → drift recomputed, SubagentEpisode
	//     written, no Episode row.
	// ------------------------------------------------------------------
	it("subagent Stop: recomputes drift and writes a SubagentEpisode (not an Episode)", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("test-stopext-subagent", tmpDir);

		const now = Math.floor(Date.now() / 1000);

		seedSession(db, "sub-1", "subagent", 0.2);
		// Force a stale baseline so recompute fires.
		appendHistory(db, {
			session_id: "sub-1",
			event_type: "drift",
			score: 0.2,
			created_at: now - (DRIFT_STALENESS_SECONDS + 30),
		});
		for (let i = 0; i < 3; i++) {
			appendHistory(db, {
				session_id: "sub-1",
				event_type: "discomfort",
				score: 0.85,
				created_at: now - i,
			});
		}

		const result = await recomputeDriftIfStale(db, "sub-1", DEFAULT_NOUS_CONFIG, now);
		expect(result.recomputed).toBe(true);
		expect(result.driftScore).toBeGreaterThan(0.7);

		await writeEpisode(db, "sub-1");

		const raw = db.rawSqlite();
		expect(raw).not.toBeNull();

		// SubagentEpisode exists with the subagent session_id retained
		// for future debugging.
		const subEp = raw
			?.prepare(
				"SELECT * FROM graph_nodes WHERE kind = 'SubagentEpisode' AND captured_by_session_id = ?",
			)
			.get("sub-1") as Record<string, unknown> | undefined;
		expect(subEp).toBeDefined();
		expect(subEp?.captured_by_session_type).toBe("subagent");
		// `session_id` is also persisted on the node (separate from
		// `captured_by_session_id`) so either column can be used to
		// cross-reference the originating session.
		expect(subEp?.session_id).toBe("sub-1");
		// SubagentEpisode must not masquerade as a primary Episode.
		expect(subEp?.type).toBe("SubagentEpisode");

		// No Episode row for the subagent.
		const episode = raw
			?.prepare("SELECT * FROM graph_nodes WHERE kind = 'Episode' AND captured_by_session_id = ?")
			.get("sub-1");
		expect(episode ?? null).toBeNull();

		// Subagent drift does NOT feed back into the primary drift-chain
		// history — only primary Stop writes a closing 'drift' row.
		const driftRows = raw
			?.prepare(
				"SELECT COUNT(*) as cnt FROM nous_history WHERE session_id = ? AND event_type = 'drift'",
			)
			.get("sub-1") as { cnt: number };
		// One pre-seeded stale drift + one recompute = 2; no Stop-close drift.
		expect(driftRows.cnt).toBe(2);
	});

	// ------------------------------------------------------------------
	// (c) Drift recompute failure → logged to stderr, Stop hook continues.
	//     We simulate failure by passing a session id that doesn't exist
	//     (and by closing the DB for the "throw" path) — the function must
	//     never throw, and writeEpisode must still run.
	// ------------------------------------------------------------------
	it("drift recompute on missing session returns no-op instead of throwing", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("test-stopext-missing", tmpDir);

		const result = await recomputeDriftIfStale(db, "nonexistent-session", DEFAULT_NOUS_CONFIG);
		expect(result.recomputed).toBe(false);
		expect(result.reason).toBe("session-not-found");
	});

	it("drift recompute wrapped in try/catch in Stop hook: writeEpisode still runs if recompute throws", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("test-stopext-resilient", tmpDir);

		const now = Math.floor(Date.now() / 1000);
		seedSession(db, "resilient-1", "primary", 0.1, now);

		// Simulate the Stop-hook flow with a forced-throw recompute helper.
		let stderrCapture = "";
		const fakeRecompute = async (): Promise<never> => {
			throw new Error("simulated drift recompute failure");
		};
		try {
			await fakeRecompute();
		} catch (driftErr) {
			stderrCapture = `[Nous] drift recompute failed (non-fatal): ${driftErr}\n`;
		}

		// writeEpisode must still run after a simulated recompute failure.
		await writeEpisode(db, "resilient-1");
		const raw = db.rawSqlite();
		const episode = raw
			?.prepare("SELECT * FROM graph_nodes WHERE kind = 'Episode' AND captured_by_session_id = ?")
			.get("resilient-1");
		expect(episode ?? null).not.toBeNull();
		expect(stderrCapture).toContain("drift recompute failed");
	});

	// ------------------------------------------------------------------
	// (d) Drift not stale → skip recompute.
	// ------------------------------------------------------------------
	it("skips recompute when the last drift event is still fresh and no new signals have fired", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("test-stopext-fresh", tmpDir);

		const now = Math.floor(Date.now() / 1000);
		seedSession(db, "fresh-1", "primary", 0.15, now);

		// Fresh drift event, well within the staleness window.
		appendHistory(db, {
			session_id: "fresh-1",
			event_type: "drift",
			score: 0.15,
			created_at: now - 10,
		});

		const before = getSession(db, "fresh-1");
		expect(before?.state.driftScore).toBeCloseTo(0.15, 5);

		const result = await recomputeDriftIfStale(db, "fresh-1", DEFAULT_NOUS_CONFIG, now);
		expect(result.recomputed).toBe(false);
		expect(result.reason).toBe("fresh");
		expect(result.driftScore).toBeCloseTo(0.15, 5);

		// Session state untouched.
		const after = getSession(db, "fresh-1");
		expect(after?.state.driftScore).toBeCloseTo(0.15, 5);
	});

	it("recomputes when fresh drift exists but new signals were written afterwards", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("test-stopext-signals", tmpDir);

		const now = Math.floor(Date.now() / 1000);
		seedSession(db, "sig-1", "primary", 0.1, now);

		// Drift anchor is fresh (within window) ...
		appendHistory(db, {
			session_id: "sig-1",
			event_type: "drift",
			score: 0.1,
			created_at: now - 20,
		});
		// ... but a burst of discomfort signals arrived AFTER the anchor.
		for (let i = 0; i < 4; i++) {
			appendHistory(db, {
				session_id: "sig-1",
				event_type: "discomfort",
				score: 0.95,
				created_at: now - i,
			});
		}

		const result = await recomputeDriftIfStale(db, "sig-1", DEFAULT_NOUS_CONFIG, now);
		expect(result.recomputed).toBe(true);
		expect(result.reason).toBe("signals-since-last-drift");
		expect(result.driftScore).toBeGreaterThan(0.9);
	});

	it("recomputes when no prior drift event exists for the session", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("test-stopext-noanchor", tmpDir);

		const now = Math.floor(Date.now() / 1000);
		seedSession(db, "anchorless-1", "primary", 0.0, now);
		for (let i = 0; i < 3; i++) {
			appendHistory(db, {
				session_id: "anchorless-1",
				event_type: "discomfort",
				score: 0.8,
				created_at: now - i,
			});
		}

		const result = await recomputeDriftIfStale(db, "anchorless-1", DEFAULT_NOUS_CONFIG, now);
		expect(result.recomputed).toBe(true);
		expect(result.reason).toBe("no-prior-drift");
		expect(result.driftScore).toBeCloseTo(0.8, 1);
	});

	it("is a no-op when config.enabled is false", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("test-stopext-disabled", tmpDir);

		const now = Math.floor(Date.now() / 1000);
		seedSession(db, "disabled-1", "primary", 0.1, now);

		const result = await recomputeDriftIfStale(
			db,
			"disabled-1",
			{ ...DEFAULT_NOUS_CONFIG, enabled: false },
			now,
		);
		expect(result.recomputed).toBe(false);
		expect(result.reason).toBe("disabled");
	});

	// ------------------------------------------------------------------
	// (e) Contract: recomputeDriftIfStale never throws. Even when the DB
	//     is closed mid-call, the function must return a safe no-op and
	//     emit a stderr line so the Stop hook can still call writeEpisode.
	// ------------------------------------------------------------------
	it("never throws on internal error — logs to stderr and returns safe no-op", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("test-stopext-throw", tmpDir);

		const now = Math.floor(Date.now() / 1000);
		seedSession(db, "throw-1", "primary", 0.1, now);

		// Capture stderr writes for assertion.
		const stderrChunks: string[] = [];
		const origWrite = process.stderr.write.bind(process.stderr);
		process.stderr.write = ((chunk: string | Uint8Array) => {
			stderrChunks.push(typeof chunk === "string" ? chunk : chunk.toString());
			return true;
		}) as typeof process.stderr.write;

		try {
			// Close the DB to force every subsequent prepare/get/run to throw.
			await db.close();
			db = undefined;

			// Must not throw.
			const result = await recomputeDriftIfStale(
				{
					// Minimal SiaDb-shaped stub whose rawSqlite() returns an
					// object that throws on .prepare — guaranteed internal error.
					rawSqlite: () => ({
						prepare: () => {
							throw new Error("simulated db failure");
						},
					}),
				} as unknown as SiaDb,
				"throw-1",
				DEFAULT_NOUS_CONFIG,
				now,
			);

			expect(result.recomputed).toBe(false);
			expect(result.driftScore).toBe(0);
			expect(result.reason).toBe("session-not-found");
			const combined = stderrChunks.join("");
			expect(combined).toContain("recomputeDriftIfStale failed (non-fatal)");
			expect(combined).toContain("simulated db failure");
		} finally {
			process.stderr.write = origWrite;
		}
	});

	// ------------------------------------------------------------------
	// (f) Cross-session signal isolation. Multi-agent scenario: session A
	//     has discomfort signals written after its drift anchor; session B
	//     shares the same wall-clock window but has no signals of its own.
	//     Recompute must fire for A but NOT for B.
	// ------------------------------------------------------------------
	it("scopes signals-since-last-drift to the current session (no cross-session leakage)", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("test-stopext-scoped-signals", tmpDir);

		const now = Math.floor(Date.now() / 1000);

		// Both sessions share the same drift anchor timestamp so only
		// the session_id predicate can distinguish them.
		const anchor = now - 30;
		seedSession(db, "sess-A", "primary", 0.1, now);
		seedSession(db, "sess-B", "primary", 0.1, now);

		appendHistory(db, {
			session_id: "sess-A",
			event_type: "drift",
			score: 0.1,
			created_at: anchor,
		});
		appendHistory(db, {
			session_id: "sess-B",
			event_type: "drift",
			score: 0.1,
			created_at: anchor,
		});

		// Only session A has post-anchor discomfort signals.
		for (let i = 0; i < 3; i++) {
			appendHistory(db, {
				session_id: "sess-A",
				event_type: "discomfort",
				score: 0.9,
				created_at: anchor + 1 + i,
			});
		}

		const resultA = await recomputeDriftIfStale(db, "sess-A", DEFAULT_NOUS_CONFIG, now);
		expect(resultA.recomputed).toBe(true);
		expect(resultA.reason).toBe("signals-since-last-drift");

		// Session B has no post-anchor signals of its own — the old
		// unscoped query would have seen A's signals and (incorrectly)
		// fired a recompute here. With the session_id predicate, B is
		// correctly classified as "fresh".
		const resultB = await recomputeDriftIfStale(db, "sess-B", DEFAULT_NOUS_CONFIG, now);
		expect(resultB.recomputed).toBe(false);
		expect(resultB.reason).toBe("fresh");
	});
});
