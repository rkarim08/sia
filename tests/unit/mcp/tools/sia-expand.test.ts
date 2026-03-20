import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SiaDb } from "@/graph/db-interface";
import { openGraphDb } from "@/graph/semantic-db";
import type { SiaExpandError, SiaExpandResult } from "@/mcp/tools/sia-expand";
import { handleSiaExpand } from "@/mcp/tools/sia-expand";

function isError(result: SiaExpandResult | SiaExpandError): result is SiaExpandError {
	return "error" in result;
}

describe("sia_expand tool", () => {
	let tmpDir: string;
	let db: SiaDb | undefined;

	function makeTmp(): string {
		const dir = join(tmpdir(), `sia-test-${randomUUID()}`);
		mkdirSync(dir, { recursive: true });
		return dir;
	}

	/** Insert a minimal entity directly. */
	async function insertTestEntity(
		siaDb: SiaDb,
		opts: {
			id: string;
			name: string;
			importance?: number;
			invalidated?: boolean;
		},
	): Promise<void> {
		const now = Date.now();
		await siaDb.execute(
			`INSERT INTO graph_nodes (
				id, type, name, content, summary,
				tags, file_paths, trust_tier, confidence, base_confidence,
				importance, base_importance, access_count, edge_count,
				last_accessed, created_at,
				t_created, t_expired, t_valid_from, t_valid_until,
				visibility, created_by
			) VALUES (
				?, 'Concept', ?, 'test content', 'test summary',
				'[]', '[]', 3, 0.7, 0.7,
				?, 0.5, 0, 0,
				?, ?,
				?, NULL, NULL, ?,
				'private', 'dev-1'
			)`,
			[opts.id, opts.name, opts.importance ?? 0.5, now, now, now, opts.invalidated ? now : null],
		);
	}

	/** Insert an edge directly. */
	async function insertTestEdge(
		siaDb: SiaDb,
		opts: {
			fromId: string;
			toId: string;
			type: string;
			invalidated?: boolean;
		},
	): Promise<string> {
		const edgeId = randomUUID();
		const now = Date.now();
		await siaDb.execute(
			`INSERT INTO graph_edges (
				id, from_id, to_id, type, weight, confidence, trust_tier,
				t_created, t_expired, t_valid_from, t_valid_until
			) VALUES (?, ?, ?, ?, 1.0, 0.7, 3, ?, NULL, NULL, ?)`,
			[edgeId, opts.fromId, opts.toId, opts.type, now, opts.invalidated ? now : null],
		);
		return edgeId;
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
	// Depth 1 returns only direct neighbors
	// ---------------------------------------------------------------

	it("depth 1 returns only direct neighbors", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("expand-depth1", tmpDir);

		// Create A -> B -> C chain
		const idA = randomUUID();
		const idB = randomUUID();
		const idC = randomUUID();

		await insertTestEntity(db, { id: idA, name: "Entity A" });
		await insertTestEntity(db, { id: idB, name: "Entity B" });
		await insertTestEntity(db, { id: idC, name: "Entity C" });

		await insertTestEdge(db, { fromId: idA, toId: idB, type: "relates_to" });
		await insertTestEdge(db, { fromId: idB, toId: idC, type: "relates_to" });

		const result = await handleSiaExpand(db, { entity_id: idA, depth: 1 });

		expect(isError(result)).toBe(false);
		if (isError(result)) return;

		expect(result.entity.id).toBe(idA);
		expect(result.neighbors).toHaveLength(1);
		expect(result.neighbors[0]?.id).toBe(idB);
		// Should NOT include C at depth 1
		expect(result.neighbors.some((n) => n.id === idC)).toBe(false);
	});

	// ---------------------------------------------------------------
	// Depth 2 returns transitive neighbors
	// ---------------------------------------------------------------

	it("depth 2 returns transitive neighbors", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("expand-depth2", tmpDir);

		const idA = randomUUID();
		const idB = randomUUID();
		const idC = randomUUID();

		await insertTestEntity(db, { id: idA, name: "Entity A" });
		await insertTestEntity(db, { id: idB, name: "Entity B" });
		await insertTestEntity(db, { id: idC, name: "Entity C" });

		await insertTestEdge(db, { fromId: idA, toId: idB, type: "relates_to" });
		await insertTestEdge(db, { fromId: idB, toId: idC, type: "relates_to" });

		const result = await handleSiaExpand(db, { entity_id: idA, depth: 2 });

		expect(isError(result)).toBe(false);
		if (isError(result)) return;

		expect(result.entity.id).toBe(idA);
		expect(result.neighbors).toHaveLength(2);
		const neighborIds = result.neighbors.map((n) => n.id);
		expect(neighborIds).toContain(idB);
		expect(neighborIds).toContain(idC);
	});

	// ---------------------------------------------------------------
	// Respects 50-entity cap
	// ---------------------------------------------------------------

	it("respects 50-entity cap", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("expand-cap", tmpDir);

		const rootId = randomUUID();
		await insertTestEntity(db, { id: rootId, name: "Root" });

		// Create 60 neighbors connected to root
		for (let i = 0; i < 60; i++) {
			const neighborId = randomUUID();
			await insertTestEntity(db, { id: neighborId, name: `Neighbor ${i}` });
			await insertTestEdge(db, { fromId: rootId, toId: neighborId, type: "relates_to" });
		}

		const result = await handleSiaExpand(db, { entity_id: rootId, depth: 1 });

		expect(isError(result)).toBe(false);
		if (isError(result)) return;

		// Root + up to 49 neighbors = 50 total in visited set
		// neighbors array should contain at most 49 entities (root excluded)
		expect(result.neighbors.length).toBeLessThanOrEqual(49);
		// Total entity count (root + neighbors) should not exceed 50
		expect(result.neighbors.length + 1).toBeLessThanOrEqual(50);
	});

	// ---------------------------------------------------------------
	// edge_types filter works
	// ---------------------------------------------------------------

	it("edge_types filter restricts traversal to specified types", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("expand-filter", tmpDir);

		const idA = randomUUID();
		const idB = randomUUID();
		const idC = randomUUID();

		await insertTestEntity(db, { id: idA, name: "Entity A" });
		await insertTestEntity(db, { id: idB, name: "Entity B" });
		await insertTestEntity(db, { id: idC, name: "Entity C" });

		await insertTestEdge(db, { fromId: idA, toId: idB, type: "calls" });
		await insertTestEdge(db, { fromId: idA, toId: idC, type: "imports" });

		// Only follow "calls" edges
		const result = await handleSiaExpand(db, {
			entity_id: idA,
			depth: 1,
			edge_types: ["calls"],
		});

		expect(isError(result)).toBe(false);
		if (isError(result)) return;

		expect(result.neighbors).toHaveLength(1);
		expect(result.neighbors[0]?.id).toBe(idB);
		// C should not appear because its edge type is "imports"
		expect(result.neighbors.some((n) => n.id === idC)).toBe(false);
	});

	// ---------------------------------------------------------------
	// Non-existent entity returns error
	// ---------------------------------------------------------------

	it("non-existent entity returns error", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("expand-missing", tmpDir);

		const result = await handleSiaExpand(db, { entity_id: "nonexistent-id" });

		expect(isError(result)).toBe(true);
		if (!isError(result)) return;

		expect(result.error).toContain("nonexistent-id");
	});

	// ---------------------------------------------------------------
	// Invalidated edges excluded
	// ---------------------------------------------------------------

	it("invalidated edges are excluded from traversal", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("expand-invalidated-edges", tmpDir);

		const idA = randomUUID();
		const idB = randomUUID();
		const idC = randomUUID();

		await insertTestEntity(db, { id: idA, name: "Entity A" });
		await insertTestEntity(db, { id: idB, name: "Entity B" });
		await insertTestEntity(db, { id: idC, name: "Entity C" });

		// Active edge A->B
		await insertTestEdge(db, { fromId: idA, toId: idB, type: "relates_to" });
		// Invalidated edge A->C
		await insertTestEdge(db, {
			fromId: idA,
			toId: idC,
			type: "relates_to",
			invalidated: true,
		});

		const result = await handleSiaExpand(db, { entity_id: idA, depth: 1 });

		expect(isError(result)).toBe(false);
		if (isError(result)) return;

		expect(result.neighbors).toHaveLength(1);
		expect(result.neighbors[0]?.id).toBe(idB);
		// C should not appear because the edge is invalidated
		expect(result.neighbors.some((n) => n.id === idC)).toBe(false);
	});

	// ---------------------------------------------------------------
	// Invalidated root entity returns error
	// ---------------------------------------------------------------

	it("invalidated root entity returns error", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("expand-invalidated-root", tmpDir);

		const rootId = randomUUID();
		await insertTestEntity(db, { id: rootId, name: "Invalidated Root", invalidated: true });

		const result = await handleSiaExpand(db, { entity_id: rootId });

		expect(isError(result)).toBe(true);
		if (!isError(result)) return;

		expect(result.error).toContain(rootId);
	});

	// ---------------------------------------------------------------
	// edge_count reflects total before cap
	// ---------------------------------------------------------------

	it("edge_count reflects total edges found during BFS", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("expand-edge-count", tmpDir);

		const rootId = randomUUID();
		await insertTestEntity(db, { id: rootId, name: "Root" });

		const neighborIds: string[] = [];
		for (let i = 0; i < 5; i++) {
			const nid = randomUUID();
			neighborIds.push(nid);
			await insertTestEntity(db, { id: nid, name: `Neighbor ${i}` });
			await insertTestEdge(db, { fromId: rootId, toId: nid, type: "relates_to" });
		}

		const result = await handleSiaExpand(db, { entity_id: rootId, depth: 1 });

		expect(isError(result)).toBe(false);
		if (isError(result)) return;

		expect(result.neighbors).toHaveLength(5);
		expect(result.edge_count).toBe(5);
		expect(result.edges).toHaveLength(5);
	});

	// ---------------------------------------------------------------
	// Default depth is 1
	// ---------------------------------------------------------------

	it("default depth is 1 when not specified", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("expand-default-depth", tmpDir);

		const idA = randomUUID();
		const idB = randomUUID();
		const idC = randomUUID();

		await insertTestEntity(db, { id: idA, name: "Entity A" });
		await insertTestEntity(db, { id: idB, name: "Entity B" });
		await insertTestEntity(db, { id: idC, name: "Entity C" });

		await insertTestEdge(db, { fromId: idA, toId: idB, type: "relates_to" });
		await insertTestEdge(db, { fromId: idB, toId: idC, type: "relates_to" });

		// No depth specified — should default to 1
		const result = await handleSiaExpand(db, { entity_id: idA });

		expect(isError(result)).toBe(false);
		if (isError(result)) return;

		expect(result.neighbors).toHaveLength(1);
		expect(result.neighbors[0]?.id).toBe(idB);
	});
});
