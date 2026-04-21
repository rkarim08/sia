import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SiaDb } from "@/graph/db-interface";
import { openGraphDb } from "@/graph/semantic-db";
import { handleNousReflect } from "@/mcp/tools/nous-reflect";
import { DEFAULT_SESSION_STATE } from "@/nous/types";
import { appendHistory, upsertSession } from "@/nous/working-memory";

function makeTmp(): string {
	return join(tmpdir(), `nous-rf-${randomUUID()}`);
}

describe("nous-reflect", () => {
	let db: SiaDb | undefined;
	let tmpDir = "";

	afterEach(async () => {
		await db?.close();
		db = undefined;
		if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
		tmpDir = "";
	});

	it("returns drift breakdown with recommended action", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("test-rf1", tmpDir);

		const now = Math.floor(Date.now() / 1000);
		upsertSession(db, {
			session_id: "rf-sess-1",
			parent_session_id: null,
			session_type: "primary",
			state: { ...DEFAULT_SESSION_STATE, driftScore: 0.5 },
			created_at: now,
			updated_at: now,
		});
		appendHistory(db, {
			session_id: "rf-sess-1",
			event_type: "discomfort",
			score: 0.7,
			created_at: now,
		});

		const result = await handleNousReflect(db, "rf-sess-1", {});
		expect(typeof result.overallDrift).toBe("number");
		expect(typeof result.recommendedAction).toBe("string");
		expect(Array.isArray(result.drivingSignals)).toBe(true);
	});

	it("returns low drift when no discomfort history", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("test-rf2", tmpDir);

		const now = Math.floor(Date.now() / 1000);
		upsertSession(db, {
			session_id: "rf-sess-2",
			parent_session_id: null,
			session_type: "primary",
			state: { ...DEFAULT_SESSION_STATE, driftScore: 0.1 },
			created_at: now,
			updated_at: now,
		});

		const result = await handleNousReflect(db, "rf-sess-2", {});
		expect(result.overallDrift).toBeLessThan(0.3);
		expect(result.recommendedAction).toBe("continue");
	});

	it("recommends escalate for high drift", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("test-rf3", tmpDir);

		const now = Math.floor(Date.now() / 1000);
		upsertSession(db, {
			session_id: "rf-sess-3",
			parent_session_id: null,
			session_type: "primary",
			state: { ...DEFAULT_SESSION_STATE },
			created_at: now,
			updated_at: now,
		});
		// High and persistent discomfort — drift > selfModifyBlockThreshold (0.9).
		for (let i = 0; i < 5; i++) {
			appendHistory(db, {
				session_id: "rf-sess-3",
				event_type: "discomfort",
				score: 0.95,
				created_at: now + i,
			});
		}

		const result = await handleNousReflect(db, "rf-sess-3", {});
		expect(result.overallDrift).toBeGreaterThan(0.9);
		expect(result.recommendedAction).toBe("escalate");
	});
});
