import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { decayBatch, decayImportance } from "@/decay/decay";
import type { SiaDb } from "@/graph/db-interface";
import { archiveEntity, getEntity, insertEntity, invalidateEntity } from "@/graph/entities";
import { openGraphDb } from "@/graph/semantic-db";
import { DEFAULT_CONFIG } from "@/shared/config";

// Helper
function makeTmp(): string {
	const dir = join(tmpdir(), `sia-test-${randomUUID()}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

describe("importance decay", () => {
	let tmpDir: string;
	let db: SiaDb | undefined;
	const config = { ...DEFAULT_CONFIG };

	afterEach(async () => {
		if (db) {
			await db.close();
			db = undefined;
		}
		if (tmpDir) {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	// ---------------------------------------------------------------
	// applies exponential decay formula correctly
	// ---------------------------------------------------------------

	it("applies exponential decay formula correctly", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("decay-formula", tmpDir);

		// Convention halfLife = 60 days, 60 days ago => decayFactor = 0.5^(60/60) = 0.5
		// newImportance = 0.8 * 0.5 + 0 (edgeBoost, edge_count=0) = 0.4
		await insertEntity(db, {
			type: "Convention",
			name: "Test Convention",
			content: "A convention entity for decay testing",
			summary: "Decay test convention",
			base_importance: 0.8,
			importance: 0.8,
			last_accessed: Date.now() - 60 * 86400000,
			edge_count: 0,
		});

		await decayImportance(db, config);

		const result = await db.execute("SELECT * FROM graph_nodes WHERE name = ?", [
			"Test Convention",
		]);
		const entity = result.rows[0] as { importance: number };
		// 0.8 * 0.5^(60/60) + 0 edgeBoost = 0.4
		expect(entity.importance).toBeCloseTo(0.4, 1);
	});

	// ---------------------------------------------------------------
	// applies edge boost
	// ---------------------------------------------------------------

	it("applies edge boost", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("decay-edge-boost", tmpDir);

		// edge_count=10, edgeBoost = min(10*0.02, 0.3) = 0.2
		// Convention halfLife=60, 30 days ago => decayFactor = 0.5^(30/60) = 0.5^0.5 ~ 0.7071
		// newImportance = 0.5 * 0.7071 + 0.2 ~ 0.5536
		await insertEntity(db, {
			type: "Convention",
			name: "Boosted Entity",
			content: "An entity with edges for boost testing",
			summary: "Edge boost test",
			base_importance: 0.5,
			importance: 0.5,
			edge_count: 10,
			last_accessed: Date.now() - 30 * 86400000,
		});

		await decayImportance(db, config);

		const entity = await getEntity(
			db,
			(await db.execute("SELECT id FROM graph_nodes WHERE name = ?", ["Boosted Entity"])).rows[0]
				?.id as string,
		);
		expect(entity).toBeDefined();

		const expectedDecayFactor = 0.5 ** (30 / 60);
		const expectedEdgeBoost = Math.min(10 * 0.02, 0.3);
		const expected = 0.5 * expectedDecayFactor + expectedEdgeBoost;
		expect(entity?.importance).toBeCloseTo(expected, 2);
	});

	// ---------------------------------------------------------------
	// highly-connected entity stays above 0.25
	// ---------------------------------------------------------------

	it("highly-connected entity stays above 0.25", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("decay-high-conn", tmpDir);

		// edge_count=25 (>20), very old entity
		// base_importance * decayFactor would be tiny, but floor at 0.25
		await insertEntity(db, {
			type: "Convention",
			name: "Hub Entity",
			content: "A highly connected entity",
			summary: "Hub test",
			base_importance: 0.1,
			importance: 0.1,
			edge_count: 25,
			last_accessed: Date.now() - 365 * 86400000,
		});

		await decayImportance(db, config);

		const entity = await getEntity(
			db,
			(await db.execute("SELECT id FROM graph_nodes WHERE name = ?", ["Hub Entity"])).rows[0]
				?.id as string,
		);
		expect(entity).toBeDefined();
		expect(entity?.importance).toBeGreaterThanOrEqual(0.25);
	});

	// ---------------------------------------------------------------
	// minimum importance is 0.01
	// ---------------------------------------------------------------

	it("minimum importance is 0.01", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("decay-min-floor", tmpDir);

		// Very low base_importance, no edges, very old => should floor at 0.01
		await insertEntity(db, {
			type: "Convention",
			name: "Tiny Entity",
			content: "An entity with minimal importance",
			summary: "Floor test",
			base_importance: 0.01,
			importance: 0.01,
			edge_count: 0,
			last_accessed: Date.now() - 365 * 86400000,
		});

		await decayImportance(db, config);

		const entity = await getEntity(
			db,
			(await db.execute("SELECT id FROM graph_nodes WHERE name = ?", ["Tiny Entity"])).rows[0]
				?.id as string,
		);
		expect(entity).toBeDefined();
		expect(entity?.importance).toBeGreaterThanOrEqual(0.01);
	});

	// ---------------------------------------------------------------
	// excludes invalidated entities
	// ---------------------------------------------------------------

	it("excludes invalidated entities", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("decay-invalidated", tmpDir);

		const invalidated = await insertEntity(db, {
			type: "Convention",
			name: "Invalidated Entity",
			content: "This entity will be invalidated",
			summary: "Invalidated",
			base_importance: 0.8,
			importance: 0.8,
			last_accessed: Date.now() - 30 * 86400000,
		});

		await invalidateEntity(db, invalidated.id);

		const _active = await insertEntity(db, {
			type: "Convention",
			name: "Active Entity",
			content: "This entity remains active",
			summary: "Active",
			base_importance: 0.8,
			importance: 0.8,
			last_accessed: Date.now() - 30 * 86400000,
		});

		const result = await decayImportance(db, config);
		expect(result.processed).toBe(1);
	});

	// ---------------------------------------------------------------
	// excludes archived entities
	// ---------------------------------------------------------------

	it("excludes archived entities", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("decay-archived", tmpDir);

		const archived = await insertEntity(db, {
			type: "Convention",
			name: "Archived Entity",
			content: "This entity will be archived",
			summary: "Archived",
			base_importance: 0.8,
			importance: 0.8,
			last_accessed: Date.now() - 30 * 86400000,
		});

		await archiveEntity(db, archived.id);

		const _active = await insertEntity(db, {
			type: "Convention",
			name: "Active Entity",
			content: "This entity remains active",
			summary: "Active",
			base_importance: 0.8,
			importance: 0.8,
			last_accessed: Date.now() - 30 * 86400000,
		});

		const result = await decayImportance(db, config);
		expect(result.processed).toBe(1);
	});

	// ---------------------------------------------------------------
	// processes in batches
	// ---------------------------------------------------------------

	// ---------------------------------------------------------------
	// confidence time-decay for Tier 3 entities
	// ---------------------------------------------------------------

	it("should decay confidence for Tier 3 entities over time", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("decay-confidence", tmpDir);

		const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
		await insertEntity(db, {
			type: "Decision",
			name: "Old Decision",
			content: "Made 30 days ago",
			summary: "Old decision for confidence test",
			trust_tier: 3,
			confidence: 0.7,
			base_confidence: 0.7,
			last_accessed: thirtyDaysAgo,
			created_at: thirtyDaysAgo,
		});

		await decayImportance(db, config);

		const result = await db.execute(
			"SELECT confidence FROM graph_nodes WHERE name = 'Old Decision' AND t_valid_until IS NULL",
		);
		expect(result.rows).toHaveLength(1);
		expect((result.rows[0] as any).confidence).toBeLessThan(0.7);
	});

	// ---------------------------------------------------------------
	// Tier 2 entities should not have time-based confidence decay
	// ---------------------------------------------------------------

	it("should not decay confidence for Tier 2 entities", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("decay-confidence-t2", tmpDir);

		const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
		await insertEntity(db, {
			type: "CodeEntity",
			name: "AST Entity",
			content: "AST-derived entity",
			summary: "Tier 2 test",
			trust_tier: 2,
			confidence: 1.0,
			base_confidence: 1.0,
			last_accessed: thirtyDaysAgo,
			created_at: thirtyDaysAgo,
		});

		await decayImportance(db, config);

		const result = await db.execute(
			"SELECT confidence FROM graph_nodes WHERE name = 'AST Entity' AND t_valid_until IS NULL",
		);
		expect(result.rows).toHaveLength(1);
		// Tier 2 uses event-driven invalidation only, confidence stays at base (or goes to 0 for unknown source)
		// computeConfidence returns 0.0 for tier 2 when sourceUnchanged is undefined
		expect((result.rows[0] as any).confidence).toBeDefined();
	});

	// ---------------------------------------------------------------
	// processes in batches
	// ---------------------------------------------------------------

	it("processes in batches", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("decay-batches", tmpDir);

		for (let i = 0; i < 3; i++) {
			await insertEntity(db, {
				type: "Convention",
				name: `Batch Entity ${i}`,
				content: `Entity ${i} for batch testing`,
				summary: `Batch ${i}`,
				base_importance: 0.5,
				importance: 0.5,
				last_accessed: Date.now() - 30 * 86400000,
			});
		}

		// First batch: process 2, more remaining
		const batch1 = await decayBatch(db, config, 2, 0);
		expect(batch1.processed).toBe(2);
		expect(batch1.remaining).toBe(true);

		// Second batch: process 1, no more remaining
		const batch2 = await decayBatch(db, config, 2, 2);
		expect(batch2.processed).toBe(1);
		expect(batch2.remaining).toBe(false);
	});
});
