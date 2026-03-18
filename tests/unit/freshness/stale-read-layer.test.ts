import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DirtyTracker } from "@/freshness/dirty-tracker";
import { addDependency } from "@/freshness/inverted-index";
import { checkFreshness, readRepair } from "@/freshness/stale-read-layer";
import type { SiaDb } from "@/graph/db-interface";
import { openGraphDb } from "@/graph/semantic-db";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Insert a minimal entity row with controllable t_created. */
async function seedEntity(
	db: SiaDb,
	id: string,
	opts?: { tCreated?: number; content?: string },
): Promise<void> {
	const now = opts?.tCreated ?? Date.now();
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
			"CodeEntity",
			id,
			opts?.content ?? "original content",
			"test summary",
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

/** Create a real temp file and return its path + mtime. */
function createTempFile(dir: string, name: string, content = "hello"): string {
	const filePath = join(dir, name);
	writeFileSync(filePath, content, "utf8");
	return filePath;
}

/** Set a specific mtime on a file (using utimes with same atime). */
function setMtime(filePath: string, mtimeMs: number): void {
	const atimeMs = statSync(filePath).atimeMs;
	utimesSync(filePath, atimeMs / 1000, mtimeMs / 1000);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("stale-read-layer (Layer 3)", () => {
	let tmpDir: string;
	let db: SiaDb | undefined;

	function makeTmp(): string {
		const dir = join(tmpdir(), `sia-test-srl-${randomUUID()}`);
		mkdirSync(dir, { recursive: true });
		return dir;
	}

	beforeEach(() => {
		tmpDir = makeTmp();
	});

	afterEach(async () => {
		if (db) {
			await db.close();
			db = undefined;
		}
		rmSync(tmpDir, { recursive: true, force: true });
	});

	// -----------------------------------------------------------------------
	// checkFreshness: clean node → Fresh without stat()
	// -----------------------------------------------------------------------
	describe("checkFreshness", () => {
		it("returns Fresh for a clean node without performing file stat", async () => {
			db = openGraphDb("srl-clean", tmpDir);
			await seedEntity(db, "node-1");

			// Add a source dep that points to a non-existent file.
			// If checkFreshness skips stat() for clean nodes, it will return
			// Fresh. If it mistakenly calls stat(), it would return Rotten.
			await addDependency(db, {
				source_path: join(tmpDir, "does-not-exist.ts"),
				node_id: "node-1",
				dep_type: "defines",
				source_mtime: 1000,
			});

			const tracker = new DirtyTracker();
			// node-1 is NOT marked dirty → checkNode returns 'clean' → no stat() needed

			const result = await checkFreshness(db, "node-1", tracker, tmpDir);

			// Must return Fresh even though the dep file doesn't exist,
			// because the clean fast-path skips the stat() entirely.
			expect(result.state).toBe("fresh");
		});

		// -----------------------------------------------------------------------
		// checkFreshness: node with no source deps → Fresh
		// -----------------------------------------------------------------------
		it("returns Fresh when the node has no source dependencies", async () => {
			db = openGraphDb("srl-nodeps", tmpDir);
			await seedEntity(db, "node-nodeps");

			const _tracker = new DirtyTracker();
			// Mark dirty so we skip the clean-fast-path and reach the dep-lookup
			await db.execute(
				"INSERT INTO source_deps (source_path, node_id, dep_type, source_mtime) VALUES (?, ?, ?, ?)",
				["fake-trigger.ts", "node-nodeps", "defines", 1000],
			);
			// But then delete all deps so getDependenciesForNode returns []
			await db.execute("DELETE FROM source_deps WHERE node_id = ?", ["node-nodeps"]);

			// Manually place the node in a dirty state via internal map (we
			// simulate this by using markDirty on a seeded dep, then deleting dep)
			// Simpler: just don't mark dirty; node is clean and returns Fresh early.
			// Instead, test a fresh-with-no-deps case where the node IS dirty but
			// getDependenciesForNode returns empty.
			//
			// Use a secondary db to simulate: seed dep, markDirty, remove dep, then check.
			const tracker2 = new DirtyTracker();
			const db2 = openGraphDb("srl-nodeps-2", tmpDir);

			const nodeId = "node-nd2";
			await seedEntity(db2, nodeId);
			await addDependency(db2, {
				source_path: "src/ghost.ts",
				node_id: nodeId,
				dep_type: "defines",
				source_mtime: 1000,
			});
			await tracker2.markDirty(db2, "src/ghost.ts");
			expect(tracker2.checkNode(nodeId)).toBe("dirty");

			// Remove dep so getDependenciesForNode returns []
			await db2.execute("DELETE FROM source_deps WHERE node_id = ?", [nodeId]);

			const result = await checkFreshness(db2, nodeId, tracker2, tmpDir);
			expect(result.state).toBe("fresh");

			await db2.close();
		});

		// -----------------------------------------------------------------------
		// checkFreshness: source unchanged → Fresh after stat()
		// -----------------------------------------------------------------------
		it("returns Fresh when source file mtime <= node t_created", async () => {
			db = openGraphDb("srl-unchanged", tmpDir);

			// Create temp file first
			const srcPath = createTempFile(tmpDir, "unchanged.ts", "export const x = 1;");

			// The file mtime will be <= 'now'. Set t_created to be well in the future
			// relative to the file's actual mtime so mtime <= t_created.
			const fileMtime = statSync(srcPath).mtimeMs;
			const tCreated = fileMtime + 60_000; // 60s after file mtime

			const nodeId = "node-unchanged";
			await seedEntity(db, nodeId, { tCreated });

			await addDependency(db, {
				source_path: srcPath,
				node_id: nodeId,
				dep_type: "defines",
				source_mtime: fileMtime,
			});

			const tracker = new DirtyTracker();
			await tracker.markDirty(db, srcPath);

			const result = await checkFreshness(db, nodeId, tracker, tmpDir);

			expect(result.state).toBe("fresh");
			expect(result.sourcePath).toBe(srcPath);
			expect(result.sourceMtime).toBe(fileMtime);
		});

		// -----------------------------------------------------------------------
		// checkFreshness: recently modified source → Stale
		// -----------------------------------------------------------------------
		it("returns Stale when source modified within staleness window", async () => {
			db = openGraphDb("srl-stale", tmpDir);

			const srcPath = createTempFile(tmpDir, "stale.ts", "export const y = 2;");

			// Set mtime to 10 seconds ago
			const now = Date.now();
			const fileMtime = now - 10_000; // 10s ago (within 30s active window)
			setMtime(srcPath, fileMtime);

			// t_created is even older than the file mtime → source was modified after extraction
			const tCreated = fileMtime - 5_000;

			const nodeId = "node-stale";
			await seedEntity(db, nodeId, { tCreated });

			await addDependency(db, {
				source_path: srcPath,
				node_id: nodeId,
				dep_type: "defines",
				source_mtime: tCreated,
			});

			const tracker = new DirtyTracker();
			await tracker.markDirty(db, srcPath);

			const result = await checkFreshness(db, nodeId, tracker, tmpDir, {
				activeEditWindowMs: 30_000,
			});

			expect(result.state).toBe("stale");
			expect(result.sourcePath).toBe(srcPath);
			expect(result.divergenceSeconds).toBeGreaterThan(0);
		});

		// -----------------------------------------------------------------------
		// checkFreshness: old modification → Rotten
		// -----------------------------------------------------------------------
		it("returns Rotten when source modified beyond staleness window", async () => {
			db = openGraphDb("srl-rotten", tmpDir);

			const srcPath = createTempFile(tmpDir, "rotten.ts", "export const z = 3;");

			// t_created is 20 minutes in the past
			const now = Date.now();
			const tCreated = now - 20 * 60_000; // extracted 20 minutes ago

			// File mtime is 10 minutes in the past — newer than tCreated by 10 minutes.
			// divergenceMs = fileMtime - tCreated = (now - 10min) - (now - 20min) = 10min (600_000ms)
			const fileMtime = now - 10 * 60_000;
			setMtime(srcPath, fileMtime);

			const nodeId = "node-rotten";
			await seedEntity(db, nodeId, { tCreated });

			await addDependency(db, {
				source_path: srcPath,
				node_id: nodeId,
				dep_type: "defines",
				source_mtime: tCreated,
			});

			const tracker = new DirtyTracker();
			await tracker.markDirty(db, srcPath);

			const result = await checkFreshness(db, nodeId, tracker, tmpDir, {
				activeEditWindowMs: 30_000,
				sessionCommitWindowMs: 300_000, // 5 minutes
				defaultWindowMs: Number.POSITIVE_INFINITY,
			});

			expect(result.state).toBe("rotten");
			expect(result.sourcePath).toBe(srcPath);
		});

		// -----------------------------------------------------------------------
		// checkFreshness: deleted source file → Rotten
		// -----------------------------------------------------------------------
		it("returns Rotten when source file has been deleted", async () => {
			db = openGraphDb("srl-deleted", tmpDir);

			const srcPath = join(tmpDir, "deleted.ts");
			// Do NOT create the file — simulate a deleted source

			const nodeId = "node-deleted";
			const now = Date.now();
			await seedEntity(db, nodeId, { tCreated: now - 60_000 });

			await addDependency(db, {
				source_path: srcPath,
				node_id: nodeId,
				dep_type: "defines",
				source_mtime: now - 60_000,
			});

			const tracker = new DirtyTracker();
			await tracker.markDirty(db, srcPath);

			const result = await checkFreshness(db, nodeId, tracker, tmpDir);

			expect(result.state).toBe("rotten");
			expect(result.sourcePath).toBe(srcPath);
		});
	});

	// -----------------------------------------------------------------------
	// readRepair: unchanged content → false (early cutoff)
	// -----------------------------------------------------------------------
	describe("readRepair", () => {
		it("returns false when source content hash is unchanged (early cutoff)", async () => {
			db = openGraphDb("srl-repair-unchanged", tmpDir);

			const srcContent = "export const a = 1;";
			const srcPath = createTempFile(tmpDir, "repair-unchanged.ts", srcContent);

			const nodeId = "node-repair-unchanged";
			// Seed with the same content so hash comparison will match
			await seedEntity(db, nodeId, { content: srcContent });

			await addDependency(db, {
				source_path: srcPath,
				node_id: nodeId,
				dep_type: "defines",
				source_mtime: Date.now() - 5000,
			});

			const tracker = new DirtyTracker();
			// Mark dirty so we can verify it gets cleaned
			await tracker.markDirty(db, srcPath);

			const changed = await readRepair(db, nodeId, tracker, tmpDir);

			expect(changed).toBe(false);
			// Early cutoff: node should be marked clean
			expect(tracker.checkNode(nodeId)).toBe("clean");
		});

		it("returns true when source content has changed", async () => {
			db = openGraphDb("srl-repair-changed", tmpDir);

			const newContent = "export const a = 999;";
			const srcPath = createTempFile(tmpDir, "repair-changed.ts", newContent);

			const nodeId = "node-repair-changed";
			// Seed with DIFFERENT content to simulate staleness
			await seedEntity(db, nodeId, { content: "export const a = 1;" });

			await addDependency(db, {
				source_path: srcPath,
				node_id: nodeId,
				dep_type: "defines",
				source_mtime: Date.now() - 5000,
			});

			const tracker = new DirtyTracker();
			await tracker.markDirty(db, srcPath);

			const changed = await readRepair(db, nodeId, tracker, tmpDir);

			expect(changed).toBe(true);
			// Node should be clean after markCleanAndPropagate
			expect(tracker.checkNode(nodeId)).toBe("clean");
		});
	});
});
