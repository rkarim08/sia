import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SiaDb } from "@/graph/db-interface";
import { openGraphDb } from "@/graph/semantic-db";
import { runSessionStart } from "@/nous/self-monitor";
import { DEFAULT_NOUS_CONFIG } from "@/nous/types";
import { appendHistory, getSession } from "@/nous/working-memory";

function makeTmp() {
	return join(tmpdir(), `nous-sm-${randomUUID()}`);
}

describe("self-monitor", () => {
	let db: SiaDb | undefined;
	let tmpDir = "";

	afterEach(async () => {
		await db?.close();
		db = undefined;
		if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
		tmpDir = "";
	});

	it("creates a new session with zero drift on first run", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("test-sm", tmpDir);

		const result = await runSessionStart(db, { session_id: "sess-a", cwd: "/tmp" });
		expect(result.session.session_id).toBe("sess-a");
		expect(result.session.state.driftScore).toBe(0.0);
		expect(result.driftWarning).toBeNull();
		expect(result.modifyBlocked).toBe(false);
	});

	it("computes drift from discomfort history", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("test-sm2", tmpDir);

		const now = Math.floor(Date.now() / 1000);
		// Seed history with high discomfort scores
		for (let i = 0; i < 5; i++) {
			appendHistory(db, {
				session_id: "prev-sess",
				event_type: "discomfort",
				score: 0.8,
				created_at: now - i,
			});
		}

		const result = await runSessionStart(db, { session_id: "sess-b", cwd: "/tmp" });
		expect(result.session.state.driftScore).toBeGreaterThan(0.7);
		expect(result.driftWarning).not.toBeNull();
	});

	it("is a no-op when config.enabled is false", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("test-sm-disabled", tmpDir);

		const result = await runSessionStart(
			db,
			{ session_id: "sess-off", cwd: "/tmp" },
			{ ...DEFAULT_NOUS_CONFIG, enabled: false },
		);

		// Returns a noop session shape, does not touch the DB
		expect(result.session.session_id).toBe("sess-off");
		expect(result.driftWarning).toBeNull();
		expect(result.modifyBlocked).toBe(false);
		expect(getSession(db, "sess-off")).toBeNull();
	});

	it("sets modifyBlocked when drift exceeds 0.90", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("test-sm3", tmpDir);

		const now = Math.floor(Date.now() / 1000);
		for (let i = 0; i < 10; i++) {
			appendHistory(db, {
				session_id: "prev",
				event_type: "discomfort",
				score: 0.95,
				created_at: now - i,
			});
		}

		const result = await runSessionStart(db, { session_id: "sess-c", cwd: "/tmp" });
		expect(result.modifyBlocked).toBe(true);
		expect(result.session.state.nousModifyBlocked).toBe(true);
	});
});
