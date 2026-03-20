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

const ENTITY_INSERT = `INSERT INTO graph_nodes (
	id, type, name, content, summary, package_path,
	tags, file_paths, trust_tier, confidence, base_confidence,
	importance, base_importance, access_count, edge_count,
	last_accessed, created_at, t_created, t_expired, t_valid_from, t_valid_until,
	visibility, created_by, workspace_scope, hlc_created, hlc_modified, synced_at,
	conflict_group_id, source_episode, extraction_method, extraction_model, embedding, archived_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

function entityRow(
	id: string,
	type: string,
	name: string,
	content: string,
	overrides?: {
		t_valid_from?: number | null;
		t_valid_until?: number | null;
		embedding?: Uint8Array | null;
	},
) {
	return [
		id,
		type,
		name,
		content,
		"s",
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
		overrides?.t_valid_from ?? null,
		overrides?.t_valid_until ?? null,
		"team",
		"dev",
		null,
		null,
		null,
		null,
		null,
		null,
		null,
		null,
		overrides?.embedding ?? null,
		null,
	];
}

describe("detectConflicts", () => {
	it("flags overlapping similar entities with conflict_group_id (wordJaccard fallback)", async () => {
		const result = createTestDb();
		const db = result.db;
		tmpDir = result.tmpDir;

		// These two share enough words for wordJaccard > 0.95 and have different content
		// 20 shared words + 1 extra = Jaccard 20/21 ≈ 0.952
		const sharedWords =
			"alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon";
		await db.execute(ENTITY_INSERT, entityRow("e1", "Concept", "A", sharedWords));
		await db.execute(ENTITY_INSERT, entityRow("e2", "Concept", "A", `${sharedWords} phi`));
		await db.execute(ENTITY_INSERT, entityRow("e3", "Decision", "B", "different"));

		const count = await detectConflicts(db);
		expect(count).toBe(1);

		const rows = await db.execute(
			"SELECT conflict_group_id FROM graph_nodes WHERE id IN ('e1','e2')",
		);
		for (const row of rows.rows as Array<{ conflict_group_id: string | null }>) {
			expect(row.conflict_group_id).not.toBeNull();
		}
	});

	it("does NOT flag entities with non-overlapping time ranges", async () => {
		const result = createTestDb();
		const db = result.db;
		tmpDir = result.tmpDir;

		// Entity A is valid from 1000 to 2000, Entity B from 3000 to 4000 — no overlap
		await db.execute(
			ENTITY_INSERT,
			entityRow("e1", "Concept", "A", "alpha beta gamma delta epsilon", {
				t_valid_from: 1000,
				t_valid_until: 2000,
			}),
		);
		await db.execute(
			ENTITY_INSERT,
			entityRow("e2", "Concept", "A", "alpha beta gamma delta epsilon zeta", {
				t_valid_from: 3000,
				t_valid_until: 4000,
			}),
		);

		const count = await detectConflicts(db);
		expect(count).toBe(0);
	});

	it("does NOT flag entities with different types", async () => {
		const result = createTestDb();
		const db = result.db;
		tmpDir = result.tmpDir;

		await db.execute(
			ENTITY_INSERT,
			entityRow("e1", "Concept", "A", "alpha beta gamma delta epsilon"),
		);
		await db.execute(
			ENTITY_INSERT,
			entityRow("e2", "Decision", "A", "alpha beta gamma delta epsilon zeta"),
		);

		const count = await detectConflicts(db);
		expect(count).toBe(0);
	});

	it("uses cosine similarity for entities with embeddings", async () => {
		const result = createTestDb();
		const db = result.db;
		tmpDir = result.tmpDir;

		// Create two near-identical embedding vectors (cosine > 0.85)
		const _dimCount = 4;
		const bufA = new Float32Array([0.5, 0.5, 0.5, 0.5]);
		const bufB = new Float32Array([0.5, 0.5, 0.5, 0.51]);
		const embA = new Uint8Array(bufA.buffer);
		const embB = new Uint8Array(bufB.buffer);

		// Content is different so contradiction check triggers
		await db.execute(
			ENTITY_INSERT,
			entityRow("e1", "Concept", "A", "description one", { embedding: embA }),
		);
		await db.execute(
			ENTITY_INSERT,
			entityRow("e2", "Concept", "A", "description two", { embedding: embB }),
		);

		const count = await detectConflicts(db);
		expect(count).toBe(1);
	});

	it("does NOT flag entities when cosine similarity is below 0.85", async () => {
		const result = createTestDb();
		const db = result.db;
		tmpDir = result.tmpDir;

		// Create two dissimilar embedding vectors (cosine < 0.85)
		const bufA = new Float32Array([1.0, 0.0, 0.0, 0.0]);
		const bufB = new Float32Array([0.0, 1.0, 0.0, 0.0]);
		const embA = new Uint8Array(bufA.buffer);
		const embB = new Uint8Array(bufB.buffer);

		await db.execute(
			ENTITY_INSERT,
			entityRow("e1", "Concept", "A", "description one", { embedding: embA }),
		);
		await db.execute(
			ENTITY_INSERT,
			entityRow("e2", "Concept", "A", "description two", { embedding: embB }),
		);

		const count = await detectConflicts(db);
		expect(count).toBe(0);
	});

	it("skips pairs where embedding magnitude difference > 0.3", async () => {
		const result = createTestDb();
		const db = result.db;
		tmpDir = result.tmpDir;

		// Same direction but very different magnitudes
		const bufA = new Float32Array([0.1, 0.1, 0.1, 0.1]);
		const bufB = new Float32Array([1.0, 1.0, 1.0, 1.0]);
		const embA = new Uint8Array(bufA.buffer);
		const embB = new Uint8Array(bufB.buffer);

		await db.execute(
			ENTITY_INSERT,
			entityRow("e1", "Concept", "A", "description one", { embedding: embA }),
		);
		await db.execute(
			ENTITY_INSERT,
			entityRow("e2", "Concept", "A", "description two", { embedding: embB }),
		);

		const count = await detectConflicts(db);
		expect(count).toBe(0);
	});
});
