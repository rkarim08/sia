import { rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import type { Entity } from "@/graph/entities";
import { deduplicateEntities } from "@/sync/dedup";
import { createTestDb } from "./helpers";

function makeEntity(overrides: Partial<Entity>): Entity {
	return {
		id: "id",
		type: "Concept",
		name: "Name",
		content: "content",
		summary: "summary",
		package_path: null,
		tags: "[]",
		file_paths: "[]",
		trust_tier: 3,
		confidence: 0.7,
		base_confidence: 0.7,
		importance: 0.5,
		base_importance: 0.5,
		access_count: 0,
		edge_count: 0,
		last_accessed: Date.now(),
		created_at: Date.now(),
		t_created: Date.now(),
		t_expired: null,
		t_valid_from: null,
		t_valid_until: null,
		visibility: "team",
		created_by: "local",
		workspace_scope: null,
		hlc_created: null,
		hlc_modified: null,
		synced_at: null,
		conflict_group_id: null,
		source_episode: null,
		extraction_method: null,
		extraction_model: null,
		embedding: null,
		archived_at: null,
		...overrides,
	};
}

let tmpDir: string | undefined;

afterEach(() => {
	if (tmpDir) {
		rmSync(tmpDir, { recursive: true, force: true });
		tmpDir = undefined;
	}
});

const now = Date.now();

const ENTITY_INSERT = `INSERT INTO entities (
	id, type, name, content, summary, package_path,
	tags, file_paths, trust_tier, confidence, base_confidence,
	importance, base_importance, access_count, edge_count,
	last_accessed, created_at, t_created, t_expired, t_valid_from, t_valid_until,
	visibility, created_by, workspace_scope, hlc_created, hlc_modified, synced_at,
	conflict_group_id, source_episode, extraction_method, extraction_model, embedding, archived_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

describe("deduplicateEntities", () => {
	it("logs merged and different decisions and writes to sync_dedup_log", async () => {
		const result = createTestDb();
		const db = result.db;
		tmpDir = result.tmpDir;

		const local = makeEntity({ id: "local-1", name: "My Function" });
		await db.execute(ENTITY_INSERT, [
			local.id,
			local.type,
			local.name,
			local.content,
			local.summary,
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
			local.visibility,
			local.created_by,
			null,
			null,
			null,
			null,
			null,
			null,
			null,
			null,
			null,
			null,
		]);

		const peers: Entity[] = [
			makeEntity({ id: "peer-1", name: "My Function", created_by: "peer" }),
			makeEntity({ id: "peer-2", name: "Completely Different", created_by: "peer" }),
		];

		const dedupResult = await deduplicateEntities(db, peers);
		expect(dedupResult.merged).toBeGreaterThanOrEqual(1);
		expect(dedupResult.different).toBeGreaterThanOrEqual(1);

		const log = await db.execute("SELECT COUNT(*) as count FROM sync_dedup_log");
		expect((log.rows[0] as { count: number }).count).toBe(2);
	});

	it("normalizeName preserves hyphens and underscores", async () => {
		const result = createTestDb();
		const db = result.db;
		tmpDir = result.tmpDir;

		// Insert a local entity with a hyphenated name
		const local = makeEntity({ id: "local-hy", name: "my-function_name" });
		await db.execute(ENTITY_INSERT, [
			local.id,
			local.type,
			local.name,
			local.content,
			local.summary,
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
			local.visibility,
			local.created_by,
			null,
			null,
			null,
			null,
			null,
			null,
			null,
			null,
			null,
			null,
		]);

		// A peer with the same hyphenated name should be detected as merged (Layer 1 exact name match)
		const peers: Entity[] = [
			makeEntity({ id: "peer-hy", name: "my-function_name", created_by: "peer" }),
		];

		const dedupResult = await deduplicateEntities(db, peers);
		expect(dedupResult.merged).toBe(1);
	});

	it("Layer 1: exact name match still merges correctly", async () => {
		const result = createTestDb();
		const db = result.db;
		tmpDir = result.tmpDir;

		await db.execute(ENTITY_INSERT, [
			"local-x",
			"Concept",
			"ExactName",
			"some content",
			"s",
			null,
			'["tag1"]',
			'["file1.ts"]',
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
			"local",
			null,
			null,
			null,
			null,
			null,
			null,
			null,
			null,
			null,
			null,
		]);

		const peers: Entity[] = [
			makeEntity({
				id: "peer-x",
				name: "ExactName",
				tags: '["tag2"]',
				file_paths: '["file2.ts"]',
				created_by: "peer",
			}),
		];

		const dedupResult = await deduplicateEntities(db, peers);
		expect(dedupResult.merged).toBe(1);

		// After merge, the surviving entity should have unioned tags
		const rows = await db.execute("SELECT tags, file_paths FROM entities WHERE id = 'local-x'");
		const row = rows.rows[0] as { tags: string; file_paths: string };
		const tags = JSON.parse(row.tags);
		const filePaths = JSON.parse(row.file_paths);
		expect(tags).toContain("tag1");
		expect(tags).toContain("tag2");
		expect(filePaths).toContain("file1.ts");
		expect(filePaths).toContain("file2.ts");
	});
});
