import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SiaDb } from "@/graph/db-interface";
import { openGraphDb } from "@/graph/semantic-db";
import { runSignificanceDetector } from "@/nous/significance-detector";
import { DEFAULT_SESSION_STATE } from "@/nous/types";
import { getSession, upsertSession } from "@/nous/working-memory";

function makeTmp() {
	return join(tmpdir(), `nous-sig-${randomUUID()}`);
}

describe("significance-detector", () => {
	let db: SiaDb | undefined;
	let tmpDir = "";

	afterEach(async () => {
		await db?.close();
		db = undefined;
		if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
		tmpDir = "";
	});

	function seedSession(db: SiaDb, sessionId: string) {
		const now = Math.floor(Date.now() / 1000);
		upsertSession(db, {
			session_id: sessionId,
			parent_session_id: null,
			session_type: "primary",
			state: { ...DEFAULT_SESSION_STATE },
			created_at: now,
			updated_at: now,
		});
	}

	it("assigns significance 1.0 to Write tool calls", () => {
		tmpDir = makeTmp();
		db = openGraphDb("test-sig", tmpDir);
		seedSession(db, "sess-sig-1");

		runSignificanceDetector(db, "sess-sig-1", "Write", { file_path: "/src/foo.ts" });

		const session = getSession(db, "sess-sig-1");
		expect(session?.state.currentCallSignificance).toBe(1.0);
	});

	it("assigns significance 1.0 to Edit tool calls", () => {
		tmpDir = makeTmp();
		db = openGraphDb("test-sig2", tmpDir);
		seedSession(db, "sess-sig-2");

		runSignificanceDetector(db, "sess-sig-2", "Edit", { file_path: "/src/bar.ts" });

		const session = getSession(db, "sess-sig-2");
		expect(session?.state.currentCallSignificance).toBe(1.0);
	});

	it("assigns lower significance to Read tool calls", () => {
		tmpDir = makeTmp();
		db = openGraphDb("test-sig3", tmpDir);
		seedSession(db, "sess-sig-3");

		runSignificanceDetector(db, "sess-sig-3", "Read", { file_path: "/src/baz.ts" });

		const session = getSession(db, "sess-sig-3");
		expect(session?.state.currentCallSignificance).toBeLessThan(0.5);
	});

	it("skips gracefully when session does not exist", () => {
		tmpDir = makeTmp();
		const localDb = openGraphDb("test-sig4", tmpDir);
		db = localDb;
		// Should not throw
		expect(() =>
			runSignificanceDetector(localDb, "nonexistent", "Write", {}),
		).not.toThrow();
	});
});
