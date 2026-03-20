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

	it("applies edge rows to local graph after pull", async () => {
		const testDb = createTestDb();
		const db = testDb.db;
		tmpDir = testDb.tmpDir;

		const bridgeResult = createTestDb();
		const bridgeDb = bridgeResult.db;
		extraTmpDirs.push(bridgeResult.tmpDir);

		// Insert two entities first (edges require valid from_id/to_id references)
		await db.execute(ENTITY_INSERT, [
			"ent-a",
			"Concept",
			"EntityA",
			"content a",
			"summary a",
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
			null,
			null,
		]);

		await db.execute(ENTITY_INSERT, [
			"ent-b",
			"Concept",
			"EntityB",
			"content b",
			"summary b",
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
			null,
			null,
		]);

		// Insert an edge with hlc_modified set (simulates a remote edge to sync)
		await db.execute(
			`INSERT INTO edges (
				id, from_id, to_id, type, weight, confidence, trust_tier,
				t_created, t_expired, t_valid_from, t_valid_until,
				hlc_created, hlc_modified, source_episode, extraction_method
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, NULL, NULL)`,
			["edge-1", "ent-a", "ent-b", "relates_to", 0.9, 0.8, 3, now, 100, 200],
		);

		const result = await pullChanges(db, bridgeDb, CONFIG);

		// The edge should be counted
		expect(result.edgesReceived).toBe(1);

		// The edge should exist in the local graph with correct data
		const edgeRows = await db.execute(
			"SELECT id, from_id, to_id, type, weight, confidence FROM edges WHERE id = 'edge-1'",
		);
		expect(edgeRows.rows.length).toBe(1);
		const edge = edgeRows.rows[0] as {
			id: string;
			from_id: string;
			to_id: string;
			type: string;
			weight: number;
			confidence: number;
		};
		expect(edge.from_id).toBe("ent-a");
		expect(edge.to_id).toBe("ent-b");
		expect(edge.type).toBe("relates_to");
		expect(edge.weight).toBeCloseTo(0.9);
		expect(edge.confidence).toBeCloseTo(0.8);

		// Verify SYNC_RECV audit entry was written for the edge
		const auditRows = await db.execute(
			"SELECT operation, edge_id FROM audit_log WHERE operation = 'SYNC_RECV' AND edge_id = 'edge-1'",
		);
		expect(auditRows.rows.length).toBeGreaterThanOrEqual(1);

		await bridgeDb.close();
	});

	it("updates sync_peers last_seen_at and last_seen_hlc when metaDb is provided", async () => {
		const testDb = createTestDb();
		const db = testDb.db;
		tmpDir = testDb.tmpDir;

		const bridgeResult = createTestDb();
		const bridgeDb = bridgeResult.db;
		extraTmpDirs.push(bridgeResult.tmpDir);

		// Create a meta.db manually with the sync_peers table
		const metaResult = createTestDb();
		const metaDb = metaResult.db;
		extraTmpDirs.push(metaResult.tmpDir);
		await metaDb.execute(
			`CREATE TABLE IF NOT EXISTS sync_peers (
				peer_id      TEXT PRIMARY KEY,
				display_name TEXT,
				last_seen_hlc INTEGER,
				last_seen_at  INTEGER
			)`,
		);
		await metaDb.execute(
			"INSERT INTO sync_peers (peer_id, display_name, last_seen_hlc, last_seen_at) VALUES (?, ?, ?, ?)",
			["peer-1", "Alice", 0, 0],
		);

		// Insert a team-visible entity with hlc_modified set so max_hlc > 0
		await db.execute(ENTITY_INSERT, [
			"e1",
			"Concept",
			"MetaDbTest",
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
			500,
			100,
			null,
			null,
			null,
			null,
			null,
			null,
		]);

		const before = Date.now();
		await pullChanges(db, bridgeDb, CONFIG, undefined, undefined, metaDb);
		const after = Date.now();

		const peerRows = await metaDb.execute("SELECT * FROM sync_peers WHERE peer_id = 'peer-1'");
		const peer = peerRows.rows[0] as {
			peer_id: string;
			last_seen_at: number;
			last_seen_hlc: number;
		};
		expect(peer.last_seen_at).toBeGreaterThanOrEqual(before);
		expect(peer.last_seen_at).toBeLessThanOrEqual(after);
		expect(peer.last_seen_hlc).toBe(500);

		await bridgeDb.close();
		await metaDb.close();
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
