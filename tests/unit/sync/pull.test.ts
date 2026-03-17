import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { pullChanges } from "@/sync/pull";
import { createTestDb } from "./helpers";

const CONFIG = { enabled: true, serverUrl: "https://srv", developerId: "dev", syncInterval: 30 };

let tmpDir: string | undefined;
let extraTmpDirs: string[] = [];

afterEach(() => {
	if (tmpDir) {
		rmSync(tmpDir, { recursive: true, force: true });
		tmpDir = undefined;
	}
	for (const d of extraTmpDirs) {
		rmSync(d, { recursive: true, force: true });
	}
	extraTmpDirs = [];
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
		extraTmpDirs.push(bridgeResult.tmpDir);

		// Create entities_vss table (normally created at runtime when VSS extension loads)
		await db.execute(
			"CREATE TABLE IF NOT EXISTS entities_vss (rowid INTEGER PRIMARY KEY, embedding BLOB)",
		);

		await db.execute(ENTITY_INSERT, [
			"e1",
			"Concept",
			"Name",
			"content",
			"sum",
			null,
			"[]",
			"[]",
			3,
			0.7,
			0.7,
			0.5,
			0.5,
			0,
			0,
			now,
			now,
			now,
			null,
			null,
			null,
			"team",
			"dev",
			null,
			null,
			200,
			100,
			null,
			null,
			null,
			null,
			embedding,
			null,
		]);

		const result = await pullChanges(db, bridgeDb, CONFIG);
		expect(result.entitiesReceived).toBe(1);
		expect(result.vssRefreshed).toBe(1);

		const vss = await db.execute("SELECT COUNT(*) as count FROM entities_vss");
		expect((vss.rows[0] as { count: number }).count).toBe(1);

		await bridgeDb.close();
	});

	it("writes SYNC_RECV audit entries after pull", async () => {
		const testDb = createTestDb();
		const db = testDb.db;
		tmpDir = testDb.tmpDir;

		const bridgeResult = createTestDb();
		const bridgeDb = bridgeResult.db;
		extraTmpDirs.push(bridgeResult.tmpDir);

		// Insert a team-visible entity with hlc_modified > synced_at
		await db.execute(ENTITY_INSERT, [
			"e1",
			"Concept",
			"TestEntity",
			"some content about testing",
			"test summary",
			null,
			'["test"]',
			"[]",
			3,
			0.7,
			0.7,
			0.5,
			0.5,
			0,
			0,
			now,
			now,
			now,
			null,
			null,
			null,
			"team",
			"dev",
			null,
			null,
			200,
			100,
			null,
			null,
			null,
			null,
			null,
			null,
		]);

		await pullChanges(db, bridgeDb, CONFIG);

		// Verify audit_log has SYNC_RECV entries
		const auditRows = await db.execute(
			"SELECT operation, entity_id FROM audit_log WHERE operation = 'SYNC_RECV'",
		);
		expect(auditRows.rows.length).toBeGreaterThanOrEqual(1);
		const syncRecvEntry = auditRows.rows.find(
			(r) => (r as { entity_id: string }).entity_id === "e1",
		);
		expect(syncRecvEntry).toBeDefined();

		await bridgeDb.close();
	});

	it("persists HLC after pull when repoHash is provided", async () => {
		const testDb = createTestDb();
		const db = testDb.db;
		tmpDir = testDb.tmpDir;

		const bridgeResult = createTestDb();
		const bridgeDb = bridgeResult.db;
		extraTmpDirs.push(bridgeResult.tmpDir);

		// Insert a team entity with hlc_modified set
		await db.execute(ENTITY_INSERT, [
			"e1",
			"Concept",
			"HlcTest",
			"content",
			"summary",
			null,
			"[]",
			"[]",
			3,
			0.7,
			0.7,
			0.5,
			0.5,
			0,
			0,
			now,
			now,
			now,
			null,
			null,
			null,
			"team",
			"dev",
			null,
			null,
			300,
			100,
			null,
			null,
			null,
			null,
			null,
			null,
		]);

		await pullChanges(db, bridgeDb, CONFIG, testDb.repoHash, testDb.tmpDir);

		// Verify hlc.json exists after pull
		const hlcPath = join(testDb.tmpDir, "repos", testDb.repoHash, "hlc.json");
		expect(existsSync(hlcPath)).toBe(true);

		await bridgeDb.close();
	});

	it("returns zeros when sync is disabled", async () => {
		const testDb = createTestDb();
		const db = testDb.db;
		tmpDir = testDb.tmpDir;

		const bridgeResult = createTestDb();
		const bridgeDb = bridgeResult.db;
		extraTmpDirs.push(bridgeResult.tmpDir);

		const disabledConfig = { ...CONFIG, enabled: false };
		const result = await pullChanges(db, bridgeDb, disabledConfig);
		expect(result.entitiesReceived).toBe(0);
		expect(result.edgesReceived).toBe(0);
		expect(result.vssRefreshed).toBe(0);

		await bridgeDb.close();
	});
});
