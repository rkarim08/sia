import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DirtyTracker } from "@/freshness/dirty-tracker";
import { addDependency } from "@/freshness/inverted-index";
import type { SiaDb } from "@/graph/db-interface";
import { openGraphDb } from "@/graph/semantic-db";

/** Insert a minimal entity row. */
async function seedEntity(db: SiaDb, id: string, edgeCount = 0): Promise<void> {
	const now = Date.now();
	await db.execute(
		`INSERT INTO graph_nodes (
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
			edgeCount,
			now,
			now,
			now,
			"private",
			"dev-1",
		],
	);
}

/** Insert an active edge between two entities. */
async function seedEdge(
	db: SiaDb,
	fromId: string,
	toId: string,
	type = "depends_on",
): Promise<void> {
	const now = Date.now();
	await db.execute(
		`INSERT INTO graph_edges (
			id, from_id, to_id, type, weight, confidence, trust_tier,
			t_created
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		[randomUUID(), fromId, toId, type, 1.0, 0.7, 3, now],
	);
}

describe("DirtyTracker", () => {
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
	// getState
	// ---------------------------------------------------------------
	describe("getState", () => {
		it("returns 'clean' for unknown nodes", () => {
			const tracker = new DirtyTracker();
			expect(tracker.getState("unknown-node")).toBe("clean");
		});

		it("returns 'dirty' after node is marked dirty", async () => {
			tmpDir = makeTmp();
			db = openGraphDb("dt-getstate", tmpDir);

			await seedEntity(db, "node-1");
			await addDependency(db, {
				source_path: "src/foo.ts",
				node_id: "node-1",
				dep_type: "defines",
				source_mtime: 1000,
			});

			const tracker = new DirtyTracker();
			await tracker.markDirty(db, "src/foo.ts");

			expect(tracker.getState("node-1")).toBe("dirty");
		});
	});

	// ---------------------------------------------------------------
	// markDirty
	// ---------------------------------------------------------------
	describe("markDirty", () => {
		it("marks affected nodes from inverted index", async () => {
			tmpDir = makeTmp();
			db = openGraphDb("dt-markdirty", tmpDir);

			await seedEntity(db, "node-a");
			await seedEntity(db, "node-b");

			await addDependency(db, {
				source_path: "src/shared.ts",
				node_id: "node-a",
				dep_type: "defines",
				source_mtime: 1000,
			});
			await addDependency(db, {
				source_path: "src/shared.ts",
				node_id: "node-b",
				dep_type: "extracted_from",
				source_mtime: 1000,
			});

			const tracker = new DirtyTracker();
			const dirtied = await tracker.markDirty(db, "src/shared.ts");

			expect(dirtied).toContain("node-a");
			expect(dirtied).toContain("node-b");
			expect(tracker.getState("node-a")).toBe("dirty");
			expect(tracker.getState("node-b")).toBe("dirty");
		});

		it("returns empty array for files with no dependents", async () => {
			tmpDir = makeTmp();
			db = openGraphDb("dt-markdirty-empty", tmpDir);

			const tracker = new DirtyTracker();
			const dirtied = await tracker.markDirty(db, "src/unknown.ts");

			expect(dirtied).toHaveLength(0);
		});

		it("propagates dirty via BFS to neighbors", async () => {
			tmpDir = makeTmp();
			db = openGraphDb("dt-bfs", tmpDir);

			await seedEntity(db, "root", 1);
			await seedEntity(db, "neighbor", 2);

			await addDependency(db, {
				source_path: "src/root.ts",
				node_id: "root",
				dep_type: "defines",
				source_mtime: 1000,
			});

			await seedEdge(db, "root", "neighbor");

			const tracker = new DirtyTracker();
			const dirtied = await tracker.markDirty(db, "src/root.ts");

			expect(dirtied).toContain("root");
			expect(dirtied).toContain("neighbor");
			expect(tracker.getState("neighbor")).toBe("dirty");
		});

		it("stops BFS propagation at firewall nodes (edge_count > threshold)", async () => {
			tmpDir = makeTmp();
			db = openGraphDb("dt-firewall", tmpDir);

			await seedEntity(db, "root", 2);
			await seedEntity(db, "hub", 60); // exceeds default threshold of 50
			await seedEntity(db, "beyond-hub", 1);

			await addDependency(db, {
				source_path: "src/root.ts",
				node_id: "root",
				dep_type: "defines",
				source_mtime: 1000,
			});

			await seedEdge(db, "root", "hub");
			await seedEdge(db, "hub", "beyond-hub");

			const tracker = new DirtyTracker();
			const dirtied = await tracker.markDirty(db, "src/root.ts");

			expect(dirtied).toContain("root");
			// hub is marked maybe_dirty, not dirty
			expect(tracker.getState("hub")).toBe("maybe_dirty");
			// beyond-hub should not be reached (BFS stopped at hub)
			expect(tracker.getState("beyond-hub")).toBe("clean");
		});

		it("respects maxDepth option", async () => {
			tmpDir = makeTmp();
			db = openGraphDb("dt-maxdepth", tmpDir);

			await seedEntity(db, "level-0", 2);
			await seedEntity(db, "level-1", 2);
			await seedEntity(db, "level-2", 2);

			await addDependency(db, {
				source_path: "src/start.ts",
				node_id: "level-0",
				dep_type: "defines",
				source_mtime: 1000,
			});

			await seedEdge(db, "level-0", "level-1");
			await seedEdge(db, "level-1", "level-2");

			const tracker = new DirtyTracker();
			const dirtied = await tracker.markDirty(db, "src/start.ts", {
				maxDepth: 1,
			});

			expect(dirtied).toContain("level-0");
			expect(dirtied).toContain("level-1");
			expect(tracker.getState("level-2")).toBe("clean");
		});
	});

	// ---------------------------------------------------------------
	// checkNode
	// ---------------------------------------------------------------
	describe("checkNode", () => {
		it("returns 'clean' for unknown nodes", () => {
			const tracker = new DirtyTracker();
			expect(tracker.checkNode("anything")).toBe("clean");
		});

		it("returns 'dirty' for dirty nodes", async () => {
			tmpDir = makeTmp();
			db = openGraphDb("dt-check-dirty", tmpDir);

			await seedEntity(db, "node-x");
			await addDependency(db, {
				source_path: "src/x.ts",
				node_id: "node-x",
				dep_type: "defines",
				source_mtime: 1000,
			});

			const tracker = new DirtyTracker();
			await tracker.markDirty(db, "src/x.ts");

			expect(tracker.checkNode("node-x")).toBe("dirty");
		});

		it("returns 'maybe_dirty' for firewall-halted nodes", async () => {
			tmpDir = makeTmp();
			db = openGraphDb("dt-check-maybe", tmpDir);

			await seedEntity(db, "src-node", 1);
			await seedEntity(db, "hub-node", 60);

			await addDependency(db, {
				source_path: "src/s.ts",
				node_id: "src-node",
				dep_type: "defines",
				source_mtime: 1000,
			});

			await seedEdge(db, "src-node", "hub-node");

			const tracker = new DirtyTracker();
			await tracker.markDirty(db, "src/s.ts");

			expect(tracker.checkNode("hub-node")).toBe("maybe_dirty");
		});
	});

	// ---------------------------------------------------------------
	// markClean (early cutoff)
	// ---------------------------------------------------------------
	describe("markClean", () => {
		it("clears dirty state for a node", async () => {
			tmpDir = makeTmp();
			db = openGraphDb("dt-markclean", tmpDir);

			await seedEntity(db, "node-c");
			await addDependency(db, {
				source_path: "src/c.ts",
				node_id: "node-c",
				dep_type: "defines",
				source_mtime: 1000,
			});

			const tracker = new DirtyTracker();
			await tracker.markDirty(db, "src/c.ts");
			expect(tracker.getState("node-c")).toBe("dirty");

			tracker.markClean("node-c");
			expect(tracker.getState("node-c")).toBe("clean");
		});

		it("does NOT propagate to dependents (early cutoff)", async () => {
			tmpDir = makeTmp();
			db = openGraphDb("dt-cutoff", tmpDir);

			await seedEntity(db, "parent", 1);
			await seedEntity(db, "child", 1);

			await addDependency(db, {
				source_path: "src/p.ts",
				node_id: "parent",
				dep_type: "defines",
				source_mtime: 1000,
			});

			await seedEdge(db, "parent", "child");

			const tracker = new DirtyTracker();
			await tracker.markDirty(db, "src/p.ts");

			expect(tracker.getState("parent")).toBe("dirty");
			expect(tracker.getState("child")).toBe("dirty");

			// Early cutoff: clean parent without propagating
			tracker.markClean("parent");

			// child stays dirty (it was dirtied in the initial markDirty BFS)
			expect(tracker.getState("parent")).toBe("clean");
			expect(tracker.getState("child")).toBe("dirty");
		});
	});

	// ---------------------------------------------------------------
	// markCleanAndPropagate
	// ---------------------------------------------------------------
	describe("markCleanAndPropagate", () => {
		it("marks the node clean and propagates dirty to dependents", async () => {
			tmpDir = makeTmp();
			db = openGraphDb("dt-propagate", tmpDir);

			await seedEntity(db, "changed", 1);
			await seedEntity(db, "downstream", 2);

			await seedEdge(db, "changed", "downstream");

			const tracker = new DirtyTracker();
			// Manually set the node dirty first
			await seedEntity(db, "trigger");
			await addDependency(db, {
				source_path: "src/trigger.ts",
				node_id: "changed",
				dep_type: "defines",
				source_mtime: 1000,
			});
			await tracker.markDirty(db, "src/trigger.ts");

			// Now clear + propagate
			const propagated = await tracker.markCleanAndPropagate(db, "changed");

			expect(tracker.getState("changed")).toBe("clean");
			expect(propagated).toContain("downstream");
			expect(tracker.getState("downstream")).toBe("dirty");
		});
	});

	// ---------------------------------------------------------------
	// Durability
	// ---------------------------------------------------------------
	describe("durability", () => {
		it("durable nodes skip dirty when only volatile sources change", async () => {
			tmpDir = makeTmp();
			db = openGraphDb("dt-durable", tmpDir);

			await seedEntity(db, "durable-node");
			await seedEntity(db, "volatile-node");

			await addDependency(db, {
				source_path: "src/volatile.ts",
				node_id: "durable-node",
				dep_type: "defines",
				source_mtime: 1000,
			});
			await addDependency(db, {
				source_path: "src/volatile.ts",
				node_id: "volatile-node",
				dep_type: "defines",
				source_mtime: 1000,
			});

			const tracker = new DirtyTracker();
			tracker.setDurability("durable-node", "durable");
			tracker.setDurability("volatile-node", "volatile");

			// Mark dirty with a volatile source change
			const dirtied = await tracker.markDirty(db, "src/volatile.ts");

			// durable-node should be skipped; volatile-node should be dirtied
			expect(dirtied).not.toContain("durable-node");
			expect(dirtied).toContain("volatile-node");
			expect(tracker.getState("durable-node")).toBe("clean");
			expect(tracker.getState("volatile-node")).toBe("dirty");
		});
	});

	// ---------------------------------------------------------------
	// reset
	// ---------------------------------------------------------------
	describe("reset", () => {
		it("clears all dirty state", async () => {
			tmpDir = makeTmp();
			db = openGraphDb("dt-reset", tmpDir);

			await seedEntity(db, "n1");
			await seedEntity(db, "n2");

			await addDependency(db, {
				source_path: "src/r.ts",
				node_id: "n1",
				dep_type: "defines",
				source_mtime: 1000,
			});
			await addDependency(db, {
				source_path: "src/r.ts",
				node_id: "n2",
				dep_type: "defines",
				source_mtime: 1000,
			});

			const tracker = new DirtyTracker();
			await tracker.markDirty(db, "src/r.ts");

			expect(tracker.getState("n1")).toBe("dirty");
			expect(tracker.getState("n2")).toBe("dirty");

			tracker.reset();

			expect(tracker.getState("n1")).toBe("clean");
			expect(tracker.getState("n2")).toBe("clean");
		});

		it("resets stats to zero", async () => {
			tmpDir = makeTmp();
			db = openGraphDb("dt-reset-stats", tmpDir);

			await seedEntity(db, "s1");
			await addDependency(db, {
				source_path: "src/s.ts",
				node_id: "s1",
				dep_type: "defines",
				source_mtime: 1000,
			});

			const tracker = new DirtyTracker();
			await tracker.markDirty(db, "src/s.ts");

			expect(tracker.getStats().total).toBeGreaterThan(0);

			tracker.reset();

			const stats = tracker.getStats();
			expect(stats.total).toBe(0);
			expect(stats.dirty).toBe(0);
			expect(stats.maybeDirty).toBe(0);
			expect(stats.clean).toBe(0);
		});
	});

	// ---------------------------------------------------------------
	// getStats
	// ---------------------------------------------------------------
	describe("getStats", () => {
		it("returns correct counts", async () => {
			tmpDir = makeTmp();
			db = openGraphDb("dt-stats", tmpDir);

			await seedEntity(db, "clean-node", 0);
			await seedEntity(db, "dirty-node", 1);
			await seedEntity(db, "hub-node", 60);

			await addDependency(db, {
				source_path: "src/d.ts",
				node_id: "dirty-node",
				dep_type: "defines",
				source_mtime: 1000,
			});

			// edge from dirty-node -> hub-node (hub is firewall)
			await seedEdge(db, "dirty-node", "hub-node");

			const tracker = new DirtyTracker();
			await tracker.markDirty(db, "src/d.ts");

			const stats = tracker.getStats();
			expect(stats.dirty).toBe(1); // dirty-node
			expect(stats.maybeDirty).toBe(1); // hub-node
			expect(stats.total).toBe(2);
		});
	});
});
