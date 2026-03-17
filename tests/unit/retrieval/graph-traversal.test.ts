import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SiaDb } from "@/graph/db-interface";
import { insertEdge } from "@/graph/edges";
import { insertEntity, invalidateEntity } from "@/graph/entities";
import { openGraphDb } from "@/graph/semantic-db";
import { graphTraversalSearch } from "@/retrieval/graph-traversal";

describe("graph-traversal search signal", () => {
	let tmpDir: string;
	let db: SiaDb | undefined;

	function makeTmp(): string {
		const dir = join(tmpdir(), `sia-graph-trav-test-${randomUUID()}`);
		mkdirSync(dir, { recursive: true });
		return dir;
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

	it("known entity name returns at score 1.0", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("gt-known", tmpDir);

		const entity = await insertEntity(db, {
			type: "Concept",
			name: "TokenStore",
			content: "Token storage module",
			summary: "Stores tokens",
		});

		const results = await graphTraversalSearch(db, "TokenStore");

		expect(results.length).toBeGreaterThanOrEqual(1);
		const match = results.find((r) => r.entityId === entity.id);
		expect(match).toBeDefined();
		expect(match?.score).toBe(1.0);
	});

	it("neighbors of matched entity appear at score 0.7", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("gt-neighbor", tmpDir);

		const entityA = await insertEntity(db, {
			type: "Concept",
			name: "AuthService",
			content: "Authentication service",
			summary: "Auth",
		});

		const entityB = await insertEntity(db, {
			type: "Concept",
			name: "UserStore",
			content: "User persistence layer",
			summary: "Users",
		});

		await insertEdge(db, {
			from_id: entityA.id,
			to_id: entityB.id,
			type: "DEPENDS_ON",
		});

		const results = await graphTraversalSearch(db, "AuthService");

		// A should be direct match at 1.0
		const matchA = results.find((r) => r.entityId === entityA.id);
		expect(matchA).toBeDefined();
		expect(matchA?.score).toBe(1.0);

		// B should be neighbor at 0.7
		const matchB = results.find((r) => r.entityId === entityB.id);
		expect(matchB).toBeDefined();
		expect(matchB?.score).toBe(0.7);
	});

	it("no duplicate IDs in results", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("gt-nodup", tmpDir);

		const entityA = await insertEntity(db, {
			type: "Concept",
			name: "CacheManager",
			content: "Cache management",
			summary: "Cache",
		});

		const entityB = await insertEntity(db, {
			type: "Concept",
			name: "CacheStore",
			content: "Cache storage backend",
			summary: "Store",
		});

		// Create two edges so B could appear twice as neighbor via different paths
		await insertEdge(db, {
			from_id: entityA.id,
			to_id: entityB.id,
			type: "DEPENDS_ON",
		});
		await insertEdge(db, {
			from_id: entityB.id,
			to_id: entityA.id,
			type: "USED_BY",
		});

		const results = await graphTraversalSearch(db, "CacheManager CacheStore");

		const ids = results.map((r) => r.entityId);
		const unique = new Set(ids);
		expect(ids.length).toBe(unique.size);
	});

	it("unknown query returns empty", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("gt-unknown", tmpDir);

		await insertEntity(db, {
			type: "Concept",
			name: "SomeEntity",
			content: "Existing entity",
			summary: "Exists",
		});

		const results = await graphTraversalSearch(db, "CompletelyNonexistentXyzzy");

		expect(results).toHaveLength(0);
	});

	it("invalidated entities excluded", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("gt-invalidated", tmpDir);

		const active = await insertEntity(db, {
			type: "Concept",
			name: "ActiveModule",
			content: "Still valid",
			summary: "Active",
		});

		const invalidated = await insertEntity(db, {
			type: "Concept",
			name: "OldModule",
			content: "No longer valid",
			summary: "Old",
		});
		await invalidateEntity(db, invalidated.id);

		const results = await graphTraversalSearch(db, "ActiveModule OldModule");

		// Active should be found
		const matchActive = results.find((r) => r.entityId === active.id);
		expect(matchActive).toBeDefined();
		expect(matchActive?.score).toBe(1.0);

		// Invalidated should NOT appear
		const matchInvalidated = results.find((r) => r.entityId === invalidated.id);
		expect(matchInvalidated).toBeUndefined();
	});
});
