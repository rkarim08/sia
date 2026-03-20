import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SiaDb } from "@/graph/db-interface";
import { openGraphDb } from "@/graph/semantic-db";

describe("graph.db schema (001_initial)", () => {
	let tmpDir: string;
	let db: SiaDb | undefined;

	function makeTmp(): string {
		const dir = join(tmpdir(), `sia-test-${randomUUID()}`);
		mkdirSync(dir, { recursive: true });
		return dir;
	}

	/** Helper: insert a minimal entity and return its TEXT id. */
	async function insertEntity(siaDb: SiaDb, id: string, name: string): Promise<void> {
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
				0.5, 0.5, 0, 0,
				?, ?,
				?, NULL, NULL, NULL,
				'private', 'dev-1'
			)`,
			[id, name, now, now, now],
		);
	}

	/** Helper: insert an active edge between two entities. */
	async function insertEdge(
		siaDb: SiaDb,
		edgeId: string,
		fromId: string,
		toId: string,
		tValidUntil: number | null = null,
	): Promise<void> {
		const now = Date.now();
		await siaDb.execute(
			`INSERT INTO graph_edges (
				id, from_id, to_id, type, weight, confidence, trust_tier,
				t_created, t_expired, t_valid_from, t_valid_until
			) VALUES (?, ?, ?, 'relates_to', 1.0, 0.7, 3, ?, NULL, NULL, ?)`,
			[edgeId, fromId, toId, now, tValidUntil],
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
	// Basic schema application
	// ---------------------------------------------------------------

	it("schema applies without error", () => {
		tmpDir = makeTmp();
		db = openGraphDb("schema-test", tmpDir);
		// If we reach here, the migration ran without throwing.
		expect(db).toBeDefined();
	});

	// ---------------------------------------------------------------
	// Bi-temporal columns on entities
	// ---------------------------------------------------------------

	it("entities table has all 4 bi-temporal columns", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("bitemporal-test", tmpDir);

		const result = await db.execute("PRAGMA table_info(graph_nodes)");
		const columns = result.rows.map((r) => r.name as string);

		expect(columns).toContain("t_created");
		expect(columns).toContain("t_expired");
		expect(columns).toContain("t_valid_from");
		expect(columns).toContain("t_valid_until");
	});

	// ---------------------------------------------------------------
	// FTS5 triggers keep graph_nodes_fts in sync
	// ---------------------------------------------------------------

	it("FTS5 triggers keep graph_nodes_fts in sync on insert", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("fts-test", tmpDir);

		await insertEntity(db, "e-fts-1", "Singleton Pattern");

		// Query the FTS5 index — the trigger should have populated it.
		const ftsResult = await db.execute(
			"SELECT name FROM graph_nodes_fts WHERE graph_nodes_fts MATCH 'Singleton'",
		);
		expect(ftsResult.rows).toHaveLength(1);
		expect(ftsResult.rows[0]?.name).toBe("Singleton Pattern");
	});

	// ---------------------------------------------------------------
	// edge_count insert trigger
	// ---------------------------------------------------------------

	it("edge_count insert trigger increments on active edge", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("edge-count-insert", tmpDir);

		const eA = "ent-a";
		const eB = "ent-b";
		await insertEntity(db, eA, "Entity A");
		await insertEntity(db, eB, "Entity B");

		// Insert an active edge (t_valid_until = NULL).
		await insertEdge(db, "edge-1", eA, eB);

		// Both endpoints should have edge_count = 1.
		const resA = await db.execute("SELECT edge_count FROM graph_nodes WHERE id = ?", [eA]);
		const resB = await db.execute("SELECT edge_count FROM graph_nodes WHERE id = ?", [eB]);
		expect(resA.rows[0]?.edge_count).toBe(1);
		expect(resB.rows[0]?.edge_count).toBe(1);
	});

	// ---------------------------------------------------------------
	// edge_count invalidation trigger
	// ---------------------------------------------------------------

	it("edge_count invalidate trigger decrements when edge invalidated", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("edge-count-invalidate", tmpDir);

		const eA = "ent-c";
		const eB = "ent-d";
		await insertEntity(db, eA, "Entity C");
		await insertEntity(db, eB, "Entity D");

		// Insert active edge.
		await insertEdge(db, "edge-2", eA, eB);

		// Verify both are at 1.
		let resA = await db.execute("SELECT edge_count FROM graph_nodes WHERE id = ?", [eA]);
		expect(resA.rows[0]?.edge_count).toBe(1);

		// Invalidate the edge (set t_valid_until).
		await db.execute("UPDATE graph_edges SET t_valid_until = ? WHERE id = ?", [
			Date.now(),
			"edge-2",
		]);

		// Both endpoints should now have edge_count = 0.
		resA = await db.execute("SELECT edge_count FROM graph_nodes WHERE id = ?", [eA]);
		const resB = await db.execute("SELECT edge_count FROM graph_nodes WHERE id = ?", [eB]);
		expect(resA.rows[0]?.edge_count).toBe(0);
		expect(resB.rows[0]?.edge_count).toBe(0);
	});

	// ---------------------------------------------------------------
	// edge_count reactivation trigger
	// ---------------------------------------------------------------

	it("edge_count reactivate trigger increments when edge reactivated", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("edge-count-reactivate", tmpDir);

		const eA = "ent-e";
		const eB = "ent-f";
		await insertEntity(db, eA, "Entity E");
		await insertEntity(db, eB, "Entity F");

		// Insert active edge.
		await insertEdge(db, "edge-3", eA, eB);

		// Invalidate.
		await db.execute("UPDATE graph_edges SET t_valid_until = ? WHERE id = ?", [
			Date.now(),
			"edge-3",
		]);

		// Verify both are at 0 after invalidation.
		let resA = await db.execute("SELECT edge_count FROM graph_nodes WHERE id = ?", [eA]);
		expect(resA.rows[0]?.edge_count).toBe(0);

		// Reactivate (set t_valid_until back to NULL).
		await db.execute("UPDATE graph_edges SET t_valid_until = NULL WHERE id = ?", ["edge-3"]);

		// Both endpoints should be back to 1.
		resA = await db.execute("SELECT edge_count FROM graph_nodes WHERE id = ?", [eA]);
		const resB = await db.execute("SELECT edge_count FROM graph_nodes WHERE id = ?", [eB]);
		expect(resA.rows[0]?.edge_count).toBe(1);
		expect(resB.rows[0]?.edge_count).toBe(1);
	});

	// ---------------------------------------------------------------
	// local_dedup_log: exists, does NOT have peer_id
	// ---------------------------------------------------------------

	it("local_dedup_log exists and does NOT have peer_id column", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("dedup-local", tmpDir);

		const tableCheck = await db.execute(
			"SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'local_dedup_log'",
		);
		expect(tableCheck.rows).toHaveLength(1);

		const cols = await db.execute("PRAGMA table_info(local_dedup_log)");
		const colNames = cols.rows.map((r) => r.name as string);
		expect(colNames).toContain("entity_a_id");
		expect(colNames).toContain("entity_b_id");
		expect(colNames).toContain("decision");
		expect(colNames).toContain("checked_at");
		expect(colNames).not.toContain("peer_id");
	});

	// ---------------------------------------------------------------
	// sync_dedup_log: exists and HAS peer_id
	// ---------------------------------------------------------------

	it("sync_dedup_log exists and HAS peer_id column", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("dedup-sync", tmpDir);

		const tableCheck = await db.execute(
			"SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sync_dedup_log'",
		);
		expect(tableCheck.rows).toHaveLength(1);

		const cols = await db.execute("PRAGMA table_info(sync_dedup_log)");
		const colNames = cols.rows.map((r) => r.name as string);
		expect(colNames).toContain("entity_a_id");
		expect(colNames).toContain("entity_b_id");
		expect(colNames).toContain("peer_id");
		expect(colNames).toContain("decision");
		expect(colNames).toContain("checked_at");
	});

	// ---------------------------------------------------------------
	// sharing_rules is ABSENT (regression check — belongs in meta.db)
	// ---------------------------------------------------------------

	it("sharing_rules table is absent from graph.db", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("no-sharing-rules", tmpDir);

		const result = await db.execute(
			"SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sharing_rules'",
		);
		expect(result.rows).toHaveLength(0);
	});

	// ---------------------------------------------------------------
	// memory_staging has NO FK constraints to entities
	// ---------------------------------------------------------------

	it("memory_staging has no FK constraints to entities", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("staging-no-fk", tmpDir);

		// Insert into memory_staging with a fake entity_id that does not exist
		// in entities. If there were an FK, this would throw.
		const now = Date.now();
		await db.execute(
			`INSERT INTO memory_staging (
				id, source_episode, proposed_type, proposed_name, proposed_content,
				proposed_tags, proposed_file_paths, trust_tier, raw_confidence,
				validation_status, created_at, expires_at
			) VALUES (
				'ms-1', 'nonexistent-episode', 'Concept', 'Test Name', 'Test Content',
				'[]', '[]', 4, 0.5,
				'pending', ?, ?
			)`,
			[now, now + 7 * 86400000],
		);

		// Verify it was inserted.
		const result = await db.execute("SELECT id FROM memory_staging WHERE id = 'ms-1'");
		expect(result.rows).toHaveLength(1);
		expect(result.rows[0]?.id).toBe("ms-1");
	});
});
