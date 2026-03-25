import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CuckooFilter } from "@/freshness/cuckoo-filter";
import { DirtyTracker } from "@/freshness/dirty-tracker";
import type { FileChangeEvent } from "@/freshness/file-watcher-layer";
import { createDebouncedHandler, handleFileChange } from "@/freshness/file-watcher-layer";
import { addDependency } from "@/freshness/inverted-index";
import type { SiaDb } from "@/graph/db-interface";
import { openGraphDb } from "@/graph/semantic-db";

/** Insert a minimal entity row. */
async function seedEntity(db: SiaDb, id: string, edgeCount = 0, filePaths = "[]"): Promise<void> {
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
			"CodeEntity",
			id,
			"test content",
			"test summary",
			"[]",
			filePaths,
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
async function _seedEdge(
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

describe("file-watcher-layer (Layer 1)", () => {
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
	// handleFileChange: Cuckoo filter skip
	// ---------------------------------------------------------------
	describe("handleFileChange", () => {
		it("skips files not in Cuckoo filter (returns empty)", async () => {
			tmpDir = makeTmp();
			db = openGraphDb("fwl-skip", tmpDir);

			const tracker = new DirtyTracker();
			const filter = new CuckooFilter();
			// filter is empty — no paths registered

			const event: FileChangeEvent = {
				filePath: "src/unknown.ts",
				type: "modify",
			};

			const dirtied = await handleFileChange(db, event, tracker, filter);
			expect(dirtied).toHaveLength(0);
		});

		it("marks affected nodes dirty for known files", async () => {
			tmpDir = makeTmp();
			db = openGraphDb("fwl-dirty", tmpDir);

			await seedEntity(db, "node-a", 0, '["src/foo.ts"]');
			await seedEntity(db, "node-b", 0, '["src/foo.ts"]');

			await addDependency(db, {
				source_path: "src/foo.ts",
				node_id: "node-a",
				dep_type: "defines",
				source_mtime: 1000,
			});
			await addDependency(db, {
				source_path: "src/foo.ts",
				node_id: "node-b",
				dep_type: "extracted_from",
				source_mtime: 1000,
			});

			const tracker = new DirtyTracker();
			const filter = new CuckooFilter();
			filter.add("src/foo.ts");

			const event: FileChangeEvent = {
				filePath: "src/foo.ts",
				type: "modify",
				mtime: 2000,
			};

			const dirtied = await handleFileChange(db, event, tracker, filter);
			expect(dirtied).toContain("node-a");
			expect(dirtied).toContain("node-b");
			expect(tracker.getState("node-a")).toBe("dirty");
			expect(tracker.getState("node-b")).toBe("dirty");
		});

		it("handles 'delete' events by invalidating nodes derived solely from the file", async () => {
			tmpDir = makeTmp();
			db = openGraphDb("fwl-delete", tmpDir);

			await seedEntity(db, "only-from-deleted", 0, '["src/gone.ts"]');
			await addDependency(db, {
				source_path: "src/gone.ts",
				node_id: "only-from-deleted",
				dep_type: "defines",
				source_mtime: 1000,
			});

			const tracker = new DirtyTracker();
			const filter = new CuckooFilter();
			filter.add("src/gone.ts");

			const event: FileChangeEvent = {
				filePath: "src/gone.ts",
				type: "delete",
			};

			const dirtied = await handleFileChange(db, event, tracker, filter);
			expect(dirtied).toContain("only-from-deleted");

			// Verify the entity was invalidated (t_valid_until set)
			const { rows } = await db.execute("SELECT t_valid_until FROM graph_nodes WHERE id = ?", [
				"only-from-deleted",
			]);
			expect(rows[0].t_valid_until).not.toBeNull();
		});

		it("handles 'modify' events and marks nodes dirty", async () => {
			tmpDir = makeTmp();
			db = openGraphDb("fwl-modify", tmpDir);

			await seedEntity(db, "mod-node", 0, '["src/modified.ts"]');
			await addDependency(db, {
				source_path: "src/modified.ts",
				node_id: "mod-node",
				dep_type: "defines",
				source_mtime: 1000,
			});

			const tracker = new DirtyTracker();
			const filter = new CuckooFilter();
			filter.add("src/modified.ts");

			const event: FileChangeEvent = {
				filePath: "src/modified.ts",
				type: "modify",
				mtime: 3000,
			};

			const dirtied = await handleFileChange(db, event, tracker, filter);
			expect(dirtied.length).toBeGreaterThan(0);
			expect(dirtied).toContain("mod-node");
			expect(tracker.getState("mod-node")).toBe("dirty");
		});

		it("handles 'create' events for files already tracked in filter", async () => {
			tmpDir = makeTmp();
			db = openGraphDb("fwl-create", tmpDir);

			await seedEntity(db, "create-node", 0, '["src/new.ts"]');
			await addDependency(db, {
				source_path: "src/new.ts",
				node_id: "create-node",
				dep_type: "defines",
				source_mtime: 500,
			});

			const tracker = new DirtyTracker();
			const filter = new CuckooFilter();
			filter.add("src/new.ts");

			const event: FileChangeEvent = {
				filePath: "src/new.ts",
				type: "create",
				mtime: 1000,
			};

			const dirtied = await handleFileChange(db, event, tracker, filter);
			expect(dirtied).toContain("create-node");
		});
	});

	// ---------------------------------------------------------------
	// createDebouncedHandler: coalescing rapid events
	// ---------------------------------------------------------------
	describe("createDebouncedHandler", () => {
		beforeEach(() => {
			vi.useFakeTimers();
		});

		afterEach(() => {
			vi.useRealTimers();
		});

		it("coalesces rapid events within the debounce window", async () => {
			tmpDir = makeTmp();
			db = openGraphDb("fwl-debounce", tmpDir);

			await seedEntity(db, "debounce-node", 0, '["src/rapid.ts"]');
			await addDependency(db, {
				source_path: "src/rapid.ts",
				node_id: "debounce-node",
				dep_type: "defines",
				source_mtime: 1000,
			});

			const tracker = new DirtyTracker();
			const filter = new CuckooFilter();
			filter.add("src/rapid.ts");

			const handler = createDebouncedHandler(db, tracker, filter, 50);

			// Fire three rapid events for the same file
			handler({ filePath: "src/rapid.ts", type: "modify", mtime: 2000 });
			handler({ filePath: "src/rapid.ts", type: "modify", mtime: 2001 });
			handler({ filePath: "src/rapid.ts", type: "modify", mtime: 2002 });

			// Before the debounce fires, node should still be clean
			// (no immediate processing)
			expect(tracker.getState("debounce-node")).toBe("clean");

			// Advance past debounce window
			vi.advanceTimersByTime(100);

			// After debounce, the latest event should have been processed
			expect(tracker.getState("debounce-node")).toBe("dirty");
		});

		it("processes events for different files independently", async () => {
			tmpDir = makeTmp();
			db = openGraphDb("fwl-debounce-multi", tmpDir);

			await seedEntity(db, "node-x", 0, '["src/x.ts"]');
			await seedEntity(db, "node-y", 0, '["src/y.ts"]');
			await addDependency(db, {
				source_path: "src/x.ts",
				node_id: "node-x",
				dep_type: "defines",
				source_mtime: 1000,
			});
			await addDependency(db, {
				source_path: "src/y.ts",
				node_id: "node-y",
				dep_type: "defines",
				source_mtime: 1000,
			});

			const tracker = new DirtyTracker();
			const filter = new CuckooFilter();
			filter.add("src/x.ts");
			filter.add("src/y.ts");

			const handler = createDebouncedHandler(db, tracker, filter, 50);

			handler({ filePath: "src/x.ts", type: "modify" });
			handler({ filePath: "src/y.ts", type: "modify" });

			vi.advanceTimersByTime(100);

			expect(tracker.getState("node-x")).toBe("dirty");
			expect(tracker.getState("node-y")).toBe("dirty");
		});
	});
});
