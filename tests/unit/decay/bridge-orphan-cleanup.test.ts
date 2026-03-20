import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { bridgeOrphanBatch, cleanupBridgeOrphans } from "@/decay/bridge-orphan-cleanup";
import { insertCrossRepoEdge, openBridgeDb } from "@/graph/bridge-db";
import type { SiaDb } from "@/graph/db-interface";
import { openMetaDb } from "@/graph/meta-db";
import { openGraphDb } from "@/graph/semantic-db";

function makeTmp(): string {
	const dir = join(tmpdir(), `sia-test-${randomUUID()}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

describe("bridgeOrphanBatch — null-check fallback (no metaDb)", () => {
	let tmpDir: string;
	let bridgeDb: SiaDb | undefined;

	afterEach(async () => {
		if (bridgeDb) {
			await bridgeDb.close();
			bridgeDb = undefined;
		}
		if (tmpDir) {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("returns 0 processed when there are no edges", async () => {
		tmpDir = makeTmp();
		bridgeDb = openBridgeDb(tmpDir);

		const result = await bridgeOrphanBatch(bridgeDb, 10);
		expect(result.processed).toBe(0);
		expect(result.remaining).toBe(false);
	});

	it("invalidates edges with null/empty source_entity_id", async () => {
		tmpDir = makeTmp();
		bridgeDb = openBridgeDb(tmpDir);

		// Insert edge with empty source_entity_id
		const raw = bridgeDb.rawSqlite()!;
		const now = Date.now();
		const id = randomUUID();
		raw
			.prepare(
				`INSERT INTO cross_repo_edges
				 (id, source_repo_id, source_entity_id, target_repo_id, target_entity_id, type, t_created)
				 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(id, "repo-a", "", "repo-b", "entity-b", "depends_on", now);

		const result = await bridgeOrphanBatch(bridgeDb, 10);
		expect(result.processed).toBe(1);

		const { rows } = await bridgeDb.execute(
			"SELECT t_valid_until, t_expired FROM cross_repo_edges WHERE id = ?",
			[id],
		);
		expect(rows[0]?.t_valid_until).not.toBeNull();
		expect(rows[0]?.t_expired).not.toBeNull();
	});

	it("marks valid edges as processed without invalidating them", async () => {
		tmpDir = makeTmp();
		bridgeDb = openBridgeDb(tmpDir);

		await insertCrossRepoEdge(bridgeDb, {
			source_repo_id: "repo-a",
			source_entity_id: "entity-a",
			target_repo_id: "repo-b",
			target_entity_id: "entity-b",
			type: "depends_on",
		});

		const result = await bridgeOrphanBatch(bridgeDb, 10);
		expect(result.processed).toBe(1);

		const { rows } = await bridgeDb.execute(
			"SELECT t_valid_until FROM cross_repo_edges WHERE t_valid_until IS NULL",
		);
		// Edge should still be active (not invalidated)
		expect(rows.length).toBe(1);
	});
});

describe("bridgeOrphanBatch — ATTACH-based entity liveness verification", () => {
	let tmpDirs: string[] = [];
	let dbs: SiaDb[] = [];

	afterEach(async () => {
		for (const db of dbs) {
			await db.close();
		}
		dbs = [];
		for (const dir of tmpDirs) {
			rmSync(dir, { recursive: true, force: true });
		}
		tmpDirs = [];
	});

	function mkTmp(): string {
		const dir = makeTmp();
		tmpDirs.push(dir);
		return dir;
	}

	it("invalidates edges pointing to non-existent entities when metaDb provided", async () => {
		// Set up two separate repo directories with graph.db files
		const siaHomeA = mkTmp();
		const siaHomeB = mkTmp();
		const bridgeHome = mkTmp();
		const metaHome = mkTmp();

		// Create graph.db for repo A and repo B with entities
		const repoHashA = "aaaa1111";
		const repoHashB = "bbbb2222";
		const graphDbA = openGraphDb(repoHashA, siaHomeA);
		const graphDbB = openGraphDb(repoHashB, siaHomeB);
		dbs.push(graphDbA, graphDbB);

		const _repoPathA = join(siaHomeA, "repos", repoHashA);
		const _repoPathB = join(siaHomeB, "repos", repoHashB);

		// Insert a live entity in repo A
		const liveEntityId = randomUUID();
		const now = Date.now();
		await graphDbA.execute(
			`INSERT INTO entities
			 (id, type, name, content, summary, importance, base_importance, last_accessed, created_at, t_created, created_by)
			 VALUES (?, 'Concept', 'Live Entity', 'content', 'summary', 0.5, 0.5, ?, ?, ?, 'test')`,
			[liveEntityId, now, now, now],
		);

		// Insert a live entity in repo B (this is the one that will be the "orphan target")
		// — we intentionally do NOT insert an entity for the orphan edge's target

		// Create metaDb and register both repos
		const metaDb = openMetaDb(metaHome);
		dbs.push(metaDb);

		// Register repos with paths pointing to the actual graph.db directories
		const graphDbPathA = join(siaHomeA, "repos", repoHashA, "graph.db");
		const graphDbPathB = join(siaHomeB, "repos", repoHashB, "graph.db");

		// We store the graph.db path directly as repo path so we can look it up
		// Register with specific IDs so we can use them in edges
		const rawMeta = metaDb.rawSqlite()!;
		const repoIdA = randomUUID();
		const repoIdB = randomUUID();
		rawMeta
			.prepare("INSERT INTO repos (id, path, created_at, last_accessed) VALUES (?, ?, ?, ?)")
			.run(repoIdA, graphDbPathA, now, now);
		rawMeta
			.prepare("INSERT INTO repos (id, path, created_at, last_accessed) VALUES (?, ?, ?, ?)")
			.run(repoIdB, graphDbPathB, now, now);

		// Create bridge.db with two edges:
		// 1. Valid edge: source=liveEntityId in repoA -> target entity in repoB (also inserted)
		// 2. Orphan edge: points to a non-existent entity in repoB
		const bridgeDb = openBridgeDb(bridgeHome);
		dbs.push(bridgeDb);

		// Insert a live entity in repo B for the valid edge
		const liveEntityIdB = randomUUID();
		await graphDbB.execute(
			`INSERT INTO entities
			 (id, type, name, content, summary, importance, base_importance, last_accessed, created_at, t_created, created_by)
			 VALUES (?, 'Concept', 'Live Entity B', 'content', 'summary', 0.5, 0.5, ?, ?, ?, 'test')`,
			[liveEntityIdB, now, now, now],
		);

		const validEdgeId = await insertCrossRepoEdge(bridgeDb, {
			source_repo_id: repoIdA,
			source_entity_id: liveEntityId,
			target_repo_id: repoIdB,
			target_entity_id: liveEntityIdB,
			type: "depends_on",
		});

		const orphanEdgeId = await insertCrossRepoEdge(bridgeDb, {
			source_repo_id: repoIdA,
			source_entity_id: liveEntityId,
			target_repo_id: repoIdB,
			target_entity_id: "non-existent-entity-id",
			type: "depends_on",
		});

		// Run with metaDb
		const result = await bridgeOrphanBatch(bridgeDb, 10, metaDb);
		expect(result.processed).toBe(2);

		// Valid edge should still be active
		const { rows: validRows } = await bridgeDb.execute(
			"SELECT t_valid_until FROM cross_repo_edges WHERE id = ?",
			[validEdgeId],
		);
		expect(validRows[0]?.t_valid_until).toBeNull();

		// Orphan edge should be invalidated
		const { rows: orphanRows } = await bridgeDb.execute(
			"SELECT t_valid_until, t_expired FROM cross_repo_edges WHERE id = ?",
			[orphanEdgeId],
		);
		expect(orphanRows[0]?.t_valid_until).not.toBeNull();
		expect(orphanRows[0]?.t_expired).not.toBeNull();
	});

	it("invalidates edges pointing to archived entities", async () => {
		const siaHomeA = mkTmp();
		const bridgeHome = mkTmp();
		const metaHome = mkTmp();

		const repoHashA = "cccc3333";
		const graphDbA = openGraphDb(repoHashA, siaHomeA);
		dbs.push(graphDbA);

		const graphDbPathA = join(siaHomeA, "repos", repoHashA, "graph.db");

		const metaDb = openMetaDb(metaHome);
		dbs.push(metaDb);

		const now = Date.now();
		const rawMeta = metaDb.rawSqlite()!;
		const repoIdA = randomUUID();
		rawMeta
			.prepare("INSERT INTO repos (id, path, created_at, last_accessed) VALUES (?, ?, ?, ?)")
			.run(repoIdA, graphDbPathA, now, now);

		// Insert an archived entity
		const archivedEntityId = randomUUID();
		await graphDbA.execute(
			`INSERT INTO entities
			 (id, type, name, content, summary, importance, base_importance, last_accessed, created_at, t_created, created_by, archived_at)
			 VALUES (?, 'Concept', 'Archived Entity', 'content', 'summary', 0.5, 0.5, ?, ?, ?, 'test', ?)`,
			[archivedEntityId, now, now, now, now],
		);

		const bridgeDb = openBridgeDb(bridgeHome);
		dbs.push(bridgeDb);

		const orphanEdgeId = await insertCrossRepoEdge(bridgeDb, {
			source_repo_id: repoIdA,
			source_entity_id: archivedEntityId,
			target_repo_id: repoIdA,
			target_entity_id: archivedEntityId,
			type: "depends_on",
		});

		const result = await bridgeOrphanBatch(bridgeDb, 10, metaDb);
		expect(result.processed).toBe(1);

		const { rows } = await bridgeDb.execute(
			"SELECT t_valid_until FROM cross_repo_edges WHERE id = ?",
			[orphanEdgeId],
		);
		expect(rows[0]?.t_valid_until).not.toBeNull();
	});

	it("falls back to null-check when rawSqlite returns null", async () => {
		const bridgeHome = mkTmp();
		const bridgeDb = openBridgeDb(bridgeHome);
		dbs.push(bridgeDb);

		await insertCrossRepoEdge(bridgeDb, {
			source_repo_id: "repo-a",
			source_entity_id: "entity-a",
			target_repo_id: "repo-b",
			target_entity_id: "entity-b",
			type: "depends_on",
		});

		// Create a fake metaDb that returns null from rawSqlite()
		const fakeMetaDb: SiaDb = {
			execute: async () => ({ rows: [] }),
			executeMany: async () => {},
			transaction: async () => {},
			close: async () => {},
			rawSqlite: () => null,
		};

		// Should not throw, just fall back gracefully
		const result = await bridgeOrphanBatch(bridgeDb, 10, fakeMetaDb);
		expect(result.processed).toBe(1);

		// Edge should NOT be invalidated (fallback just marks as processed)
		const { rows } = await bridgeDb.execute(
			"SELECT t_valid_until FROM cross_repo_edges WHERE t_valid_until IS NULL",
		);
		expect(rows.length).toBe(1);
	});
});

describe("cleanupBridgeOrphans", () => {
	let tmpDir: string;
	let bridgeDb: SiaDb | undefined;

	afterEach(async () => {
		if (bridgeDb) {
			await bridgeDb.close();
			bridgeDb = undefined;
		}
		if (tmpDir) {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("processes all edges and returns total count", async () => {
		tmpDir = makeTmp();
		bridgeDb = openBridgeDb(tmpDir);

		// Insert 3 edges with null source entities (all should be invalidated)
		const raw = bridgeDb.rawSqlite()!;
		const now = Date.now();
		for (let i = 0; i < 3; i++) {
			raw
				.prepare(
					`INSERT INTO cross_repo_edges
					 (id, source_repo_id, source_entity_id, target_repo_id, target_entity_id, type, t_created)
					 VALUES (?, ?, ?, ?, ?, ?, ?)`,
				)
				.run(randomUUID(), "repo-a", "", "repo-b", `entity-${i}`, "depends_on", now);
		}

		const total = await cleanupBridgeOrphans(bridgeDb);
		expect(total).toBe(3);
	});
});
