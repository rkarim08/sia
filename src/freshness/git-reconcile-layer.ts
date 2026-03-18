// Module: git-reconcile-layer — Layer 2 freshness invalidation
//
// Handles changes made outside the file watcher's scope: merges, rebases,
// checkouts, stash pops, and pulls. Processes 5-50 files at once but still
// targets O(affected nodes) not O(all nodes).
//
// Pipeline per git operation:
//   1. Parse the list of changed files from the git operation
//   2. For each file, call tracker.markDirty() with bounded BFS
//   3. Firewall nodes (edge_count > 50) stop propagation

import type { SiaDb } from "@/graph/db-interface";
import type { DirtyTracker } from "./dirty-tracker";

export interface GitOperation {
	type: "commit" | "merge" | "rebase" | "checkout" | "stash_pop" | "pull";
	changedFiles: string[]; // relative paths
}

/**
 * Layer 2: Process a git operation by invalidating all affected files' nodes.
 *
 * Pipeline:
 * 1. Parse the list of changed files from the git operation
 * 2. For each file, call tracker.markDirty() with bounded BFS
 * 3. Firewall nodes (edge_count > 50) stop propagation
 *
 * This is heavier than Layer 1 (may process 5-50 files at once for a merge)
 * but still targets O(affected nodes), not O(all nodes).
 */
export async function handleGitOperation(
	db: SiaDb,
	op: GitOperation,
	tracker: DirtyTracker,
): Promise<{ filesProcessed: number; nodesDirtied: number }> {
	const allDirtied = new Set<string>();

	for (const filePath of op.changedFiles) {
		const dirtied = await tracker.markDirty(db, filePath);
		for (const nodeId of dirtied) {
			allDirtied.add(nodeId);
		}
	}

	return {
		filesProcessed: op.changedFiles.length,
		nodesDirtied: allDirtied.size,
	};
}

/**
 * Parse git diff output to extract list of changed files.
 * Handles various diff formats from git commands:
 *   - --name-only: bare file paths, one per line
 *   - --name-status: "M\tpath" / "A\tpath" / "D\tpath" / "R100\told\tnew"
 *   - --stat: " path | N ++--" with a summary line at the end
 */
export function parseGitDiff(diffOutput: string): string[] {
	const lines = diffOutput.split("\n").filter((l) => l.trim().length > 0);
	if (lines.length === 0) return [];

	const files: string[] = [];

	for (const line of lines) {
		const trimmed = line.trim();

		// Skip git --stat summary lines like "3 files changed, 12 insertions(+), 6 deletions(-)"
		if (/^\d+\s+files?\s+changed/.test(trimmed)) {
			continue;
		}

		// --name-status format: "M\tpath" or "R100\told\tnew"
		if (/^[ACDMRTUX]\d*\t/.test(trimmed)) {
			const parts = trimmed.split("\t");
			// Skip the status prefix (parts[0])
			for (let i = 1; i < parts.length; i++) {
				const p = parts[i].trim();
				if (p.length > 0) {
					files.push(p);
				}
			}
			continue;
		}

		// --stat format: " path | N ++--"
		if (trimmed.includes("|")) {
			const pipeIdx = trimmed.indexOf("|");
			const path = trimmed.slice(0, pipeIdx).trim();
			if (path.length > 0 && !path.includes(" changed")) {
				files.push(path);
			}
			continue;
		}

		// --name-only format: bare file path (contains / or . but no spaces that look like a summary)
		if ((trimmed.includes("/") || trimmed.includes(".")) && !trimmed.includes(" files changed")) {
			files.push(trimmed);
		}
	}

	return files;
}

/** Git subcommands that modify the working tree and should trigger Layer 2. */
const GIT_OP_PATTERNS: Array<{
	pattern: RegExp;
	type: GitOperation["type"];
}> = [
	{ pattern: /^git\s+commit\b/, type: "commit" },
	{ pattern: /^git\s+merge\b/, type: "merge" },
	{ pattern: /^git\s+rebase\b/, type: "rebase" },
	{ pattern: /^git\s+checkout\b/, type: "checkout" },
	{ pattern: /^git\s+switch\b/, type: "checkout" },
	{ pattern: /^git\s+stash\s+pop\b/, type: "stash_pop" },
	{ pattern: /^git\s+stash\s+apply\b/, type: "stash_pop" },
	{ pattern: /^git\s+pull\b/, type: "pull" },
];

/** Git subcommands that are read-only and should NOT trigger Layer 2. */
const GIT_READONLY_PATTERNS: RegExp[] = [
	/^git\s+status\b/,
	/^git\s+log\b/,
	/^git\s+diff\b/,
	/^git\s+branch\b/,
	/^git\s+show\b/,
	/^git\s+remote\b/,
	/^git\s+fetch\b/,
	/^git\s+tag\b/,
	/^git\s+blame\b/,
	/^git\s+stash\s+list\b/,
];

/**
 * Detect if a bash command is a git operation that should trigger Layer 2.
 * Returns a GitOperation stub (with empty changedFiles — caller must populate
 * from `git diff` output) or null if the command is not a relevant git op.
 */
export function isGitOperation(command: string): GitOperation | null {
	const trimmed = command.trim();

	// Not a git command at all
	if (!trimmed.startsWith("git ")) {
		return null;
	}

	// Explicitly skip read-only git commands
	for (const ro of GIT_READONLY_PATTERNS) {
		if (ro.test(trimmed)) {
			return null;
		}
	}

	// Match against known write operations
	for (const { pattern, type } of GIT_OP_PATTERNS) {
		if (pattern.test(trimmed)) {
			return { type, changedFiles: [] };
		}
	}

	return null;
}
