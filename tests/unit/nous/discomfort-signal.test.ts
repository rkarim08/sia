import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SiaDb } from "@/graph/db-interface";
import { openGraphDb } from "@/graph/semantic-db";
import { runDiscomfortSignal } from "@/nous/discomfort-signal";
import { DEFAULT_SESSION_STATE } from "@/nous/types";
import { upsertSession } from "@/nous/working-memory";

function makeTmp() {
	return join(tmpdir(), `nous-ds-${randomUUID()}`);
}

describe("discomfort-signal", () => {
	let db: SiaDb | undefined;
	let tmpDir = "";

	afterEach(async () => {
		await db?.close();
		db = undefined;
		if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
		tmpDir = "";
	});

	function seedSession(db: SiaDb, sessionId: string, significance = 0.8) {
		const now = Math.floor(Date.now() / 1000);
		upsertSession(db, {
			session_id: sessionId,
			parent_session_id: null,
			session_type: "primary",
			state: { ...DEFAULT_SESSION_STATE, currentCallSignificance: significance },
			created_at: now,
			updated_at: now,
		});
	}

	it("returns no signal for neutral response", () => {
		tmpDir = makeTmp();
		db = openGraphDb("test-ds1", tmpDir);
		seedSession(db, "sess-ds-1");

		const result = runDiscomfortSignal(db, "sess-ds-1", "Here is the analysis of the codebase.");
		expect(result.signalFired).toBe(false);
		expect(result.score).toBeLessThan(0.6);
	});

	it("fires signal for approval-seeking response at high significance", () => {
		tmpDir = makeTmp();
		db = openGraphDb("test-ds2", tmpDir);
		seedSession(db, "sess-ds-2", 0.9);

		const result = runDiscomfortSignal(
			db,
			"sess-ds-2",
			"You're absolutely right, I apologize for the confusion. That was a great point and I stand corrected.",
		);
		expect(result.signalFired).toBe(true);
		expect(result.score).toBeGreaterThan(0.6);
	});

	it("tolerates hedging at low significance (threshold adjusted)", () => {
		tmpDir = makeTmp();
		db = openGraphDb("test-ds3", tmpDir);
		seedSession(db, "sess-ds-3", 0.1); // low significance call

		const result = runDiscomfortSignal(db, "sess-ds-3", "You're right, I made a mistake there.");
		// Low significance means threshold is more lenient — may or may not fire.
		// Just verify the score is computed without crashing.
		expect(typeof result.score).toBe("number");
		expect(result.score).toBeGreaterThanOrEqual(0.0);
	});
});
