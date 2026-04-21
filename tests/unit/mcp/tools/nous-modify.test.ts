import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { v4 as uuid } from "uuid";
import type { SiaDb } from "@/graph/db-interface";
import { openGraphDb } from "@/graph/semantic-db";
import { handleNousModify } from "@/mcp/tools/nous-modify";
import { DEFAULT_SESSION_STATE } from "@/nous/types";
import { upsertSession } from "@/nous/working-memory";

function makeTmp(): string {
	return join(tmpdir(), `nous-mod-${randomUUID()}`);
}

function seedPrimarySession(db: SiaDb, sessionId: string, driftScore = 0.2): void {
	const now = Math.floor(Date.now() / 1000);
	upsertSession(db, {
		session_id: sessionId,
		parent_session_id: null,
		session_type: "primary",
		state: {
			...DEFAULT_SESSION_STATE,
			driftScore,
			nousModifyBlocked: driftScore > 0.9,
		},
		created_at: now,
		updated_at: now,
	});
}

function insertPreferenceNode(db: SiaDb, id: string, trust_tier: number, name: string): void {
	const raw = db.rawSqlite();
	if (!raw) throw new Error("no raw sqlite handle");
	const now = Date.now();
	raw.prepare(
		`INSERT INTO graph_nodes (
			id, type, name, content, summary,
			tags, file_paths,
			trust_tier, confidence, base_confidence,
			importance, base_importance,
			access_count, edge_count,
			last_accessed, created_at, t_created,
			visibility, created_by,
			kind
		) VALUES (?, 'Preference', ?, 'Old content', 'Old summary', '[]', '[]', ?, 0.8, 0.8, 0.6, 0.6, 0, 0, ?, ?, ?, 'private', 'test', 'Preference')`,
	).run(id, name, trust_tier, now, now, now);
}

describe("nous-modify", () => {
	let db: SiaDb | undefined;
	let tmpDir = "";

	afterEach(async () => {
		await db?.close();
		db = undefined;
		if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
		tmpDir = "";
	});

	it("creates a new Preference node for primary session with low drift", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("test-mod1", tmpDir);
		seedPrimarySession(db, "mod-sess-1", 0.2);

		const result = await handleNousModify(db, "mod-sess-1", {
			action: "create",
			preference: "Prefer explicit imports over barrel files",
			reason: "Barrel file imports caused circular dependency issues in Phase 5 build",
		});

		expect(result.blocked).toBe(false);
		expect(result.newNodeId).toBeDefined();

		const raw = db.rawSqlite();
		const node = raw!
			.prepare("SELECT kind, trust_tier FROM graph_nodes WHERE id = ?")
			.get(result.newNodeId!) as { kind: string; trust_tier: number };
		expect(node.kind).toBe("Preference");
		expect(node.trust_tier).toBe(3); // inferred by nous_modify
	});

	it("blocks modification for subagent sessions", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("test-mod2", tmpDir);

		const now = Math.floor(Date.now() / 1000);
		upsertSession(db, {
			session_id: "mod-sess-2",
			parent_session_id: "parent",
			session_type: "subagent",
			state: { ...DEFAULT_SESSION_STATE },
			created_at: now,
			updated_at: now,
		});

		const result = await handleNousModify(db, "mod-sess-2", {
			action: "create",
			preference: "Some preference",
			reason: "reason",
		});

		expect(result.blocked).toBe(true);
		expect(result.blockReason).toContain("subagent");
	});

	it("blocks modification when drift > 0.90", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("test-mod3", tmpDir);
		seedPrimarySession(db, "mod-sess-3", 0.95);

		const result = await handleNousModify(db, "mod-sess-3", {
			action: "create",
			preference: "Some preference",
			reason: "reason",
		});

		expect(result.blocked).toBe(true);
		expect(result.blockReason).toContain("drift");
	});

	it("blocks when reason is empty", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("test-mod3b", tmpDir);
		seedPrimarySession(db, "mod-sess-3b", 0.1);

		const result = await handleNousModify(db, "mod-sess-3b", {
			action: "create",
			preference: "Some preference",
			reason: "   ",
		});

		expect(result.blocked).toBe(true);
		expect(result.blockReason).toContain("reason");
	});

	it("supersedes existing Tier 3 Preference on update", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("test-mod4", tmpDir);
		seedPrimarySession(db, "mod-sess-4", 0.1);

		const existingId = uuid();
		insertPreferenceNode(db, existingId, 3, "Old preference");

		const result = await handleNousModify(db, "mod-sess-4", {
			action: "update",
			preference: "New preference content",
			reason: "Learned from session",
			existingNodeId: existingId,
		});

		expect(result.blocked).toBe(false);
		expect(result.newNodeId).toBeDefined();
		expect(result.supersededNodeId).toBe(existingId);

		// Old node should have t_valid_until set (superseded).
		const raw = db.rawSqlite();
		const oldNode = raw!
			.prepare("SELECT t_valid_until FROM graph_nodes WHERE id = ?")
			.get(existingId) as { t_valid_until: number | null };
		expect(oldNode.t_valid_until).not.toBeNull();
	});

	it("Tier 1 Preferences require explicit confirmation — not auto-mutated", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("test-mod5", tmpDir);
		seedPrimarySession(db, "mod-sess-5", 0.1);

		const existingId = uuid();
		insertPreferenceNode(db, existingId, 1, "Tier-1 preference");

		const result = await handleNousModify(db, "mod-sess-5", {
			action: "update",
			preference: "New content for Tier 1",
			reason: "Try to update a Tier 1",
			existingNodeId: existingId,
		});

		expect(result.blocked).toBe(false);
		expect(result.confirmationRequired).toBe(true);
		expect(result.newNodeId).toBeUndefined();

		// Old node must NOT be invalidated.
		const raw = db.rawSqlite();
		const oldNode = raw!
			.prepare("SELECT t_valid_until FROM graph_nodes WHERE id = ?")
			.get(existingId) as { t_valid_until: number | null };
		expect(oldNode.t_valid_until).toBeNull();
	});

	it("deprecates a Tier 3 Preference", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("test-mod6", tmpDir);
		seedPrimarySession(db, "mod-sess-6", 0.1);

		const existingId = uuid();
		insertPreferenceNode(db, existingId, 3, "To be deprecated");

		const result = await handleNousModify(db, "mod-sess-6", {
			action: "deprecate",
			preference: "(no-op for deprecate)",
			reason: "Superseded by newer pattern",
			existingNodeId: existingId,
		});

		expect(result.blocked).toBe(false);
		expect(result.supersededNodeId).toBe(existingId);

		const raw = db.rawSqlite();
		const node = raw!
			.prepare("SELECT t_valid_until FROM graph_nodes WHERE id = ?")
			.get(existingId) as { t_valid_until: number | null };
		expect(node.t_valid_until).not.toBeNull();
	});
});
