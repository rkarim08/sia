import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	addDependency,
	getAllSourcePaths,
	getDependenciesForNode,
	getDependentsForFile,
	rebuildFromGraph,
	removeDependenciesForNode,
	removeDependency,
} from "@/freshness/inverted-index";
import type { SiaDb } from "@/graph/db-interface";
import { openGraphDb } from "@/graph/semantic-db";

/** Insert a minimal entity row so FK constraints are satisfied. */
async function seedEntity(db: SiaDb, id: string): Promise<void> {
	const now = Date.now();
	await db.execute(
		`INSERT INTO entities (
			id, type, name, content, summary, tags, file_paths,
			trust_tier, confidence, base_confidence,
			importance, base_importance, access_count, edge_count,
			last_accessed, created_at, t_created,
			visibility, created_by
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			id,
			"Concept",
			id,
			"test",
			"test",
			"[]",
			"[]",
			3,
			0.7,
			0.7,
			0.5,
			0.5,
			0,
			0,
			now,
			now,
			now,
			"private",
			"dev-1",
		],
	);
}

describe("inverted dependency index (source_deps)", () => {
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
	// addDependency + getDependentsForFile round-trip
	// ---------------------------------------------------------------
	it("addDependency + getDependentsForFile round-trip", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("idx-roundtrip", tmpDir);

		await seedEntity(db, "entity-1");

		await addDependency(db, {
			source_path: "src/foo.ts",
			node_id: "entity-1",
			dep_type: "defines",
			source_mtime: 1000,
		});

		const deps = await getDependentsForFile(db, "src/foo.ts");
		expect(deps).toHaveLength(1);
		expect(deps[0].source_path).toBe("src/foo.ts");
		expect(deps[0].node_id).toBe("entity-1");
		expect(deps[0].dep_type).toBe("defines");
		expect(deps[0].source_mtime).toBe(1000);
	});

	// ---------------------------------------------------------------
	// addDependency is idempotent (INSERT OR REPLACE)
	// ---------------------------------------------------------------
	it("addDependency is idempotent and updates mtime", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("idx-idempotent", tmpDir);

		await seedEntity(db, "entity-2");

		await addDependency(db, {
			source_path: "src/bar.ts",
			node_id: "entity-2",
			dep_type: "defines",
			source_mtime: 1000,
		});
		await addDependency(db, {
			source_path: "src/bar.ts",
			node_id: "entity-2",
			dep_type: "extracted_from",
			source_mtime: 2000,
		});

		const deps = await getDependentsForFile(db, "src/bar.ts");
		expect(deps).toHaveLength(1);
		expect(deps[0].dep_type).toBe("extracted_from");
		expect(deps[0].source_mtime).toBe(2000);
	});

	// ---------------------------------------------------------------
	// removeDependency removes a specific mapping
	// ---------------------------------------------------------------
	it("removeDependency removes specific mapping", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("idx-remove", tmpDir);

		await seedEntity(db, "n1");
		await seedEntity(db, "n2");

		await addDependency(db, {
			source_path: "src/a.ts",
			node_id: "n1",
			dep_type: "defines",
			source_mtime: 100,
		});
		await addDependency(db, {
			source_path: "src/a.ts",
			node_id: "n2",
			dep_type: "defines",
			source_mtime: 100,
		});

		await removeDependency(db, "src/a.ts", "n1");

		const deps = await getDependentsForFile(db, "src/a.ts");
		expect(deps).toHaveLength(1);
		expect(deps[0].node_id).toBe("n2");
	});

	// ---------------------------------------------------------------
	// removeDependenciesForNode clears all for a node
	// ---------------------------------------------------------------
	it("removeDependenciesForNode clears all deps for a node", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("idx-remove-node", tmpDir);

		await seedEntity(db, "nodeA");
		await seedEntity(db, "nodeB");

		await addDependency(db, {
			source_path: "src/x.ts",
			node_id: "nodeA",
			dep_type: "defines",
			source_mtime: 100,
		});
		await addDependency(db, {
			source_path: "src/y.ts",
			node_id: "nodeA",
			dep_type: "references",
			source_mtime: 200,
		});
		await addDependency(db, {
			source_path: "src/x.ts",
			node_id: "nodeB",
			dep_type: "defines",
			source_mtime: 100,
		});

		await removeDependenciesForNode(db, "nodeA");

		// nodeA deps gone
		const nodeADeps = await getDependenciesForNode(db, "nodeA");
		expect(nodeADeps).toHaveLength(0);

		// nodeB dep still present
		const nodeBDeps = await getDependenciesForNode(db, "nodeB");
		expect(nodeBDeps).toHaveLength(1);
	});

	// ---------------------------------------------------------------
	// getDependenciesForNode returns all sources
	// ---------------------------------------------------------------
	it("getDependenciesForNode returns all sources for a node", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("idx-deps-for-node", tmpDir);

		await seedEntity(db, "n1");

		await addDependency(db, {
			source_path: "src/one.ts",
			node_id: "n1",
			dep_type: "defines",
			source_mtime: 100,
		});
		await addDependency(db, {
			source_path: "src/two.ts",
			node_id: "n1",
			dep_type: "extracted_from",
			source_mtime: 200,
		});

		const deps = await getDependenciesForNode(db, "n1");
		expect(deps).toHaveLength(2);

		const paths = deps.map((d) => d.source_path).sort();
		expect(paths).toEqual(["src/one.ts", "src/two.ts"]);
	});

	// ---------------------------------------------------------------
	// getAllSourcePaths returns distinct paths
	// ---------------------------------------------------------------
	it("getAllSourcePaths returns distinct paths", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("idx-all-paths", tmpDir);

		await seedEntity(db, "n1");
		await seedEntity(db, "n2");
		await seedEntity(db, "n3");

		await addDependency(db, {
			source_path: "src/a.ts",
			node_id: "n1",
			dep_type: "defines",
			source_mtime: 100,
		});
		await addDependency(db, {
			source_path: "src/a.ts",
			node_id: "n2",
			dep_type: "defines",
			source_mtime: 100,
		});
		await addDependency(db, {
			source_path: "src/b.ts",
			node_id: "n3",
			dep_type: "defines",
			source_mtime: 200,
		});

		const paths = await getAllSourcePaths(db);
		expect(paths.sort()).toEqual(["src/a.ts", "src/b.ts"]);
	});

	// ---------------------------------------------------------------
	// rebuildFromGraph populates from existing entities
	// ---------------------------------------------------------------
	it("rebuildFromGraph populates from existing entities", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("idx-rebuild", tmpDir);

		const now = Date.now();

		// Insert an entity with file_paths
		await db.execute(
			`INSERT INTO entities (
				id, type, name, content, summary, tags, file_paths,
				trust_tier, confidence, base_confidence,
				importance, base_importance, access_count, edge_count,
				last_accessed, created_at, t_created,
				visibility, created_by
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				"ent-1",
				"CodeEntity",
				"MyFunc",
				"A function",
				"A func",
				"[]",
				'["src/main.ts", "src/utils.ts"]',
				2,
				0.9,
				0.9,
				0.5,
				0.5,
				0,
				0,
				now,
				now,
				now,
				"private",
				"dev-1",
			],
		);

		// Insert another entity without file_paths (should be skipped)
		await db.execute(
			`INSERT INTO entities (
				id, type, name, content, summary, tags, file_paths,
				trust_tier, confidence, base_confidence,
				importance, base_importance, access_count, edge_count,
				last_accessed, created_at, t_created,
				visibility, created_by
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				"ent-2",
				"Concept",
				"Something",
				"desc",
				"sum",
				"[]",
				"[]",
				3,
				0.7,
				0.7,
				0.5,
				0.5,
				0,
				0,
				now,
				now,
				now,
				"private",
				"dev-1",
			],
		);

		const count = await rebuildFromGraph(db);

		// ent-1 has 2 file_paths => 2 deps
		expect(count).toBe(2);

		const deps = await getDependentsForFile(db, "src/main.ts");
		expect(deps).toHaveLength(1);
		expect(deps[0].node_id).toBe("ent-1");
		expect(deps[0].dep_type).toBe("defines");

		const deps2 = await getDependentsForFile(db, "src/utils.ts");
		expect(deps2).toHaveLength(1);
		expect(deps2[0].node_id).toBe("ent-1");
	});

	// ---------------------------------------------------------------
	// rebuildFromGraph handles pertains_to edges
	// ---------------------------------------------------------------
	it("rebuildFromGraph handles pertains_to edges", async () => {
		tmpDir = makeTmp();
		db = openGraphDb("idx-rebuild-edges", tmpDir);

		const now = Date.now();

		// Target entity with file_paths (e.g. a CodeEntity)
		await db.execute(
			`INSERT INTO entities (
				id, type, name, content, summary, tags, file_paths,
				trust_tier, confidence, base_confidence,
				importance, base_importance, access_count, edge_count,
				last_accessed, created_at, t_created,
				visibility, created_by
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				"code-1",
				"CodeEntity",
				"Handler",
				"A handler",
				"handler",
				"[]",
				'["src/handler.ts"]',
				2,
				0.9,
				0.9,
				0.5,
				0.5,
				0,
				0,
				now,
				now,
				now,
				"private",
				"dev-1",
			],
		);

		// Source entity (e.g. a Decision that pertains_to the CodeEntity)
		await db.execute(
			`INSERT INTO entities (
				id, type, name, content, summary, tags, file_paths,
				trust_tier, confidence, base_confidence,
				importance, base_importance, access_count, edge_count,
				last_accessed, created_at, t_created,
				visibility, created_by
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				"decision-1",
				"Decision",
				"Use pattern X",
				"We decided to use pattern X",
				"Use X",
				"[]",
				"[]",
				1,
				1.0,
				1.0,
				0.8,
				0.8,
				0,
				0,
				now,
				now,
				now,
				"private",
				"dev-1",
			],
		);

		// pertains_to edge: decision-1 -> code-1
		await db.execute(
			`INSERT INTO edges (
				id, from_id, to_id, type, weight, confidence, trust_tier,
				t_created
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			["edge-1", "decision-1", "code-1", "pertains_to", 1.0, 0.9, 2, now],
		);

		const count = await rebuildFromGraph(db);

		// code-1 has 1 file_path => 1 defines dep
		// decision-1 pertains_to code-1 which has 1 file_path => 1 pertains_to dep
		expect(count).toBe(2);

		const deps = await getDependentsForFile(db, "src/handler.ts");
		expect(deps).toHaveLength(2);

		const nodeIds = deps.map((d) => d.node_id).sort();
		expect(nodeIds).toEqual(["code-1", "decision-1"]);

		const decisionDep = deps.find((d) => d.node_id === "decision-1");
		expect(decisionDep?.dep_type).toBe("pertains_to");
	});
});
