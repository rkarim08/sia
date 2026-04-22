import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { v4 as uuid } from "uuid";
import { afterEach, describe, expect, it } from "vitest";
import type { SiaDb } from "@/graph/db-interface";
import { openGraphDb } from "@/graph/semantic-db";
import { handleNousState } from "@/mcp/tools/nous-state";
import { DEFAULT_NOUS_CONFIG, DEFAULT_SESSION_STATE } from "@/nous/types";
import { upsertSession } from "@/nous/working-memory";

function makeTmp(): string {
	return join(tmpdir(), `nous-st-${randomUUID()}`);
}

/** Test helper: insert a minimal graph_nodes row. */
function insertNode(
	db: SiaDb,
	opts: {
		id: string;
		type: string;
		name: string;
		trust_tier: number;
		access_count: number;
		kind?: string | null;
		tags?: string;
	},
): void {
	const raw = db.rawSqlite();
	if (!raw) throw new Error("no raw sqlite handle");
	const now = Date.now();
	raw
		.prepare(
			`INSERT INTO graph_nodes (
			id, type, name, content, summary,
			tags, file_paths,
			trust_tier, confidence, base_confidence,
			importance, base_importance,
			access_count, edge_count,
			last_accessed, created_at, t_created,
			visibility, created_by,
			kind
		) VALUES (?, ?, ?, 'content', 'summary', ?, '[]', ?, 0.9, 0.9, 0.5, 0.5, ?, 0, ?, ?, ?, 'private', 'test', ?)`,
		)
		.run(
			opts.id,
			opts.type,
			opts.name,
			opts.tags ?? "[]",
			opts.trust_tier,
			opts.access_count,
			now,
			now,
			now,
			opts.kind ?? null,
		);
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
		expect(Array.isArray(result.next_steps)).toBe(true);
	});

	it("returns empty state when session not found", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("test-ns2", tmpDir);

		const result = await handleNousState(db, "nonexistent");
		expect(result.driftScore).toBe(0);
		expect(result.sessionType).toBe("unknown");
		expect(result.next_steps).toEqual([]);
	});

	it("emits a nous_reflect next-step when drift score exceeds the warning threshold", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("test-ns-drift", tmpDir);

		const now = Math.floor(Date.now() / 1000);
		const driftAboveThreshold = DEFAULT_NOUS_CONFIG.driftWarningThreshold + 0.1;
		upsertSession(db, {
			session_id: "st-sess-drift",
			parent_session_id: null,
			session_type: "primary",
			state: { ...DEFAULT_SESSION_STATE, driftScore: driftAboveThreshold },
			created_at: now,
			updated_at: now,
		});

		const result = await handleNousState(db, "st-sess-drift");
		const reflectStep = result.next_steps.find((s) => s.tool === "nous_reflect");
		expect(reflectStep).toBeDefined();
		expect(reflectStep?.reason).toContain("drift score");
		expect(reflectStep?.reason).toContain(DEFAULT_NOUS_CONFIG.driftWarningThreshold.toFixed(2));
	});

	it("emits a nous_curiosity next-step when no open Concerns exist and untouched high-trust entities are present", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("test-ns-curiosity", tmpDir);

		// Seed a high-trust, rarely-retrieved Decision node. access_count = 2 is
		// within nous_curiosity's MAX_ACCESS_COUNT (3) threshold, so the hint
		// must still fire — proves nous_state and nous_curiosity use the same
		// access-count threshold.
		insertNode(db, {
			id: uuid(),
			type: "Decision",
			name: "Rarely-retrieved Decision",
			trust_tier: 1,
			access_count: 2,
			kind: "Decision",
		});

		const now = Math.floor(Date.now() / 1000);
		upsertSession(db, {
			session_id: "st-sess-curio",
			parent_session_id: null,
			session_type: "primary",
			// Drift well below the warning threshold so only the curiosity branch fires.
			state: { ...DEFAULT_SESSION_STATE, driftScore: 0.1 },
			created_at: now,
			updated_at: now,
		});

		const result = await handleNousState(db, "st-sess-curio");
		const curiosityStep = result.next_steps.find((s) => s.tool === "nous_curiosity");
		expect(curiosityStep).toBeDefined();
		expect(curiosityStep?.reason).toContain("no open Concerns");
		// Ensure the drift branch did NOT fire.
		expect(result.next_steps.find((s) => s.tool === "nous_reflect")).toBeUndefined();
	});

	it("omits the nous_curiosity next-step when open Concerns already exist", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("test-ns-openconcern", tmpDir);

		// Seed an open Concern (should suppress the curiosity hint).
		insertNode(db, {
			id: uuid(),
			type: "Concern",
			name: "Existing open concern",
			trust_tier: 3,
			access_count: 0,
			kind: "Concern",
			tags: '["status:open"]',
		});
		// Seed an untouched high-trust entity (would normally trigger curiosity).
		insertNode(db, {
			id: uuid(),
			type: "Decision",
			name: "Unretrieved Decision 2",
			trust_tier: 1,
			access_count: 0,
			kind: "Decision",
		});

		const now = Math.floor(Date.now() / 1000);
		upsertSession(db, {
			session_id: "st-sess-openconcern",
			parent_session_id: null,
			session_type: "primary",
			state: { ...DEFAULT_SESSION_STATE, driftScore: 0.1 },
			created_at: now,
			updated_at: now,
		});

		const result = await handleNousState(db, "st-sess-openconcern");
		expect(result.next_steps.find((s) => s.tool === "nous_curiosity")).toBeUndefined();
	});
});
