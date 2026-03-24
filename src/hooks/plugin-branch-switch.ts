#!/usr/bin/env bun
// Plugin hook: Branch switch detection
//
// Triggered by PostToolUse on Bash commands matching git checkout/switch.
// Saves snapshot for the old branch state, restores snapshot for the new branch.

import { resolveRepoHash } from "@/capture/hook";
import { openGraphDb } from "@/graph/semantic-db";
import {
	createBranchSnapshot,
	restoreBranchSnapshot,
} from "@/graph/snapshots";
import { parsePluginHookEvent, readStdin } from "@/hooks/plugin-common";
import { currentBranch, currentCommit } from "@/shared/git-utils";

async function main() {
	try {
		const input = await readStdin();
		if (!input.trim()) {
			process.exit(0);
		}

		const event = parsePluginHookEvent(input);

		if (event.tool_name !== "Bash") {
			process.exit(0);
		}

		const command = event.tool_input?.command as string | undefined;
		if (!command) {
			process.exit(0);
		}

		const isCheckout = /^git\s+(checkout|switch)\b/.test(command);
		if (!isCheckout) {
			process.exit(0);
		}

		const cwd = event.cwd || process.cwd();
		const repoHash = resolveRepoHash(cwd);
		const db = openGraphDb(repoHash);

		try {
			const newBranch = currentBranch(cwd);
			const newCommit = currentCommit(cwd);

			if (!newBranch) {
				process.exit(0);
			}

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
		process.exit(0);
	}
}

main();
