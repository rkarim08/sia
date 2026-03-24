#!/usr/bin/env bun
// Plugin hook wrapper: Stop
//
// Reads Claude Code Stop event from stdin, runs pattern detection
// on recent transcript, captures uncaptured knowledge.

import { resolveRepoHash } from "@/capture/hook";
import { openGraphDb } from "@/graph/semantic-db";
import { createStopHandler } from "@/hooks/handlers/stop";
import { parsePluginHookEvent, readStdin } from "@/hooks/plugin-common";

async function main() {
	try {
		const input = await readStdin();
		if (!input.trim()) {
			process.exit(0);
		}

		const event = parsePluginHookEvent(input);
		const cwd = event.cwd || process.cwd();
		const repoHash = resolveRepoHash(cwd);
		const db = openGraphDb(repoHash);

		try {
			const handler = createStopHandler(db);
			const result = await handler(event);
			process.stdout.write(JSON.stringify(result));
		} finally {
			await db.close();
		}
	} catch (err) {
		process.stderr.write(`sia Stop hook error: ${err}\n`);
		process.exit(0);
	}
}

main();
