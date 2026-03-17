import { rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { pushChanges } from "@/sync/push";
import { createTestDb } from "./helpers";

const CONFIG = { enabled: true, serverUrl: "https://srv", developerId: "dev", syncInterval: 30 };

let tmpDir: string | undefined;

afterEach(() => {
	if (tmpDir) {
		rmSync(tmpDir, { recursive: true, force: true });
		tmpDir = undefined;
	}
});

const now = Date.now();

function entityRow(id: string, visibility: string, hlcModified: number | null, syncedAt: number | null) {
	return [
		id, "Concept", `Name-${id}`, "content", "summary", null,
		"[]", "[]", 3, 0.7, 0.7, 0.5, 0.5, 0, 0, now, now, now, null, null, null,
		visibility, "dev", null, null, hlcModified, syncedAt, null, null, null, null, null, null,
	];
}

const ENTITY_INSERT = `INSERT INTO entities (
	id, type, name, content, summary, package_path,
	tags, file_paths, trust_tier, confidence, base_confidence,
	importance, base_importance, access_count, edge_count,
	last_accessed, created_at, t_created, t_expired, t_valid_from, t_valid_until,
	visibility, created_by, workspace_scope, hlc_created, hlc_modified, synced_at,
	conflict_group_id, source_episode, extraction_method, extraction_model, embedding, archived_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

describe("pushChanges", () => {
	it("pushes only non-private unsynced entities and stamps synced_at", async () => {
		const result = createTestDb();
		const db = result.db;
		tmpDir = result.tmpDir;

		await db.execute(ENTITY_INSERT, entityRow("e1", "team", 100, null));
		await db.execute(ENTITY_INSERT, entityRow("e2", "private", 200, null));
		await db.execute(ENTITY_INSERT, entityRow("e3", "team", 50, 80));

		const pushResult = await pushChanges(db, CONFIG);
		expect(pushResult.entitiesPushed).toBe(1);

		const rows = await db.execute("SELECT id, synced_at FROM entities ORDER BY id");
		const e1 = rows.rows.find((r) => (r as { id: string }).id === "e1") as {
			synced_at: number | null;
		};
		const e2 = rows.rows.find((r) => (r as { id: string }).id === "e2") as {
			synced_at: number | null;
		};
		expect(e1.synced_at).not.toBeNull();
		expect(e2.synced_at).toBeNull();
	});
});
