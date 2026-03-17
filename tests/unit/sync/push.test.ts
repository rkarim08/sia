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

function entityRow(
	id: string,
	visibility: string,
	hlcModified: number | null,
	syncedAt: number | null,
) {
	return [
		id,
		"Concept",
		`Name-${id}`,
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
		visibility,
		"dev",
		null,
		null,
		hlcModified,
		syncedAt,
		null,
		null,
		null,
		null,
		null,
		null,
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

const EDGE_INSERT = `INSERT INTO edges (
	id, from_id, to_id, type, weight, confidence, trust_tier,
	t_created, t_expired, t_valid_from, t_valid_until,
	hlc_created, hlc_modified, source_episode, extraction_method
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL)`;

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

	it("pushes edges where both endpoints are in pushed entity set", async () => {
		const result = createTestDb();
		const db = result.db;
		tmpDir = result.tmpDir;

		// Insert 2 team-visible entities with hlc_modified set and synced_at=null
		await db.execute(ENTITY_INSERT, entityRow("e1", "team", 100, null));
		await db.execute(ENTITY_INSERT, entityRow("e2", "team", 100, null));
		// Insert a private entity (should not be pushed)
		await db.execute(ENTITY_INSERT, entityRow("e3", "private", 100, null));

		// Insert edge between e1 and e2 (both pushed)
		await db.execute(EDGE_INSERT, ["edge-1", "e1", "e2", "relates_to", 1.0, 0.7, 3, now]);
		// Insert edge between e1 and e3 (e3 is private, not pushed)
		await db.execute(EDGE_INSERT, ["edge-2", "e1", "e3", "relates_to", 1.0, 0.7, 3, now]);

		const pushResult = await pushChanges(db, CONFIG);
		expect(pushResult.entitiesPushed).toBe(2);
		expect(pushResult.edgesPushed).toBe(1);

		// Verify edge-1 has hlc_modified set (marked as synced)
		const edgeRows = await db.execute("SELECT id, hlc_modified FROM edges ORDER BY id");
		const edge1 = edgeRows.rows.find((r) => (r as { id: string }).id === "edge-1") as {
			hlc_modified: number | null;
		};
		const edge2 = edgeRows.rows.find((r) => (r as { id: string }).id === "edge-2") as {
			hlc_modified: number | null;
		};
		expect(edge1.hlc_modified).not.toBeNull();
		expect(edge2.hlc_modified).toBeNull();

		// Verify audit entries for edge sync
		const auditRows = await db.execute(
			"SELECT operation, edge_id FROM audit_log WHERE operation = 'SYNC_SEND' AND edge_id IS NOT NULL",
		);
		expect(auditRows.rows.length).toBe(1);
		expect((auditRows.rows[0] as { edge_id: string }).edge_id).toBe("edge-1");
	});

	it("returns bridgeEdgesPushed=0 when no bridgeDb provided", async () => {
		const result = createTestDb();
		const db = result.db;
		tmpDir = result.tmpDir;

		await db.execute(ENTITY_INSERT, entityRow("e1", "team", 100, null));

		const pushResult = await pushChanges(db, CONFIG);
		expect(pushResult.bridgeEdgesPushed).toBe(0);
	});

	it("uses HLC timestamp when repoHash is provided", async () => {
		const result = createTestDb();
		const db = result.db;
		tmpDir = result.tmpDir;

		await db.execute(ENTITY_INSERT, entityRow("e1", "team", 100, null));

		const pushResult = await pushChanges(db, CONFIG, undefined, result.repoHash, result.tmpDir);
		expect(pushResult.entitiesPushed).toBe(1);

		// Verify synced_at is set (will be the HLC wall-clock ms)
		const rows = await db.execute("SELECT synced_at FROM entities WHERE id = 'e1'");
		const syncedAt = (rows.rows[0] as { synced_at: number }).synced_at;
		expect(syncedAt).toBeGreaterThan(0);
	});
});
