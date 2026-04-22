import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SiaDb } from "@/graph/db-interface";
import { insertEdge } from "@/graph/edges";
import { archiveEntity, insertEntity, invalidateEntity } from "@/graph/entities";
import { openGraphDb } from "@/graph/semantic-db";
import { handleSiaBacklinks } from "@/mcp/tools/sia-backlinks";

function makeTmp(): string {
	const dir = join(tmpdir(), `sia-test-${randomUUID()}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

describe("sia_backlinks tool", () => {
	let tmpDir: string;
	let db: SiaDb | undefined;

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
	// Finds incoming edges grouped by type
	// ---------------------------------------------------------------

	it("finds incoming edges grouped by type", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("backlinks-grouped", tmpDir);

		// Create target entity
		const target = await insertEntity(db, {
			type: "CodeEntity",
			name: "AuthModule",
			content: "Authentication module",
			summary: "Auth module",
		});

		// Create 3 source entities with edges pointing to target
		const decision = await insertEntity(db, {
			type: "Decision",
			name: "Use JWT",
			content: "Use JWT for auth",
			summary: "JWT decision",
			importance: 0.8,
		});
		await insertEdge(db, {
			from_id: decision.id,
			to_id: target.id,
			type: "pertains_to",
		});

		const bug = await insertEntity(db, {
			type: "Bug",
			name: "Auth bypass",
			content: "Auth bypass in token validation",
			summary: "Auth bypass bug",
			importance: 0.9,
		});
		await insertEdge(db, {
			from_id: bug.id,
			to_id: target.id,
			type: "caused_by",
		});

		const convention = await insertEntity(db, {
			type: "Convention",
			name: "Always validate tokens",
			content: "All endpoints must validate tokens",
			summary: "Token validation convention",
			importance: 0.7,
		});
		await insertEdge(db, {
			from_id: convention.id,
			to_id: target.id,
			type: "pertains_to",
		});

		const result = await handleSiaBacklinks(db, { node_id: target.id });

		expect(result.target_id).toBe(target.id);
		expect(result.total_count).toBe(3);

		// Verify grouping
		expect(result.backlinks.pertains_to).toBeDefined();
		expect(result.backlinks.pertains_to).toHaveLength(2);
		expect(result.backlinks.caused_by).toBeDefined();
		expect(result.backlinks.caused_by).toHaveLength(1);
		expect(result.backlinks.caused_by[0].id).toBe(bug.id);

		// Verify pertains_to entries are ordered by importance DESC
		const pertainsIds = result.backlinks.pertains_to.map((e) => e.id);
		expect(pertainsIds).toContain(decision.id);
		expect(pertainsIds).toContain(convention.id);
		// decision (0.8) should come before convention (0.7)
		expect(pertainsIds.indexOf(decision.id)).toBeLessThan(pertainsIds.indexOf(convention.id));
	});

	// ---------------------------------------------------------------
	// Filters by edge_types
	// ---------------------------------------------------------------

	it("filters by edge_types", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("backlinks-filter", tmpDir);

		const target = await insertEntity(db, {
			type: "CodeEntity",
			name: "Parser",
			content: "Parser module",
			summary: "Parser",
		});

		const decision = await insertEntity(db, {
			type: "Decision",
			name: "Use recursive descent",
			content: "Use recursive descent parsing",
			summary: "Parsing decision",
		});
		await insertEdge(db, {
			from_id: decision.id,
			to_id: target.id,
			type: "pertains_to",
		});

		const bug = await insertEntity(db, {
			type: "Bug",
			name: "Stack overflow",
			content: "Stack overflow on deep nesting",
			summary: "Stack overflow bug",
		});
		await insertEdge(db, {
			from_id: bug.id,
			to_id: target.id,
			type: "caused_by",
		});

		// Query with only caused_by filter
		const result = await handleSiaBacklinks(db, {
			node_id: target.id,
			edge_types: ["caused_by"],
		});

		expect(result.total_count).toBe(1);
		expect(result.backlinks.caused_by).toBeDefined();
		expect(result.backlinks.caused_by).toHaveLength(1);
		expect(result.backlinks.caused_by[0].id).toBe(bug.id);
		expect(result.backlinks.pertains_to).toBeUndefined();
	});

	// ---------------------------------------------------------------
	// Excludes archived and invalidated entities
	// ---------------------------------------------------------------

	it("excludes archived and invalidated entities", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("backlinks-excluded", tmpDir);

		const target = await insertEntity(db, {
			type: "CodeEntity",
			name: "DataStore",
			content: "Data storage module",
			summary: "Data store",
		});

		// Active entity
		const active = await insertEntity(db, {
			type: "Decision",
			name: "Use SQLite",
			content: "Use SQLite for persistence",
			summary: "SQLite decision",
		});
		await insertEdge(db, {
			from_id: active.id,
			to_id: target.id,
			type: "pertains_to",
		});

		// Archived entity
		const archived = await insertEntity(db, {
			type: "Decision",
			name: "Use IndexedDB",
			content: "Use IndexedDB for persistence",
			summary: "IndexedDB decision",
		});
		await insertEdge(db, {
			from_id: archived.id,
			to_id: target.id,
			type: "pertains_to",
		});
		await archiveEntity(db, archived.id);

		// Invalidated entity
		const invalidated = await insertEntity(db, {
			type: "Decision",
			name: "Use localStorage",
			content: "Use localStorage for persistence",
			summary: "localStorage decision",
		});
		await insertEdge(db, {
			from_id: invalidated.id,
			to_id: target.id,
			type: "pertains_to",
		});
		await invalidateEntity(db, invalidated.id);

		const result = await handleSiaBacklinks(db, { node_id: target.id });

		expect(result.total_count).toBe(1);
		expect(result.backlinks.pertains_to).toHaveLength(1);
		expect(result.backlinks.pertains_to[0].id).toBe(active.id);
	});

	// ---------------------------------------------------------------
	// Returns empty result for node with no backlinks
	// ---------------------------------------------------------------

	it("returns empty result for node with no backlinks", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("backlinks-empty", tmpDir);

		const lonelyNode = await insertEntity(db, {
			type: "Concept",
			name: "Orphan concept",
			content: "No one references this",
			summary: "Orphan",
		});

		const result = await handleSiaBacklinks(db, { node_id: lonelyNode.id });

		expect(result.target_id).toBe(lonelyNode.id);
		expect(result.total_count).toBe(0);
		expect(Object.keys(result.backlinks)).toHaveLength(0);
	});

	// ---------------------------------------------------------------
	// next_steps populated when backlinks found
	// ---------------------------------------------------------------

	it("populates next_steps when backlinks found", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("backlinks-next-steps", tmpDir);

		const target = await insertEntity(db, {
			type: "CodeEntity",
			name: "Target",
			content: "",
			summary: "",
		});
		const caller = await insertEntity(db, {
			type: "CodeEntity",
			name: "Caller",
			content: "",
			summary: "",
		});
		await insertEdge(db, { from_id: caller.id, to_id: target.id, type: "pertains_to" });

		const result = await handleSiaBacklinks(db, { node_id: target.id });
		expect(result.total_count).toBeGreaterThan(0);
		expect(result.next_steps?.length).toBeGreaterThan(0);
		expect(result.next_steps?.map((s) => s.tool)).toContain("sia_expand");
	});
});
