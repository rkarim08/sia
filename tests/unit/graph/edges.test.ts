import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SiaDb } from "@/graph/db-interface";
import * as edgesModule from "@/graph/edges";
import { getActiveEdges, getEdgesAsOf, insertEdge, invalidateEdge } from "@/graph/edges";
import { openGraphDb } from "@/graph/semantic-db";

describe("edge CRUD layer", () => {
	let tmpDir: string;
	let db: SiaDb | undefined;

	function makeTmp(): string {
		const dir = join(tmpdir(), `sia-test-${randomUUID()}`);
		mkdirSync(dir, { recursive: true });
		return dir;
	}

	/** Insert a minimal entity so FK constraints are satisfied. */
	async function insertEntity(siaDb: SiaDb, id: string, name: string): Promise<void> {
		const now = Date.now();
		await siaDb.execute(
			`INSERT INTO entities (
				id, type, name, content, summary,
				tags, file_paths, trust_tier, confidence, base_confidence,
				importance, base_importance, access_count, edge_count,
				last_accessed, created_at,
				t_created, t_expired, t_valid_from, t_valid_until,
				visibility, created_by
			) VALUES (
				?, 'Concept', ?, 'test content', 'test summary',
				'[]', '[]', 3, 0.7, 0.7,
				0.5, 0.5, 0, 0,
				?, ?,
				?, NULL, NULL, NULL,
				'private', 'dev-1'
			)`,
			[id, name, now, now, now],
		);
	}

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
	// Insert edge and retrieve it
	// ---------------------------------------------------------------

	it("insertEdge creates an edge and it is retrievable", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("edges-insert", tmpDir);

		const eA = randomUUID();
		const eB = randomUUID();
		await insertEntity(db, eA, "Entity A");
		await insertEntity(db, eB, "Entity B");

		const edge = await insertEdge(db, {
			from_id: eA,
			to_id: eB,
			type: "relates_to",
			weight: 0.9,
			confidence: 0.8,
			trust_tier: 2,
		});

		expect(edge.id).toBeDefined();
		expect(edge.from_id).toBe(eA);
		expect(edge.to_id).toBe(eB);
		expect(edge.type).toBe("relates_to");
		expect(edge.weight).toBe(0.9);
		expect(edge.confidence).toBe(0.8);
		expect(edge.trust_tier).toBe(2);
		expect(edge.t_created).toBeTypeOf("number");
		expect(edge.t_valid_until).toBeNull();

		// Verify in DB
		const result = await db.execute("SELECT * FROM edges WHERE id = ?", [edge.id]);
		expect(result.rows).toHaveLength(1);
		expect(result.rows[0]?.from_id).toBe(eA);
		expect(result.rows[0]?.to_id).toBe(eB);

		// Verify audit log entry
		const audit = await db.execute(
			"SELECT * FROM audit_log WHERE edge_id = ? AND operation = 'ADD'",
			[edge.id],
		);
		expect(audit.rows).toHaveLength(1);
	});

	// ---------------------------------------------------------------
	// invalidateEdge sets both t_valid_until and t_expired
	// ---------------------------------------------------------------

	it("invalidateEdge sets both t_valid_until and t_expired", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("edges-invalidate", tmpDir);

		const eA = randomUUID();
		const eB = randomUUID();
		await insertEntity(db, eA, "Entity A");
		await insertEntity(db, eB, "Entity B");

		const edge = await insertEdge(db, {
			from_id: eA,
			to_id: eB,
			type: "calls",
		});

		const invalidationTs = Date.now() + 1000;
		await invalidateEdge(db, edge.id, invalidationTs);

		const result = await db.execute("SELECT * FROM edges WHERE id = ?", [edge.id]);
		expect(result.rows).toHaveLength(1);

		const row = result.rows[0]!;
		expect(row.t_valid_until).toBe(invalidationTs);
		expect(row.t_expired).toBe(invalidationTs);

		// Verify audit log entry for INVALIDATE
		const audit = await db.execute(
			"SELECT * FROM audit_log WHERE edge_id = ? AND operation = 'INVALIDATE'",
			[edge.id],
		);
		expect(audit.rows).toHaveLength(1);
	});

	// ---------------------------------------------------------------
	// After invalidation, getActiveEdges returns empty
	// ---------------------------------------------------------------

	it("getActiveEdges returns empty after invalidation", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("edges-active-empty", tmpDir);

		const eA = randomUUID();
		const eB = randomUUID();
		await insertEntity(db, eA, "Entity A");
		await insertEntity(db, eB, "Entity B");

		const edge = await insertEdge(db, {
			from_id: eA,
			to_id: eB,
			type: "depends_on",
		});

		// Before invalidation: should find the edge
		const activeBefore = await getActiveEdges(db, eA);
		expect(activeBefore).toHaveLength(1);
		expect(activeBefore[0]?.id).toBe(edge.id);

		// Also findable via to_id
		const activeBeforeB = await getActiveEdges(db, eB);
		expect(activeBeforeB).toHaveLength(1);

		// Invalidate
		await invalidateEdge(db, edge.id);

		// After invalidation: should be empty for both endpoints
		const activeAfterA = await getActiveEdges(db, eA);
		expect(activeAfterA).toHaveLength(0);

		const activeAfterB = await getActiveEdges(db, eB);
		expect(activeAfterB).toHaveLength(0);
	});

	// ---------------------------------------------------------------
	// getEdgesAsOf returns edge between creation and invalidation
	// ---------------------------------------------------------------

	it("getEdgesAsOf returns edge with timestamp between creation and invalidation", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("edges-as-of-between", tmpDir);

		const eA = randomUUID();
		const eB = randomUUID();
		await insertEntity(db, eA, "Entity A");
		await insertEntity(db, eB, "Entity B");

		// Insert edge with explicit t_valid_from
		const creationTime = 1000;
		const invalidationTime = 5000;
		const queryTime = 3000; // between creation and invalidation

		// Insert edge directly with controlled timestamps for deterministic testing
		const edgeId = randomUUID();
		await db.execute(
			`INSERT INTO edges (
				id, from_id, to_id, type, weight, confidence, trust_tier,
				t_created, t_expired, t_valid_from, t_valid_until
			) VALUES (?, ?, ?, 'relates_to', 1.0, 0.7, 3, ?, NULL, ?, ?)`,
			[edgeId, eA, eB, creationTime, creationTime, invalidationTime],
		);

		// Query at a time between creation and invalidation
		const edges = await getEdgesAsOf(db, eA, queryTime);
		expect(edges).toHaveLength(1);
		expect(edges[0]?.id).toBe(edgeId);

		// Also findable via to_id
		const edgesB = await getEdgesAsOf(db, eB, queryTime);
		expect(edgesB).toHaveLength(1);
		expect(edgesB[0]?.id).toBe(edgeId);
	});

	// ---------------------------------------------------------------
	// getEdgesAsOf does NOT return edge after invalidation
	// ---------------------------------------------------------------

	it("getEdgesAsOf does NOT return edge with timestamp after invalidation", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("edges-as-of-after", tmpDir);

		const eA = randomUUID();
		const eB = randomUUID();
		await insertEntity(db, eA, "Entity A");
		await insertEntity(db, eB, "Entity B");

		const creationTime = 1000;
		const invalidationTime = 5000;
		const queryTime = 7000; // after invalidation

		const edgeId = randomUUID();
		await db.execute(
			`INSERT INTO edges (
				id, from_id, to_id, type, weight, confidence, trust_tier,
				t_created, t_expired, t_valid_from, t_valid_until
			) VALUES (?, ?, ?, 'relates_to', 1.0, 0.7, 3, ?, NULL, ?, ?)`,
			[edgeId, eA, eB, creationTime, creationTime, invalidationTime],
		);

		// Query at a time after invalidation
		const edges = await getEdgesAsOf(db, eA, queryTime);
		expect(edges).toHaveLength(0);

		const edgesB = await getEdgesAsOf(db, eB, queryTime);
		expect(edgesB).toHaveLength(0);
	});

	// ---------------------------------------------------------------
	// No delete function exported
	// ---------------------------------------------------------------

	it("does not export any delete function", () => {
		const exportedKeys = Object.keys(edgesModule);
		const hasDelete = exportedKeys.some(
			(k) => k.toLowerCase().includes("delete") || k.toLowerCase().includes("remove"),
		);
		expect(hasDelete).toBe(false);
	});
});
