import { rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { pullChanges } from "@/sync/pull";
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
const embedding = new Uint8Array(new Float32Array([1, 0, 0, 0]).buffer);

const ENTITY_INSERT = `INSERT INTO entities (
	id, type, name, content, summary, package_path,
	tags, file_paths, trust_tier, confidence, base_confidence,
	importance, base_importance, access_count, edge_count,
	last_accessed, created_at, t_created, t_expired, t_valid_from, t_valid_until,
	visibility, created_by, workspace_scope, hlc_created, hlc_modified, synced_at,
	conflict_group_id, source_episode, extraction_method, extraction_model, embedding, archived_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

describe("pullChanges", () => {
	it("refreshes VSS for entities with embeddings and counts received entities", async () => {
		const testDb = createTestDb();
		const db = testDb.db;
		tmpDir = testDb.tmpDir;

		const bridgeResult = createTestDb();
		const bridgeDb = bridgeResult.db;

		// Create entities_vss table (normally created at runtime when VSS extension loads)
		await db.execute("CREATE TABLE IF NOT EXISTS entities_vss (rowid INTEGER PRIMARY KEY, embedding BLOB)");

		await db.execute(ENTITY_INSERT, [
			"e1", "Concept", "Name", "content", "sum", null,
			"[]", "[]", 3, 0.7, 0.7, 0.5, 0.5, 0, 0, now, now, now, null, null, null,
			"team", "dev", null, null, 200, 100,
			null, null, null, null, embedding, null,
		]);

		const result = await pullChanges(db, bridgeDb, CONFIG);
		expect(result.entitiesReceived).toBe(1);
		expect(result.vssRefreshed).toBe(1);

		const vss = await db.execute("SELECT COUNT(*) as count FROM entities_vss");
		expect((vss.rows[0] as { count: number }).count).toBe(1);

		await bridgeDb.close();
	});
});
