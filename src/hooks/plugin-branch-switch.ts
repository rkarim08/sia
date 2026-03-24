#!/usr/bin/env bun
// Plugin hook: Branch switch detection
//
// Triggered by PostToolUse on Bash commands matching git checkout/switch.
// Saves a snapshot of the current graph under the old branch name,
// then restores (or creates) a snapshot for the new branch.

import { resolveRepoHash } from "@/capture/hook";
import { openGraphDb } from "@/graph/semantic-db";
import {
	createBranchSnapshot,
	restoreBranchSnapshot,
} from "@/graph/snapshots";
import { parsePluginHookEvent, readStdin } from "@/hooks/plugin-common";
import { currentBranch, currentCommit, previousBranch } from "@/shared/git-utils";

async function main() {
	try {
		const input = await readStdin();
		if (!input.trim()) return;

		const event = parsePluginHookEvent(input);

		if (event.tool_name !== "Bash") return;

		const command = event.tool_input?.command as string | undefined;
		if (!command) return;

		const isCheckout = /^git\s+(checkout|switch)\b/.test(command);
		if (!isCheckout) return;

		const cwd = event.cwd || process.cwd();
		const repoHash = resolveRepoHash(cwd);
		const db = openGraphDb(repoHash);

		try {
			const newBranch = currentBranch(cwd);
			const newCommit = currentCommit(cwd);

			if (!newBranch) return; // detached HEAD — nothing to snapshot

			// Save current graph state under the OLD branch name before restoring
			const oldBranch = previousBranch(cwd);
			if (oldBranch && oldBranch !== newBranch) {
				await createBranchSnapshot(db, oldBranch, currentCommit(cwd));
				process.stderr.write(`sia: saved graph snapshot for branch '${oldBranch}'\n`);
			}

			// Restore snapshot for the new branch, or create an initial one
			const restored = await restoreBranchSnapshot(db, newBranch);

			if (restored) {
				process.stderr.write(`sia: restored graph snapshot for branch '${newBranch}'\n`);
			} else {
				await createBranchSnapshot(db, newBranch, newCommit);
				process.stderr.write(`sia: created initial graph snapshot for branch '${newBranch}'\n`);
			}
		} finally {
			await db.close();
		}
	} catch (err) {
		process.stderr.write(`sia branch-switch hook error: ${err}\n`);
	}
}

main();
