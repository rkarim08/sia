// Module: git-utils — Git worktree detection and path resolution

import { execFileSync } from "node:child_process";
import { join } from "node:path";

/**
 * Resolve the root directory of the current git worktree (or main checkout).
 * Uses `git rev-parse --show-toplevel` which returns the worktree root
 * when inside a worktree, or the main checkout root in a normal repo.
 * Returns null if not in a git repo.
 */
export function resolveWorktreeRoot(cwd?: string): string | null {
	try {
		return execFileSync("git", ["rev-parse", "--show-toplevel"], {
			cwd: cwd ?? process.cwd(),
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		}).trim();
	} catch {
		return null;
	}
}

/**
 * Check if the current directory is inside a git worktree (not the main checkout).
 * Compares --git-dir with --git-common-dir. In a worktree, git-dir points to
 * .git/worktrees/<name> while git-common-dir points to the main .git.
 */
export function isWorktree(cwd?: string): boolean {
	try {
		const opts = {
			cwd: cwd ?? process.cwd(),
			encoding: "utf-8" as const,
			stdio: ["pipe", "pipe", "pipe"] as const,
		};
		const gitDir = execFileSync("git", ["rev-parse", "--git-dir"], opts).trim();
		const commonDir = execFileSync("git", ["rev-parse", "--git-common-dir"], opts).trim();
		return gitDir !== commonDir && !gitDir.endsWith("/.git") && gitDir !== ".git";
	} catch {
		return false;
	}
}

/**
 * Get the current branch name.
 * Returns empty string for detached HEAD.
 */
export function currentBranch(cwd?: string): string {
	try {
		return execFileSync("git", ["branch", "--show-current"], {
			cwd: cwd ?? process.cwd(),
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		}).trim();
	} catch {
		return "";
	}
}

/**
 * Get the current HEAD commit hash (short form).
 */
export function currentCommit(cwd?: string): string {
	try {
		return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
			cwd: cwd ?? process.cwd(),
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		}).trim();
	} catch {
		return "";
	}
}

/**
 * Resolve the project-local graph database directory.
 * Always `<worktree-root>/.sia-graph/`. Each worktree gets its own
 * independent graph directory so parallel worktrees don't collide.
 * Returns null if not inside a git repo.
 */
export function resolveProjectGraphDir(cwd?: string): string | null {
	const root = resolveWorktreeRoot(cwd);
	if (!root) return null;
	return join(root, ".sia-graph");
}

/**
 * Get the list of files changed between two refs (or between HEAD~1 and HEAD).
 * Uses `git diff --name-status` which handles adds, mods, deletes, and renames.
 */
export function getChangedFiles(
	fromRef?: string,
	toRef?: string,
	cwd?: string,
): Array<{ status: string; path: string; oldPath?: string }> {
	try {
		const args = ["diff", "--name-status"];
		if (fromRef && toRef) {
			args.push(fromRef, toRef);
		} else if (fromRef) {
			args.push(fromRef, "HEAD");
		} else {
			args.push("HEAD~1", "HEAD");
		}

		const output = execFileSync("git", args, {
			cwd: cwd ?? process.cwd(),
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		}).trim();

		if (!output) return [];

		return output.split("\n").map((line) => {
			const parts = line.split("\t");
			const status = parts[0].charAt(0);
			if (status === "R" && parts.length >= 3) {
				return { status, path: parts[2], oldPath: parts[1] };
			}
			return { status, path: parts[1] ?? parts[0] };
		});
	} catch {
		return [];
	}
}
