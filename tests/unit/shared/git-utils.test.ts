import { describe, expect, it } from "vitest";
import {
	currentBranch,
	currentCommit,
	getChangedFiles,
	isWorktree,
	previousBranch,
	resolveProjectGraphDir,
	resolveWorktreeRoot,
} from "@/shared/git-utils";

describe("git-utils", () => {
	describe("resolveWorktreeRoot", () => {
		it("should return the git repo root for the current directory", () => {
			const root = resolveWorktreeRoot();
			expect(root).toBeTruthy();
			expect(typeof root).toBe("string");
			expect(root?.length).toBeGreaterThan(0);
		});

		it("should return null for non-git directories", () => {
			const root = resolveWorktreeRoot("/tmp");
			expect(root).toBeNull();
		});
	});

	describe("isWorktree", () => {
		it("should return false for a normal checkout", () => {
			const result = isWorktree();
			expect(result).toBe(false);
		});
	});

	describe("currentBranch", () => {
		it("should return the current branch name", () => {
			const branch = currentBranch();
			expect(branch).toBeTruthy();
			expect(typeof branch).toBe("string");
			// We're on a feature branch; just verify it's non-empty
			expect(branch.length).toBeGreaterThan(0);
		});
	});

	describe("previousBranch", () => {
		it("should return a string", () => {
			const prev = previousBranch();
			expect(typeof prev).toBe("string");
		});

		it("should return empty string for non-git directories", () => {
			const prev = previousBranch("/tmp");
			expect(prev).toBe("");
		});
	});

	describe("currentCommit", () => {
		it("should return a short commit hash", () => {
			const commit = currentCommit();
			expect(commit).toBeTruthy();
			expect(commit.length).toBeGreaterThanOrEqual(7);
		});
	});

	describe("resolveProjectGraphDir", () => {
		it("should return a path within the worktree root", () => {
			const graphDir = resolveProjectGraphDir();
			expect(graphDir).toContain("sia-graph");
		});

		it("should use the provided cwd", () => {
			const root = resolveWorktreeRoot();
			if (root) {
				const graphDir = resolveProjectGraphDir(root);
				expect(graphDir).toContain(root);
			}
		});

		it("should return null for non-git directories", () => {
			const graphDir = resolveProjectGraphDir("/tmp");
			expect(graphDir).toBeNull();
		});
	});

	describe("getChangedFiles", () => {
		it("should return an array", () => {
			const files = getChangedFiles();
			expect(Array.isArray(files)).toBe(true);
		});

		it("should return objects with status and path", () => {
			const files = getChangedFiles();
			for (const f of files) {
				expect(typeof f.status).toBe("string");
				expect(typeof f.path).toBe("string");
			}
		});
	});
});
