import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SiaDb } from "@/graph/db-interface";
import {
	archiveEntity,
	getActiveEntities,
	getEntitiesByPackage,
	getEntity,
	getNodesByKind,
	getNodesBySession,
	insertEntity,
	invalidateEntity,
	touchEntity,
	updateEntity,
} from "@/graph/entities";
import { openGraphDb } from "@/graph/semantic-db";

describe("entity CRUD layer", () => {
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
	// Insert and retrieve entity round-trip
	// ---------------------------------------------------------------

	it("insert and retrieve entity round-trip", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("ent-roundtrip", tmpDir);

		const entity = await insertEntity(db, {
			type: "Concept",
			name: "Test Entity",
			content: "This is a test entity for round-trip verification.",
			summary: "A test entity",
			created_by: "dev-1",
		});

		expect(entity.id).toBeDefined();
		expect(entity.type).toBe("Concept");
		expect(entity.name).toBe("Test Entity");
		expect(entity.t_created).toBeGreaterThan(0);
		expect(entity.t_valid_from).toBeNull();
		expect(entity.t_valid_until).toBeNull();
		expect(entity.archived_at).toBeNull();

		const retrieved = await getEntity(db, entity.id);
		expect(retrieved).toBeDefined();
		expect(retrieved?.id).toBe(entity.id);
		expect(retrieved?.name).toBe("Test Entity");
		expect(retrieved?.content).toBe("This is a test entity for round-trip verification.");
		expect(retrieved?.summary).toBe("A test entity");
		expect(retrieved?.type).toBe("Concept");
		expect(retrieved?.trust_tier).toBe(3);
		expect(retrieved?.confidence).toBe(0.7);
		expect(retrieved?.visibility).toBe("private");
		expect(retrieved?.created_by).toBe("dev-1");
	});

	// ---------------------------------------------------------------
	// updateEntity changes fields
	// ---------------------------------------------------------------

	it("updateEntity changes fields", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("ent-update", tmpDir);

		const entity = await insertEntity(db, {
			type: "Decision",
			name: "Original Name",
			content: "Original content",
			summary: "Original summary",
			created_by: "dev-1",
		});

		await updateEntity(db, entity.id, {
			name: "Updated Name",
			content: "Updated content",
			importance: 0.9,
		});

		const updated = await getEntity(db, entity.id);
		expect(updated).toBeDefined();
		expect(updated?.name).toBe("Updated Name");
		expect(updated?.content).toBe("Updated content");
		expect(updated?.importance).toBe(0.9);
		// Unchanged fields remain the same
		expect(updated?.summary).toBe("Original summary");
		expect(updated?.type).toBe("Decision");
	});

	// ---------------------------------------------------------------
	// touchEntity increments access_count
	// ---------------------------------------------------------------

	it("touchEntity increments access_count", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("ent-touch", tmpDir);

		const entity = await insertEntity(db, {
			type: "Concept",
			name: "Touchable Entity",
			content: "Test touch",
			summary: "Touch test",
			created_by: "dev-1",
		});

		const before = await getEntity(db, entity.id);
		expect(before?.access_count).toBe(0);

		await touchEntity(db, entity.id);
		const after1 = await getEntity(db, entity.id);
		expect(after1?.access_count).toBe(1);
		expect(after1?.last_accessed).toBeGreaterThanOrEqual(before?.last_accessed ?? 0);

		await touchEntity(db, entity.id);
		const after2 = await getEntity(db, entity.id);
		expect(after2?.access_count).toBe(2);
	});

	// ---------------------------------------------------------------
	// invalidateEntity sets both t_valid_until AND t_expired, writes audit log
	// ---------------------------------------------------------------

	it("invalidateEntity sets both t_valid_until AND t_expired, writes audit log", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("ent-invalidate", tmpDir);

		const entity = await insertEntity(db, {
			type: "Decision",
			name: "Old Decision",
			content: "This decision is being superseded",
			summary: "Superseded decision",
			created_by: "dev-1",
		});

		const invalidateTime = Date.now();
		await invalidateEntity(db, entity.id, invalidateTime);

		const invalidated = await getEntity(db, entity.id);
		expect(invalidated).toBeDefined();
		expect(invalidated?.t_valid_until).toBe(invalidateTime);
		expect(invalidated?.t_expired).toBe(invalidateTime);

		// Check audit log has an INVALIDATE entry
		const auditResult = await db.execute(
			"SELECT operation, entity_id FROM audit_log WHERE entity_id = ? AND operation = 'INVALIDATE'",
			[entity.id],
		);
		expect(auditResult.rows).toHaveLength(1);
		expect(auditResult.rows[0]?.entity_id).toBe(entity.id);
	});

	// ---------------------------------------------------------------
	// invalidateEntity does NOT set archived_at
	// ---------------------------------------------------------------

	it("invalidateEntity does NOT set archived_at", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("ent-invalidate-no-archive", tmpDir);

		const entity = await insertEntity(db, {
			type: "Convention",
			name: "Old Convention",
			content: "This convention is superseded",
			summary: "Superseded convention",
			created_by: "dev-1",
		});

		await invalidateEntity(db, entity.id);

		const invalidated = await getEntity(db, entity.id);
		expect(invalidated).toBeDefined();
		expect(invalidated?.t_valid_until).not.toBeNull();
		expect(invalidated?.t_expired).not.toBeNull();
		expect(invalidated?.archived_at).toBeNull();
	});

	// ---------------------------------------------------------------
	// archiveEntity sets archived_at without touching bi-temporal columns
	// ---------------------------------------------------------------

	it("archiveEntity sets archived_at without touching bi-temporal columns", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("ent-archive", tmpDir);

		const entity = await insertEntity(db, {
			type: "Concept",
			name: "Decayed Entity",
			content: "This entity has decayed to irrelevance",
			summary: "Decayed entity",
			created_by: "dev-1",
		});

		// Confirm bi-temporal columns are null before archive
		const before = await getEntity(db, entity.id);
		expect(before?.t_valid_until).toBeNull();
		expect(before?.t_expired).toBeNull();

		await archiveEntity(db, entity.id);

		const archived = await getEntity(db, entity.id);
		expect(archived).toBeDefined();
		expect(archived?.archived_at).not.toBeNull();
		expect(archived?.archived_at).toBeGreaterThan(0);
		// Bi-temporal columns remain untouched
		expect(archived?.t_valid_until).toBeNull();
		expect(archived?.t_expired).toBeNull();

		// Check audit log has an ARCHIVE entry
		const auditResult = await db.execute(
			"SELECT operation, entity_id FROM audit_log WHERE entity_id = ? AND operation = 'ARCHIVE'",
			[entity.id],
		);
		expect(auditResult.rows).toHaveLength(1);
		expect(auditResult.rows[0]?.entity_id).toBe(entity.id);
	});

	// ---------------------------------------------------------------
	// getActiveEntities excludes both archived and invalidated entities
	// ---------------------------------------------------------------

	it("getActiveEntities excludes both archived and invalidated entities", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("ent-active", tmpDir);

		const active = await insertEntity(db, {
			type: "Concept",
			name: "Active Entity",
			content: "This entity is active",
			summary: "Active",
			created_by: "dev-1",
		});

		const toInvalidate = await insertEntity(db, {
			type: "Decision",
			name: "Invalidated Entity",
			content: "This will be invalidated",
			summary: "Invalidated",
			created_by: "dev-1",
		});

		const toArchive = await insertEntity(db, {
			type: "Bug",
			name: "Archived Entity",
			content: "This will be archived",
			summary: "Archived",
			created_by: "dev-1",
		});

		await invalidateEntity(db, toInvalidate.id);
		await archiveEntity(db, toArchive.id);

		const activeEntities = await getActiveEntities(db);
		expect(activeEntities).toHaveLength(1);
		expect(activeEntities[0]?.id).toBe(active.id);
		expect(activeEntities[0]?.name).toBe("Active Entity");
	});

	// ---------------------------------------------------------------
	// getActiveEntities respects limit
	// ---------------------------------------------------------------

	it("getActiveEntities respects limit", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("ent-active-limit", tmpDir);

		for (let i = 0; i < 5; i++) {
			await insertEntity(db, {
				type: "Concept",
				name: `Entity ${i}`,
				content: `Content ${i}`,
				summary: `Summary ${i}`,
				created_by: "dev-1",
			});
		}

		const limited = await getActiveEntities(db, { limit: 3 });
		expect(limited).toHaveLength(3);

		const all = await getActiveEntities(db);
		expect(all).toHaveLength(5);
	});

	// ---------------------------------------------------------------
	// getEntitiesByPackage filters by package_path
	// ---------------------------------------------------------------

	// ---------------------------------------------------------------
	// insertEntity with kind uses explicit kind, defaults to type
	// ---------------------------------------------------------------

	it("insertEntity with explicit kind stores that kind, without kind defaults to type", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("ent-kind-default", tmpDir);

		// Without kind: kind should default to type
		const e1 = await insertEntity(db, {
			type: "Concept",
			name: "Entity Without Kind",
			content: "test",
			summary: "test",
		});
		const row1 = await db.execute("SELECT kind FROM graph_nodes WHERE id = ?", [e1.id]);
		expect(row1.rows[0]?.kind).toBe("Concept");

		// With explicit kind: should use the supplied kind
		const e2 = await insertEntity(db, {
			type: "CodeEntity",
			name: "Entity With Kind",
			content: "test",
			summary: "test",
			kind: "EditEvent",
		});
		const row2 = await db.execute("SELECT kind FROM graph_nodes WHERE id = ?", [e2.id]);
		expect(row2.rows[0]?.kind).toBe("EditEvent");
	});

	// ---------------------------------------------------------------
	// getNodesBySession returns only nodes with matching session_id
	// ---------------------------------------------------------------

	it("getNodesBySession returns nodes matching session_id, excludes archived/invalidated", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("ent-by-session", tmpDir);

		const e1 = await insertEntity(db, {
			type: "Concept",
			name: "Session A Node 1",
			content: "test",
			summary: "test",
			session_id: "sess-a",
		});
		const e2 = await insertEntity(db, {
			type: "Concept",
			name: "Session A Node 2",
			content: "test",
			summary: "test",
			session_id: "sess-a",
		});
		await insertEntity(db, {
			type: "Concept",
			name: "Session B Node",
			content: "test",
			summary: "test",
			session_id: "sess-b",
		});
		// Archived node in sess-a — should be excluded
		const archived = await insertEntity(db, {
			type: "Concept",
			name: "Archived Session A Node",
			content: "test",
			summary: "test",
			session_id: "sess-a",
		});
		await db.execute("UPDATE graph_nodes SET archived_at = ? WHERE id = ?", [
			Date.now(),
			archived.id,
		]);

		const results = await getNodesBySession(db, "sess-a");
		expect(results).toHaveLength(2);
		const ids = results.map((r) => r.id);
		expect(ids).toContain(e1.id);
		expect(ids).toContain(e2.id);
		expect(ids).not.toContain(archived.id);
	});

	// ---------------------------------------------------------------
	// getNodesByKind returns only nodes with matching kind
	// ---------------------------------------------------------------

	it("getNodesByKind returns nodes matching kind, excludes archived/invalidated", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("ent-by-kind", tmpDir);

		const e1 = await insertEntity(db, {
			type: "CodeEntity",
			name: "Edit Event 1",
			content: "test",
			summary: "test",
			kind: "EditEvent",
		});
		const e2 = await insertEntity(db, {
			type: "CodeEntity",
			name: "Edit Event 2",
			content: "test",
			summary: "test",
			kind: "EditEvent",
		});
		await insertEntity(db, {
			type: "CodeEntity",
			name: "Bash Event",
			content: "test",
			summary: "test",
			kind: "ExecutionEvent",
		});
		// Invalidated EditEvent — should be excluded
		const invalidated = await insertEntity(db, {
			type: "CodeEntity",
			name: "Old Edit Event",
			content: "test",
			summary: "test",
			kind: "EditEvent",
		});
		await db.execute("UPDATE graph_nodes SET t_valid_until = ? WHERE id = ?", [
			Date.now(),
			invalidated.id,
		]);

		const results = await getNodesByKind(db, "EditEvent");
		expect(results).toHaveLength(2);
		const ids = results.map((r) => r.id);
		expect(ids).toContain(e1.id);
		expect(ids).toContain(e2.id);
		expect(ids).not.toContain(invalidated.id);
	});

	it("getEntitiesByPackage filters by package_path", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("ent-by-package", tmpDir);

		await insertEntity(db, {
			type: "Concept",
			name: "Frontend Entity",
			content: "Frontend content",
			summary: "Frontend",
			package_path: "packages/frontend",
			created_by: "dev-1",
		});

		await insertEntity(db, {
			type: "Concept",
			name: "Backend Entity",
			content: "Backend content",
			summary: "Backend",
			package_path: "packages/backend",
			created_by: "dev-1",
		});

		await insertEntity(db, {
			type: "Concept",
			name: "Root Entity",
			content: "Root content",
			summary: "Root",
			created_by: "dev-1",
		});

		// Also add an invalidated entity in the same package to verify it's excluded
		const invalidated = await insertEntity(db, {
			type: "Decision",
			name: "Old Frontend Decision",
			content: "Superseded",
			summary: "Old",
			package_path: "packages/frontend",
			created_by: "dev-1",
		});
		await invalidateEntity(db, invalidated.id);

		const frontend = await getEntitiesByPackage(db, "packages/frontend");
		expect(frontend).toHaveLength(1);
		expect(frontend[0]?.name).toBe("Frontend Entity");

		const backend = await getEntitiesByPackage(db, "packages/backend");
		expect(backend).toHaveLength(1);
		expect(backend[0]?.name).toBe("Backend Entity");
	});
});
