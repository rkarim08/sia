import { rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { detectConflicts } from "@/sync/conflict";
import { createTestDb } from "./helpers";

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

function entityRow(id: string, type: string, name: string, content: string) {
	return [
		id, type, name, content, "s", null,
		"[]", "[]", 3, 0.7, 0.7, 0.5, 0.5, 0, 0, now, now, now, null, null, null,
		"team", "dev", null, null, null, null,
		null, null, null, null, null, null,
	];
}

describe("detectConflicts", () => {
	it("flags overlapping similar entities with conflict_group_id", async () => {
		const result = createTestDb();
		const db = result.db;
		tmpDir = result.tmpDir;

		await db.execute(ENTITY_INSERT, entityRow("e1", "Concept", "A", "alpha beta gamma"));
		await db.execute(ENTITY_INSERT, entityRow("e2", "Concept", "A", "alpha beta gamma alpha"));
		await db.execute(ENTITY_INSERT, entityRow("e3", "Decision", "B", "different"));

		const count = await detectConflicts(db);
		expect(count).toBe(1);

		const rows = await db.execute("SELECT conflict_group_id FROM entities WHERE id IN ('e1','e2')");
		for (const row of rows.rows as Array<{ conflict_group_id: string | null }>) {
			expect(row.conflict_group_id).not.toBeNull();
		}
	});
});
