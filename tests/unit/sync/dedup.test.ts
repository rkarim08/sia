import { describe, expect, it } from "vitest";
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

describe("deduplicateEntities", () => {
	it("logs merged and different decisions and writes to sync_dedup_log", async () => {
		const db = await createTestDb();
		const local = makeEntity({ id: "local-1", name: "My Function" });
		await db.execute(
			"INSERT INTO entities (id, type, name, content, summary, visibility, created_by, t_valid_from, t_valid_until, archived_at, conflict_group_id, hlc_modified, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
			[
				local.id,
				local.type,
				local.name,
				local.content,
				local.summary,
				local.visibility,
				local.created_by,
				null,
				null,
				null,
				null,
				null,
				null,
			],
		);

		const peers: Entity[] = [
			makeEntity({ id: "peer-1", name: "My Function", created_by: "peer" }),
			makeEntity({ id: "peer-2", name: "Completely Different", created_by: "peer" }),
		];

		const result = await deduplicateEntities(db, peers);
		expect(result.merged).toBeGreaterThanOrEqual(1);
		expect(result.different).toBeGreaterThanOrEqual(1);

		const log = await db.execute("SELECT COUNT(*) as count FROM sync_dedup_log");
		expect((log.rows[0] as { count: number }).count).toBe(2);
	});
});
