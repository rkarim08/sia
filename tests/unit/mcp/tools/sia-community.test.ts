import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SiaDb } from "@/graph/db-interface";
import { openGraphDb } from "@/graph/semantic-db";
import { handleSiaCommunity } from "@/mcp/tools/sia-community";

describe("handleSiaCommunity", () => {
	let tmpDir: string;
	let db: SiaDb | undefined;

	function makeTmp(): string {
		const dir = join(tmpdir(), `sia-test-${randomUUID()}`);
		mkdirSync(dir, { recursive: true });
		return dir;
	}

	/** Insert a community row directly. */
	async function insertCommunity(
		database: SiaDb,
		opts: {
			id?: string;
			level: number;
			summary?: string | null;
			member_count?: number;
			parent_id?: string | null;
			package_path?: string | null;
		},
	): Promise<string> {
		const id = opts.id ?? randomUUID();
		const now = Date.now();
		await database.execute(
			`INSERT INTO communities (id, level, parent_id, summary, member_count, package_path, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				id,
				opts.level,
				opts.parent_id ?? null,
				opts.summary ?? null,
				opts.member_count ?? 0,
				opts.package_path ?? null,
				now,
				now,
			],
		);
		return id;
	}

	/** Insert a community_members row directly. */
	async function insertCommunityMember(
		database: SiaDb,
		communityId: string,
		entityId: string,
		level: number,
	): Promise<void> {
		await database.execute(
			"INSERT INTO community_members (community_id, entity_id, level) VALUES (?, ?, ?)",
			[communityId, entityId, level],
		);
	}

	/** Insert a minimal entity row (needed for FK constraints). */
	async function insertEntity(database: SiaDb, id?: string): Promise<string> {
		const eid = id ?? randomUUID();
		const now = Date.now();
		await database.execute(
			`INSERT INTO graph_nodes (id, type, name, content, summary, tags, file_paths,
				trust_tier, confidence, base_confidence, importance, base_importance,
				access_count, edge_count, last_accessed, created_at,
				t_created, visibility, created_by)
			 VALUES (?, 'Concept', 'e', 'c', 's', '[]', '[]',
				3, 0.7, 0.7, 0.5, 0.5,
				0, 0, ?, ?,
				?, 'private', 'dev-1')`,
			[eid, now, now, now],
		);
		return eid;
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
	// Empty graph — no communities
	// ---------------------------------------------------------------

	it("returns empty array when no communities exist and entities >= 100", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("comm-empty", tmpDir);

		// Insert 100 entities so global_unavailable is NOT set
		for (let i = 0; i < 100; i++) {
			await insertEntity(db);
		}

		const result = await handleSiaCommunity(db, {});
		expect(result.communities).toEqual([]);
		expect(result.global_unavailable).toBeUndefined();
	});

	// ---------------------------------------------------------------
	// global_unavailable when entity count < 100
	// ---------------------------------------------------------------

	it("returns global_unavailable when entity count < 100 and no communities", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("comm-unavail", tmpDir);

		// Insert a handful of entities (fewer than 100)
		for (let i = 0; i < 5; i++) {
			await insertEntity(db);
		}

		const result = await handleSiaCommunity(db, {});
		expect(result.communities).toEqual([]);
		expect(result.global_unavailable).toBe(true);
	});

	// ---------------------------------------------------------------
	// entity_id lookup returns the correct community
	// ---------------------------------------------------------------

	it("entity_id lookup returns the correct community", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("comm-entity", tmpDir);

		const entityId = await insertEntity(db);
		const communityId = await insertCommunity(db, {
			level: 0,
			summary: "Auth module community",
			member_count: 5,
		});
		// Also create a second community the entity is NOT in
		await insertCommunity(db, {
			level: 1,
			summary: "Unrelated community",
			member_count: 10,
		});

		await insertCommunityMember(db, communityId, entityId, 0);

		const result = await handleSiaCommunity(db, { entity_id: entityId });
		expect(result.communities).toHaveLength(1);
		expect(result.communities[0]?.id).toBe(communityId);
		expect(result.communities[0]?.summary).toBe("Auth module community");
		expect(result.communities[0]?.level).toBe(0);
		expect(result.communities[0]?.member_count).toBe(5);
	});

	// ---------------------------------------------------------------
	// query matches against community summary
	// ---------------------------------------------------------------

	it("query matches against community summary", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("comm-query", tmpDir);

		await insertCommunity(db, {
			level: 0,
			summary: "Authentication and authorization subsystem",
			member_count: 8,
		});
		await insertCommunity(db, {
			level: 0,
			summary: "Database layer and ORM utilities",
			member_count: 6,
		});

		const result = await handleSiaCommunity(db, { query: "auth" });
		expect(result.communities).toHaveLength(1);
		expect(result.communities[0]?.summary).toContain("auth");
	});

	// ---------------------------------------------------------------
	// level filter works
	// ---------------------------------------------------------------

	it("level filter works", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("comm-level", tmpDir);

		await insertCommunity(db, { level: 0, summary: "Fine-grained A", member_count: 3 });
		await insertCommunity(db, { level: 1, summary: "Medium-grained B", member_count: 10 });
		await insertCommunity(db, { level: 2, summary: "Coarse-grained C", member_count: 20 });

		const level0 = await handleSiaCommunity(db, { level: 0 });
		expect(level0.communities).toHaveLength(1);
		expect(level0.communities[0]?.level).toBe(0);

		const level1 = await handleSiaCommunity(db, { level: 1 });
		expect(level1.communities).toHaveLength(1);
		expect(level1.communities[0]?.level).toBe(1);

		const level2 = await handleSiaCommunity(db, { level: 2 });
		expect(level2.communities).toHaveLength(1);
		expect(level2.communities[0]?.level).toBe(2);
	});

	// ---------------------------------------------------------------
	// package_path filter works
	// ---------------------------------------------------------------

	it("package_path filter works", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("comm-pkg", tmpDir);

		await insertCommunity(db, {
			level: 0,
			summary: "Frontend components",
			member_count: 7,
			package_path: "packages/frontend",
		});
		await insertCommunity(db, {
			level: 0,
			summary: "Backend services",
			member_count: 12,
			package_path: "packages/backend",
		});
		await insertCommunity(db, {
			level: 0,
			summary: "Root utilities",
			member_count: 4,
		});

		const frontend = await handleSiaCommunity(db, { package_path: "packages/frontend" });
		expect(frontend.communities).toHaveLength(1);
		expect(frontend.communities[0]?.summary).toBe("Frontend components");
		expect(frontend.communities[0]?.package_path).toBe("packages/frontend");

		const backend = await handleSiaCommunity(db, { package_path: "packages/backend" });
		expect(backend.communities).toHaveLength(1);
		expect(backend.communities[0]?.summary).toBe("Backend services");
	});

	// ---------------------------------------------------------------
	// Results are capped at 3
	// ---------------------------------------------------------------

	it("returns at most 3 communities", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("comm-cap", tmpDir);

		for (let i = 0; i < 5; i++) {
			await insertCommunity(db, {
				level: 0,
				summary: `Community ${i}`,
				member_count: i + 1,
			});
		}

		const result = await handleSiaCommunity(db, {});
		expect(result.communities).toHaveLength(3);
	});
});
