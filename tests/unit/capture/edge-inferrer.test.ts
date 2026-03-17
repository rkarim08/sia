import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inferEdges } from "@/capture/edge-inferrer";
import type { SiaDb } from "@/graph/db-interface";
import { insertEntity } from "@/graph/entities";
import { openGraphDb } from "@/graph/semantic-db";

describe("inferEdges", () => {
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
	// Solution entity creates 'solves' edge to existing Bug (matching tags)
	// ---------------------------------------------------------------

	it("Solution entity creates 'solves' edge to existing Bug with matching tags", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("edge-inf-solves", tmpDir);

		// Insert a Bug entity with tags
		const bug = await insertEntity(db, {
			type: "Bug",
			name: "Memory Leak in Parser",
			content: "Parser leaks memory on large files",
			summary: "Parser memory leak",
			tags: JSON.stringify(["parser", "memory", "performance"]),
		});

		// Insert a Solution entity with overlapping tags
		const solution = await insertEntity(db, {
			type: "Solution",
			name: "Fix Parser Memory Leak",
			content: "Use streaming parser to fix memory leak",
			summary: "Streaming parser fix",
			tags: JSON.stringify(["parser", "memory", "streaming"]),
		});

		const count = await inferEdges(db, [solution.id]);

		expect(count).toBeGreaterThanOrEqual(1);

		// Verify a 'solves' edge was created from solution to bug
		const edges = await db.execute(
			"SELECT * FROM edges WHERE from_id = ? AND to_id = ? AND type = 'solves' AND t_valid_until IS NULL",
			[solution.id, bug.id],
		);
		expect(edges.rows).toHaveLength(1);
		expect((edges.rows[0] as { weight: number }).weight).toBeGreaterThanOrEqual(0.3);
	});

	// ---------------------------------------------------------------
	// Cap at 5 edges per entity
	// ---------------------------------------------------------------

	it("caps at 5 edges per entity even when 7 potential matches exist", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("edge-inf-cap", tmpDir);

		// Insert 7 Bug entities all sharing some tags with our Solution
		const sharedTags = ["auth", "security"];
		for (let i = 0; i < 7; i++) {
			await insertEntity(db, {
				type: "Bug",
				name: `Auth Bug ${i}`,
				content: `Authentication bug number ${i}`,
				summary: `Auth bug ${i}`,
				tags: JSON.stringify([...sharedTags, `extra-${i}`]),
			});
		}

		// Insert a Solution entity with matching tags
		const solution = await insertEntity(db, {
			type: "Solution",
			name: "Auth Security Fix",
			content: "Fix authentication security issues",
			summary: "Auth fix",
			tags: JSON.stringify(["auth", "security", "fix"]),
		});

		const count = await inferEdges(db, [solution.id]);

		expect(count).toBe(5);

		// Verify exactly 5 edges in the database for this entity
		const edges = await db.execute(
			"SELECT * FROM edges WHERE from_id = ? AND t_valid_until IS NULL",
			[solution.id],
		);
		expect(edges.rows).toHaveLength(5);
	});

	// ---------------------------------------------------------------
	// Weight threshold 0.3: low-weight edges not created
	// ---------------------------------------------------------------

	it("does not create edges below weight threshold 0.3", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("edge-inf-threshold", tmpDir);

		// Insert an entity with specific tags
		const entityA = await insertEntity(db, {
			type: "Concept",
			name: "Frontend Component",
			content: "React component for dashboard",
			summary: "Dashboard component",
			tags: JSON.stringify(["react", "dashboard", "frontend", "ui", "components"]),
		});

		// Insert another entity with completely different tags (zero overlap)
		await insertEntity(db, {
			type: "Concept",
			name: "Backend Service",
			content: "Database migration service",
			summary: "DB migration",
			tags: JSON.stringify(["database", "migration", "backend", "sql", "postgres"]),
		});

		const count = await inferEdges(db, [entityA.id]);

		// No overlap in tags and no type affinity, so weight should be 0 -> no edges
		expect(count).toBe(0);

		const edges = await db.execute(
			"SELECT * FROM edges WHERE from_id = ? AND t_valid_until IS NULL",
			[entityA.id],
		);
		expect(edges.rows).toHaveLength(0);
	});

	// ---------------------------------------------------------------
	// No edges for entity with no relationships
	// ---------------------------------------------------------------

	it("creates no edges for entity with no tags and no type affinity", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("edge-inf-none", tmpDir);

		// Insert an entity with empty tags and a type that has no affinity
		const entity = await insertEntity(db, {
			type: "Concept",
			name: "Orphan Entity",
			content: "An isolated concept with no connections",
			summary: "Orphan",
			tags: "[]",
		});

		// Insert some other entities
		await insertEntity(db, {
			type: "Concept",
			name: "Other Entity",
			content: "Another concept",
			summary: "Other",
			tags: JSON.stringify(["tag1", "tag2"]),
		});

		const count = await inferEdges(db, [entity.id]);

		expect(count).toBe(0);
	});

	// ---------------------------------------------------------------
	// Returns total count across multiple new entities
	// ---------------------------------------------------------------

	it("returns total edge count across multiple new entities", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("edge-inf-total", tmpDir);

		// Insert a Bug entity
		const _bug = await insertEntity(db, {
			type: "Bug",
			name: "Rendering Bug",
			content: "CSS rendering issue in sidebar",
			summary: "Sidebar rendering bug",
			tags: JSON.stringify(["css", "rendering", "sidebar"]),
		});

		// Insert two Solution entities that both match the bug
		const sol1 = await insertEntity(db, {
			type: "Solution",
			name: "Fix Sidebar CSS",
			content: "Apply flexbox fix for sidebar rendering",
			summary: "Flexbox sidebar fix",
			tags: JSON.stringify(["css", "rendering", "flexbox"]),
		});

		const sol2 = await insertEntity(db, {
			type: "Solution",
			name: "Fix Sidebar Layout",
			content: "Use grid layout for sidebar rendering",
			summary: "Grid sidebar fix",
			tags: JSON.stringify(["css", "sidebar", "grid"]),
		});

		const count = await inferEdges(db, [sol1.id, sol2.id]);

		// Each solution should create at least one edge to the bug
		expect(count).toBeGreaterThanOrEqual(2);

		// Verify edges exist from both solutions
		const edges1 = await db.execute(
			"SELECT * FROM edges WHERE from_id = ? AND t_valid_until IS NULL",
			[sol1.id],
		);
		expect(edges1.rows.length).toBeGreaterThanOrEqual(1);

		const edges2 = await db.execute(
			"SELECT * FROM edges WHERE from_id = ? AND t_valid_until IS NULL",
			[sol2.id],
		);
		expect(edges2.rows.length).toBeGreaterThanOrEqual(1);
	});
});
