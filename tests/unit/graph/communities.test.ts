import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	addMember,
	getCommunity,
	getCommunityByLevel,
	getMembers,
	getSummaries,
	insertCommunity,
	needsResummarization,
	removeMembers,
	updateCommunity,
} from "@/graph/communities";
import type { SiaDb } from "@/graph/db-interface";
import { insertEntity } from "@/graph/entities";
import { openGraphDb } from "@/graph/semantic-db";

describe("community CRUD layer", () => {
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
	// Insert and retrieve community round-trip
	// ---------------------------------------------------------------

	it("insert and retrieve community round-trip", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("com-roundtrip", tmpDir);

		const community = await insertCommunity(db, {
			level: 0,
			package_path: "packages/frontend",
		});

		expect(community.id).toBeDefined();
		expect(community.level).toBe(0);
		expect(community.package_path).toBe("packages/frontend");
		expect(community.parent_id).toBeNull();
		expect(community.summary).toBeNull();
		expect(community.summary_hash).toBeNull();
		expect(community.member_count).toBe(0);
		expect(community.last_summary_member_count).toBe(0);
		expect(community.created_at).toBeGreaterThan(0);
		expect(community.updated_at).toBeGreaterThan(0);

		const retrieved = await getCommunity(db, community.id);
		expect(retrieved).not.toBeNull();
		expect(retrieved?.id).toBe(community.id);
		expect(retrieved?.level).toBe(0);
		expect(retrieved?.package_path).toBe("packages/frontend");
	});

	// ---------------------------------------------------------------
	// Returns null for non-existent ID
	// ---------------------------------------------------------------

	it("returns null for non-existent ID", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("com-nonexistent", tmpDir);

		const result = await getCommunity(db, "nonexistent-id");
		expect(result).toBeNull();
	});

	// ---------------------------------------------------------------
	// updateCommunity modifies summary and timestamps
	// ---------------------------------------------------------------

	it("updateCommunity modifies summary and timestamps", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("com-update", tmpDir);

		const community = await insertCommunity(db, { level: 1 });

		const before = await getCommunity(db, community.id);
		expect(before?.summary).toBeNull();
		expect(before?.member_count).toBe(0);

		await updateCommunity(db, community.id, {
			summary: "This community covers authentication and security modules.",
			summary_hash: "abc123",
			member_count: 5,
			last_summary_member_count: 5,
		});

		const updated = await getCommunity(db, community.id);
		expect(updated?.summary).toBe("This community covers authentication and security modules.");
		expect(updated?.summary_hash).toBe("abc123");
		expect(updated?.member_count).toBe(5);
		expect(updated?.last_summary_member_count).toBe(5);
		// Level should remain unchanged
		expect(updated?.level).toBe(1);
	});

	// ---------------------------------------------------------------
	// Add and retrieve members
	// ---------------------------------------------------------------

	it("add and retrieve members", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("com-members", tmpDir);

		const community = await insertCommunity(db, { level: 0 });

		// Insert real entities to satisfy FK constraint
		const entity1 = await insertEntity(db, {
			type: "Concept",
			name: "Entity 1",
			content: "Content 1",
			summary: "Summary 1",
			created_by: "dev-1",
		});
		const entity2 = await insertEntity(db, {
			type: "Concept",
			name: "Entity 2",
			content: "Content 2",
			summary: "Summary 2",
			created_by: "dev-1",
		});

		await addMember(db, community.id, entity1.id, 0);
		await addMember(db, community.id, entity2.id, 0);

		const members = await getMembers(db, community.id);
		expect(members).toHaveLength(2);

		const memberIds = members.map((m) => m.entity_id);
		expect(memberIds).toContain(entity1.id);
		expect(memberIds).toContain(entity2.id);

		for (const m of members) {
			expect(m.community_id).toBe(community.id);
			expect(m.level).toBe(0);
		}
	});

	// ---------------------------------------------------------------
	// addMember is idempotent (INSERT OR IGNORE)
	// ---------------------------------------------------------------

	it("addMember is idempotent", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("com-member-idempotent", tmpDir);

		const community = await insertCommunity(db, { level: 0 });
		const entity = await insertEntity(db, {
			type: "Concept",
			name: "Idempotent Entity",
			content: "Content",
			summary: "Summary",
			created_by: "dev-1",
		});

		await addMember(db, community.id, entity.id, 0);
		await addMember(db, community.id, entity.id, 0); // duplicate, should not throw

		const members = await getMembers(db, community.id);
		expect(members).toHaveLength(1);
	});

	// ---------------------------------------------------------------
	// removeMembers clears all members for a community
	// ---------------------------------------------------------------

	it("removeMembers clears all members for a community", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("com-remove-members", tmpDir);

		const community = await insertCommunity(db, { level: 0 });

		const entity1 = await insertEntity(db, {
			type: "Concept",
			name: "Entity A",
			content: "Content A",
			summary: "Summary A",
			created_by: "dev-1",
		});
		const entity2 = await insertEntity(db, {
			type: "Concept",
			name: "Entity B",
			content: "Content B",
			summary: "Summary B",
			created_by: "dev-1",
		});

		await addMember(db, community.id, entity1.id, 0);
		await addMember(db, community.id, entity2.id, 0);

		const beforeRemove = await getMembers(db, community.id);
		expect(beforeRemove).toHaveLength(2);

		await removeMembers(db, community.id);

		const afterRemove = await getMembers(db, community.id);
		expect(afterRemove).toHaveLength(0);
	});

	// ---------------------------------------------------------------
	// removeMembers only affects the target community
	// ---------------------------------------------------------------

	it("removeMembers only affects the target community", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("com-remove-scoped", tmpDir);

		const comm1 = await insertCommunity(db, { level: 0 });
		const comm2 = await insertCommunity(db, { level: 0 });

		const entity = await insertEntity(db, {
			type: "Concept",
			name: "Shared Entity",
			content: "Content",
			summary: "Summary",
			created_by: "dev-1",
		});

		await addMember(db, comm1.id, entity.id, 0);
		await addMember(db, comm2.id, entity.id, 0);

		await removeMembers(db, comm1.id);

		const comm1Members = await getMembers(db, comm1.id);
		expect(comm1Members).toHaveLength(0);

		const comm2Members = await getMembers(db, comm2.id);
		expect(comm2Members).toHaveLength(1);
	});

	// ---------------------------------------------------------------
	// getCommunityByLevel filters correctly
	// ---------------------------------------------------------------

	it("getCommunityByLevel filters by level", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("com-by-level", tmpDir);

		const level0 = await insertCommunity(db, { level: 0 });
		const level1a = await insertCommunity(db, { level: 1 });
		const level1b = await insertCommunity(db, { level: 1 });
		await insertCommunity(db, { level: 2 });

		const results0 = await getCommunityByLevel(db, 0);
		expect(results0).toHaveLength(1);
		expect(results0[0]?.id).toBe(level0.id);

		const results1 = await getCommunityByLevel(db, 1);
		expect(results1).toHaveLength(2);
		const ids1 = results1.map((c) => c.id);
		expect(ids1).toContain(level1a.id);
		expect(ids1).toContain(level1b.id);

		const results2 = await getCommunityByLevel(db, 2);
		expect(results2).toHaveLength(1);
	});

	// ---------------------------------------------------------------
	// getCommunityByLevel filters by packagePath when provided
	// ---------------------------------------------------------------

	it("getCommunityByLevel filters by packagePath", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("com-by-level-pkg", tmpDir);

		await insertCommunity(db, { level: 0, package_path: "packages/frontend" });
		await insertCommunity(db, { level: 0, package_path: "packages/backend" });
		await insertCommunity(db, { level: 0 }); // null package_path

		const frontend = await getCommunityByLevel(db, 0, "packages/frontend");
		expect(frontend).toHaveLength(1);
		expect(frontend[0]?.package_path).toBe("packages/frontend");

		const all = await getCommunityByLevel(db, 0);
		expect(all).toHaveLength(3);
	});

	// ---------------------------------------------------------------
	// getSummaries returns only communities with a summary
	// ---------------------------------------------------------------

	it("getSummaries returns communities with summary, ordered by member_count DESC", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("com-summaries", tmpDir);

		const c1 = await insertCommunity(db, { level: 0 });
		const c2 = await insertCommunity(db, { level: 1 });
		const c3 = await insertCommunity(db, { level: 0 });

		// c3 has no summary — should be excluded
		await updateCommunity(db, c1.id, {
			summary: "Summary of community 1",
			member_count: 10,
		});
		await updateCommunity(db, c2.id, {
			summary: "Summary of community 2",
			member_count: 5,
		});

		const summaries = await getSummaries(db);
		expect(summaries).toHaveLength(2);
		// Ordered by member_count DESC: c1 (10) before c2 (5)
		expect(summaries[0]?.id).toBe(c1.id);
		expect(summaries[0]?.summary).toBe("Summary of community 1");
		expect(summaries[0]?.member_count).toBe(10);
		expect(summaries[1]?.id).toBe(c2.id);

		// Excluded community without summary
		const ids = summaries.map((s) => s.id);
		expect(ids).not.toContain(c3.id);
	});

	// ---------------------------------------------------------------
	// getSummaries respects level filter
	// ---------------------------------------------------------------

	it("getSummaries respects level filter", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("com-summaries-level", tmpDir);

		const c0 = await insertCommunity(db, { level: 0 });
		const c1 = await insertCommunity(db, { level: 1 });

		await updateCommunity(db, c0.id, { summary: "Level 0 summary", member_count: 3 });
		await updateCommunity(db, c1.id, { summary: "Level 1 summary", member_count: 7 });

		const level0Summaries = await getSummaries(db, 0);
		expect(level0Summaries).toHaveLength(1);
		expect(level0Summaries[0]?.id).toBe(c0.id);

		const level1Summaries = await getSummaries(db, 1);
		expect(level1Summaries).toHaveLength(1);
		expect(level1Summaries[0]?.id).toBe(c1.id);
	});

	// ---------------------------------------------------------------
	// getSummaries respects limit
	// ---------------------------------------------------------------

	it("getSummaries respects limit", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("com-summaries-limit", tmpDir);

		for (let i = 0; i < 5; i++) {
			const c = await insertCommunity(db, { level: 0 });
			await updateCommunity(db, c.id, {
				summary: `Summary ${i}`,
				member_count: i,
			});
		}

		const limited = await getSummaries(db, undefined, 3);
		expect(limited).toHaveLength(3);
	});

	// ---------------------------------------------------------------
	// needsResummarization detects >20% change threshold
	// ---------------------------------------------------------------

	it("needsResummarization returns false when change is within 20%", async () => {
		// 10 members at summary time, now 11 — 10% change
		const community = {
			id: "test-id",
			level: 0 as const,
			parent_id: null,
			summary: "Some summary",
			summary_hash: null,
			member_count: 11,
			last_summary_member_count: 10,
			package_path: null,
			created_at: Date.now(),
			updated_at: Date.now(),
		};
		expect(needsResummarization(community)).toBe(false);
	});

	it("needsResummarization returns true when change exceeds 20%", async () => {
		// 10 members at summary time, now 13 — 30% change
		const community = {
			id: "test-id",
			level: 0 as const,
			parent_id: null,
			summary: "Some summary",
			summary_hash: null,
			member_count: 13,
			last_summary_member_count: 10,
			package_path: null,
			created_at: Date.now(),
			updated_at: Date.now(),
		};
		expect(needsResummarization(community)).toBe(true);
	});

	it("needsResummarization returns true when members drop by >20%", async () => {
		// 10 members at summary time, now 7 — 30% drop
		const community = {
			id: "test-id",
			level: 0 as const,
			parent_id: null,
			summary: "Some summary",
			summary_hash: null,
			member_count: 7,
			last_summary_member_count: 10,
			package_path: null,
			created_at: Date.now(),
			updated_at: Date.now(),
		};
		expect(needsResummarization(community)).toBe(true);
	});

	it("needsResummarization handles zero last_summary_member_count safely", async () => {
		// Edge case: never summarized yet (last_summary_member_count = 0, max(last,1) = 1)
		const community = {
			id: "test-id",
			level: 0 as const,
			parent_id: null,
			summary: null,
			summary_hash: null,
			member_count: 1,
			last_summary_member_count: 0,
			package_path: null,
			created_at: Date.now(),
			updated_at: Date.now(),
		};
		// |1 - 0| / max(0, 1) = 1/1 = 1.0 > 0.20 → true
		expect(needsResummarization(community)).toBe(true);
	});

	it("needsResummarization returns false at exact 20% boundary", async () => {
		// 10 members at summary time, now 12 — exactly 20% change (not strictly greater)
		const community = {
			id: "test-id",
			level: 0 as const,
			parent_id: null,
			summary: "Some summary",
			summary_hash: null,
			member_count: 12,
			last_summary_member_count: 10,
			package_path: null,
			created_at: Date.now(),
			updated_at: Date.now(),
		};
		// |12 - 10| / max(10, 1) = 2/10 = 0.20, not > 0.20
		expect(needsResummarization(community)).toBe(false);
	});
});
