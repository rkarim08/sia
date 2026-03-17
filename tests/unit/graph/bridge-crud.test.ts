import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	getActiveCrossRepoEdgesFor,
	insertCrossRepoEdge,
	invalidateCrossRepoEdge,
	openBridgeDb,
} from "@/graph/bridge-db";
import type { SiaDb } from "@/graph/db-interface";
import { attachPeerRepo, detachPeerRepo } from "@/workspace/cross-repo";

describe("cross-repo edge CRUD (bridge-db)", () => {
	let tmpDir: string;
	let db: SiaDb | undefined;

	function makeTmp(): string {
		const dir = join(tmpdir(), `sia-test-${randomUUID()}`);
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

	// ---------------------------------------------------------------
	// Insert cross-repo edge and retrieve it
	// ---------------------------------------------------------------

	it("insertCrossRepoEdge creates an edge and it is retrievable", async () => {
		tmpDir = makeTmp();
		db = openBridgeDb(tmpDir);

		const id = await insertCrossRepoEdge(db, {
			source_repo_id: "repo-a",
			source_entity_id: "ent-1",
			target_repo_id: "repo-b",
			target_entity_id: "ent-2",
			type: "calls_api",
			weight: 0.8,
			confidence: 0.95,
			trust_tier: 1,
			properties: '{"method":"POST"}',
			created_by: "dev-42",
		});

		expect(id).toBeDefined();
		expect(typeof id).toBe("string");

		// Verify in DB
		const result = await db.execute("SELECT * FROM cross_repo_edges WHERE id = ?", [id]);
		expect(result.rows).toHaveLength(1);

		const row = result.rows[0]!;
		expect(row.source_repo_id).toBe("repo-a");
		expect(row.source_entity_id).toBe("ent-1");
		expect(row.target_repo_id).toBe("repo-b");
		expect(row.target_entity_id).toBe("ent-2");
		expect(row.type).toBe("calls_api");
		expect(row.weight).toBe(0.8);
		expect(row.confidence).toBe(0.95);
		expect(row.trust_tier).toBe(1);
		expect(row.properties).toBe('{"method":"POST"}');
		expect(row.t_created).toBeTypeOf("number");
		expect(row.t_valid_until).toBeNull();
		expect(row.t_expired).toBeNull();
		expect(row.created_by).toBe("dev-42");
	});

	// ---------------------------------------------------------------
	// invalidateCrossRepoEdge sets both t_valid_until and t_expired
	// ---------------------------------------------------------------

	it("invalidateCrossRepoEdge sets both t_valid_until and t_expired", async () => {
		tmpDir = makeTmp();
		db = openBridgeDb(tmpDir);

		const id = await insertCrossRepoEdge(db, {
			source_repo_id: "repo-a",
			source_entity_id: "ent-1",
			target_repo_id: "repo-b",
			target_entity_id: "ent-2",
			type: "depends_on",
		});

		const invalidationTs = Date.now() + 1000;
		await invalidateCrossRepoEdge(db, id, invalidationTs);

		const result = await db.execute("SELECT * FROM cross_repo_edges WHERE id = ?", [id]);
		expect(result.rows).toHaveLength(1);

		const row = result.rows[0]!;
		expect(row.t_valid_until).toBe(invalidationTs);
		expect(row.t_expired).toBe(invalidationTs);
	});

	// ---------------------------------------------------------------
	// After invalidation, getActiveCrossRepoEdgesFor excludes it
	// ---------------------------------------------------------------

	it("getActiveCrossRepoEdgesFor excludes invalidated edges", async () => {
		tmpDir = makeTmp();
		db = openBridgeDb(tmpDir);

		const id = await insertCrossRepoEdge(db, {
			source_repo_id: "repo-a",
			source_entity_id: "ent-1",
			target_repo_id: "repo-b",
			target_entity_id: "ent-2",
			type: "shares_type",
		});

		// Before invalidation: should find the edge via source
		const activeBefore = await getActiveCrossRepoEdgesFor(db, "repo-a", "ent-1");
		expect(activeBefore).toHaveLength(1);
		expect(activeBefore[0]?.id).toBe(id);

		// Also findable via target
		const activeBeforeTarget = await getActiveCrossRepoEdgesFor(db, "repo-b", "ent-2");
		expect(activeBeforeTarget).toHaveLength(1);
		expect(activeBeforeTarget[0]?.id).toBe(id);

		// Invalidate
		await invalidateCrossRepoEdge(db, id);

		// After invalidation: should be empty for both endpoints
		const afterSource = await getActiveCrossRepoEdgesFor(db, "repo-a", "ent-1");
		expect(afterSource).toHaveLength(0);

		const afterTarget = await getActiveCrossRepoEdgesFor(db, "repo-b", "ent-2");
		expect(afterTarget).toHaveLength(0);
	});

	// ---------------------------------------------------------------
	// getActiveCrossRepoEdgesFor returns only active edges
	// ---------------------------------------------------------------

	it("getActiveCrossRepoEdgesFor returns only active edges when mix of active/invalidated", async () => {
		tmpDir = makeTmp();
		db = openBridgeDb(tmpDir);

		const id1 = await insertCrossRepoEdge(db, {
			source_repo_id: "repo-a",
			source_entity_id: "ent-1",
			target_repo_id: "repo-b",
			target_entity_id: "ent-2",
			type: "calls_api",
		});

		const id2 = await insertCrossRepoEdge(db, {
			source_repo_id: "repo-a",
			source_entity_id: "ent-1",
			target_repo_id: "repo-c",
			target_entity_id: "ent-3",
			type: "references",
		});

		// Invalidate only the first edge
		await invalidateCrossRepoEdge(db, id1);

		const active = await getActiveCrossRepoEdgesFor(db, "repo-a", "ent-1");
		expect(active).toHaveLength(1);
		expect(active[0]?.id).toBe(id2);
	});
});

describe("cross-repo ATTACH/DETACH helpers", () => {
	let tmpDir: string;
	let mainDb: SiaDb | undefined;

	function makeTmp(): string {
		const dir = join(tmpdir(), `sia-test-${randomUUID()}`);
		mkdirSync(dir, { recursive: true });
		return dir;
	}

	afterEach(async () => {
		if (mainDb) {
			await mainDb.close();
			mainDb = undefined;
		}
		if (tmpDir) {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	// ---------------------------------------------------------------
	// attachPeerRepo works (create a second db, attach it)
	// ---------------------------------------------------------------

	it("attachPeerRepo attaches a peer database that can be queried", async () => {
		tmpDir = makeTmp();

		// Create the main bridge db
		mainDb = openBridgeDb(tmpDir);

		// Create a second bridge db in a subdirectory to act as a peer
		const peerDir = join(tmpDir, "peer");
		mkdirSync(peerDir, { recursive: true });
		const peerDb = openBridgeDb(peerDir);

		// Insert an edge into the peer db
		await insertCrossRepoEdge(peerDb, {
			source_repo_id: "peer-repo",
			source_entity_id: "peer-ent-1",
			target_repo_id: "peer-repo-2",
			target_entity_id: "peer-ent-2",
			type: "depends_on",
		});
		await peerDb.close();

		// Attach peer db to main db
		const peerDbPath = join(peerDir, "bridge.db");
		await attachPeerRepo(mainDb, peerDbPath, "peer1");

		// Query the attached peer database
		const result = await mainDb.execute(
			"SELECT * FROM peer1.cross_repo_edges WHERE source_repo_id = ?",
			["peer-repo"],
		);
		expect(result.rows).toHaveLength(1);
		expect(result.rows[0]?.source_repo_id).toBe("peer-repo");
	});

	// ---------------------------------------------------------------
	// detachPeerRepo cleans up (after detach, querying alias fails)
	// ---------------------------------------------------------------

	it("detachPeerRepo cleans up and querying alias fails after detach", async () => {
		tmpDir = makeTmp();

		// Create the main bridge db
		mainDb = openBridgeDb(tmpDir);

		// Create a peer db
		const peerDir = join(tmpDir, "peer");
		mkdirSync(peerDir, { recursive: true });
		const peerDb = openBridgeDb(peerDir);
		await peerDb.close();

		// Attach then detach
		const peerDbPath = join(peerDir, "bridge.db");
		await attachPeerRepo(mainDb, peerDbPath, "peer1");
		await detachPeerRepo(mainDb, "peer1");

		// Querying the detached alias should fail
		await expect(mainDb.execute("SELECT * FROM peer1.cross_repo_edges", [])).rejects.toThrow();
	});
});
