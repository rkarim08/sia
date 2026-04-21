import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SiaDb } from "@/graph/db-interface";
import { openGraphDb } from "@/graph/semantic-db";
import { handleNousState } from "@/mcp/tools/nous-state";
import { DEFAULT_SESSION_STATE } from "@/nous/types";
import { upsertSession } from "@/nous/working-memory";

function makeTmp(): string {
	return join(tmpdir(), `nous-st-${randomUUID()}`);
}

describe("nous-state", () => {
	let db: SiaDb | undefined;
	let tmpDir = "";

	afterEach(async () => {
		await db?.close();
		db = undefined;
		if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
		tmpDir = "";
	});

	it("returns session state snapshot", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("test-ns", tmpDir);

		const now = Math.floor(Date.now() / 1000);
		upsertSession(db, {
			session_id: "st-sess-1",
			parent_session_id: null,
			session_type: "primary",
			state: { ...DEFAULT_SESSION_STATE, driftScore: 0.4, surpriseCount: 2 },
			created_at: now,
			updated_at: now,
		});

		const result = await handleNousState(db, "st-sess-1");
		expect(result.driftScore).toBe(0.4);
		expect(result.surpriseCount).toBe(2);
		expect(result.sessionType).toBe("primary");
		expect(Array.isArray(result.preferences)).toBe(true);
		expect(Array.isArray(result.recentSignals)).toBe(true);
	});

	it("returns empty state when session not found", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("test-ns2", tmpDir);

		const result = await handleNousState(db, "nonexistent");
		expect(result.driftScore).toBe(0);
		expect(result.sessionType).toBe("unknown");
	});
});
