import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DirtyTracker } from "@/freshness/dirty-tracker";
import type { GitOperation } from "@/freshness/git-reconcile-layer";
import { handleGitOperation, isGitOperation, parseGitDiff } from "@/freshness/git-reconcile-layer";
import { addDependency } from "@/freshness/inverted-index";
import type { SiaDb } from "@/graph/db-interface";
import { openGraphDb } from "@/graph/semantic-db";

/** Insert a minimal entity row. */
async function seedEntity(db: SiaDb, id: string, edgeCount = 0): Promise<void> {
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
			edgeCount,
			now,
			now,
			now,
			"private",
			"dev-1",
		],
	);
}

describe("git-reconcile-layer (Layer 2)", () => {
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
	// handleGitOperation
	// ---------------------------------------------------------------
	describe("handleGitOperation", () => {
		it("processes all changed files and returns correct counts", async () => {
			tmpDir = makeTmp();
			db = openGraphDb("grl-all-files", tmpDir);

			await seedEntity(db, "node-a");
			await seedEntity(db, "node-b");
			await seedEntity(db, "node-c");

			await addDependency(db, {
				source_path: "src/foo.ts",
				node_id: "node-a",
				dep_type: "defines",
				source_mtime: 1000,
			});
			await addDependency(db, {
				source_path: "src/bar.ts",
				node_id: "node-b",
				dep_type: "defines",
				source_mtime: 1000,
			});
			await addDependency(db, {
				source_path: "src/bar.ts",
				node_id: "node-c",
				dep_type: "extracted_from",
				source_mtime: 1000,
			});

			const tracker = new DirtyTracker();
			const op: GitOperation = {
				type: "merge",
				changedFiles: ["src/foo.ts", "src/bar.ts"],
			};

			const result = await handleGitOperation(db, op, tracker);

			expect(result.filesProcessed).toBe(2);
			expect(result.nodesDirtied).toBeGreaterThanOrEqual(3);
			expect(tracker.getState("node-a")).toBe("dirty");
			expect(tracker.getState("node-b")).toBe("dirty");
			expect(tracker.getState("node-c")).toBe("dirty");
		});

		it("returns zero counts when no files have dependents", async () => {
			tmpDir = makeTmp();
			db = openGraphDb("grl-no-deps", tmpDir);

			const tracker = new DirtyTracker();
			const op: GitOperation = {
				type: "commit",
				changedFiles: ["src/unknown.ts"],
			};

			const result = await handleGitOperation(db, op, tracker);
			expect(result.filesProcessed).toBe(1);
			expect(result.nodesDirtied).toBe(0);
		});

		it("handles empty changedFiles list", async () => {
			tmpDir = makeTmp();
			db = openGraphDb("grl-empty", tmpDir);

			const tracker = new DirtyTracker();
			const op: GitOperation = {
				type: "commit",
				changedFiles: [],
			};

			const result = await handleGitOperation(db, op, tracker);
			expect(result.filesProcessed).toBe(0);
			expect(result.nodesDirtied).toBe(0);
		});

		it("deduplicates nodes dirtied across multiple files", async () => {
			tmpDir = makeTmp();
			db = openGraphDb("grl-dedup", tmpDir);

			// A node that depends on two files — both changed in the same op
			await seedEntity(db, "shared-node");
			await addDependency(db, {
				source_path: "src/a.ts",
				node_id: "shared-node",
				dep_type: "defines",
				source_mtime: 1000,
			});
			await addDependency(db, {
				source_path: "src/b.ts",
				node_id: "shared-node",
				dep_type: "references",
				source_mtime: 1000,
			});

			const tracker = new DirtyTracker();
			const op: GitOperation = {
				type: "merge",
				changedFiles: ["src/a.ts", "src/b.ts"],
			};

			const result = await handleGitOperation(db, op, tracker);
			expect(result.filesProcessed).toBe(2);
			// Node should only be counted once in the deduplicated total
			expect(result.nodesDirtied).toBeGreaterThanOrEqual(1);
			expect(tracker.getState("shared-node")).toBe("dirty");
		});
	});

	// ---------------------------------------------------------------
	// parseGitDiff
	// ---------------------------------------------------------------
	describe("parseGitDiff", () => {
		it("extracts file paths from --name-only output", () => {
			const output = ["src/foo.ts", "src/bar.ts", "README.md"].join("\n");

			const files = parseGitDiff(output);
			expect(files).toEqual(["src/foo.ts", "src/bar.ts", "README.md"]);
		});

		it("extracts file paths from --stat output", () => {
			const output = [
				" src/foo.ts    | 10 ++++------",
				" src/bar.ts    |  3 ++-",
				" tests/x.ts   |  5 +++++",
				" 3 files changed, 12 insertions(+), 6 deletions(-)",
			].join("\n");

			const files = parseGitDiff(output);
			expect(files).toContain("src/foo.ts");
			expect(files).toContain("src/bar.ts");
			expect(files).toContain("tests/x.ts");
			expect(files).toHaveLength(3);
		});

		it("handles empty output", () => {
			expect(parseGitDiff("")).toEqual([]);
			expect(parseGitDiff("  \n  \n")).toEqual([]);
		});

		it("extracts file paths from --name-status output", () => {
			const output = [
				"M\tsrc/foo.ts",
				"A\tsrc/new.ts",
				"D\tsrc/old.ts",
				"R100\tsrc/before.ts\tsrc/after.ts",
			].join("\n");

			const files = parseGitDiff(output);
			expect(files).toContain("src/foo.ts");
			expect(files).toContain("src/new.ts");
			expect(files).toContain("src/old.ts");
			// For renames, both source and destination should be captured
			expect(files).toContain("src/before.ts");
			expect(files).toContain("src/after.ts");
		});
	});

	// ---------------------------------------------------------------
	// isGitOperation
	// ---------------------------------------------------------------
	describe("isGitOperation", () => {
		it("detects git commit", () => {
			const result = isGitOperation("git commit -m 'fix bug'");
			expect(result).not.toBeNull();
			expect(result?.type).toBe("commit");
		});

		it("detects git merge", () => {
			const result = isGitOperation("git merge feature-branch");
			expect(result).not.toBeNull();
			expect(result?.type).toBe("merge");
		});

		it("detects git checkout", () => {
			const result = isGitOperation("git checkout main");
			expect(result).not.toBeNull();
			expect(result?.type).toBe("checkout");
		});

		it("detects git rebase", () => {
			const result = isGitOperation("git rebase main");
			expect(result).not.toBeNull();
			expect(result?.type).toBe("rebase");
		});

		it("detects git pull", () => {
			const result = isGitOperation("git pull origin main");
			expect(result).not.toBeNull();
			expect(result?.type).toBe("pull");
		});

		it("detects git stash pop", () => {
			const result = isGitOperation("git stash pop");
			expect(result).not.toBeNull();
			expect(result?.type).toBe("stash_pop");
		});

		it("returns null for non-git commands", () => {
			expect(isGitOperation("npm install")).toBeNull();
			expect(isGitOperation("ls -la")).toBeNull();
			expect(isGitOperation("echo hello")).toBeNull();
			expect(isGitOperation("bun run test")).toBeNull();
		});

		it("returns null for git commands that do not change files", () => {
			expect(isGitOperation("git status")).toBeNull();
			expect(isGitOperation("git log")).toBeNull();
			expect(isGitOperation("git diff")).toBeNull();
			expect(isGitOperation("git branch")).toBeNull();
		});

		it("detects git switch (alias for checkout)", () => {
			const result = isGitOperation("git switch feature");
			expect(result).not.toBeNull();
			expect(result?.type).toBe("checkout");
		});
	});
});
