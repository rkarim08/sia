import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SiaDb } from "@/graph/db-interface";
import { openGraphDb } from "@/graph/semantic-db";
import { DEFAULT_SESSION_STATE } from "@/nous/types";
import {
	appendHistory,
	cleanStaleSessions,
	deleteSession,
	getRecentHistory,
	getSession,
	updateSessionState,
	upsertSession,
} from "@/nous/working-memory";

function makeTmp(): string {
	return join(tmpdir(), `nous-test-${randomUUID()}`);
}

describe("working-memory", () => {
	let db: SiaDb | undefined;
	let tmpDir = "";

	afterEach(async () => {
		await db?.close();
		db = undefined;
		if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
		tmpDir = "";
	});

	it("upserts and retrieves a session", () => {
		tmpDir = makeTmp();
		db = openGraphDb("test-nous", tmpDir);

		const now = Math.floor(Date.now() / 1000);
		upsertSession(db, {
			session_id: "sess-1",
			parent_session_id: null,
			session_type: "primary",
			state: { ...DEFAULT_SESSION_STATE, driftScore: 0.3 },
			created_at: now,
			updated_at: now,
		});

		const result = getSession(db, "sess-1");
		expect(result).not.toBeNull();
		if (result) {
			expect(result.session_id).toBe("sess-1");
			expect(result.state.driftScore).toBe(0.3);
			expect(result.session_type).toBe("primary");
		}
	});

	it("upserts updates state without creating duplicate row", () => {
		tmpDir = makeTmp();
		db = openGraphDb("test-nous", tmpDir);

		const now = Math.floor(Date.now() / 1000);
		upsertSession(db, {
			session_id: "sess-2",
			parent_session_id: null,
			session_type: "primary",
			state: { ...DEFAULT_SESSION_STATE },
			created_at: now,
			updated_at: now,
		});
		updateSessionState(db, "sess-2", { ...DEFAULT_SESSION_STATE, driftScore: 0.8 });

		const result = getSession(db, "sess-2");
		expect(result).not.toBeNull();
		expect(result?.state.driftScore).toBe(0.8);
	});

	it("returns null for unknown session", () => {
		tmpDir = makeTmp();
		db = openGraphDb("test-nous", tmpDir);
		expect(getSession(db, "nonexistent")).toBeNull();
	});

	it("deletes a session", () => {
		tmpDir = makeTmp();
		db = openGraphDb("test-nous", tmpDir);

		const now = Math.floor(Date.now() / 1000);
		upsertSession(db, {
			session_id: "sess-3",
			parent_session_id: null,
			session_type: "primary",
			state: { ...DEFAULT_SESSION_STATE },
			created_at: now,
			updated_at: now,
		});
		deleteSession(db, "sess-3");
		expect(getSession(db, "sess-3")).toBeNull();
	});

	it("appends and retrieves history events", () => {
		tmpDir = makeTmp();
		db = openGraphDb("test-nous", tmpDir);

		const now = Math.floor(Date.now() / 1000);
		appendHistory(db, {
			session_id: "sess-4",
			event_type: "discomfort",
			score: 0.7,
			created_at: now,
		});
		appendHistory(db, {
			session_id: "sess-4",
			event_type: "drift",
			score: 0.4,
			created_at: now + 1,
		});

		const history = getRecentHistory(db, 10);
		expect(history.length).toBe(2);
		// Most recent first
		expect(history[0].event_type).toBe("drift");
	});

	it("cleanStaleSessions removes sessions older than 1 hour", () => {
		tmpDir = makeTmp();
		db = openGraphDb("test-nous", tmpDir);

		const staleTime = Math.floor(Date.now() / 1000) - 7200;
		upsertSession(db, {
			session_id: "stale-sess",
			parent_session_id: null,
			session_type: "primary",
			state: { ...DEFAULT_SESSION_STATE },
			created_at: staleTime,
			updated_at: staleTime,
		});
		// upsertSession sets updated_at = now regardless of input — we need to
		// force it to be stale. Drop straight through to the raw handle for test setup.
		const raw = db.rawSqlite();
		if (raw) {
			raw.prepare("UPDATE nous_sessions SET updated_at = ? WHERE session_id = ?")
				.run(staleTime, "stale-sess");
		}

		cleanStaleSessions(db);
		expect(getSession(db, "stale-sess")).toBeNull();
	});
});
