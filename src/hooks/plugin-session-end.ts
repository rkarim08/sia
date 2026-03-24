#!/usr/bin/env bun
// Plugin hook wrapper: SessionEnd
//
// Reads Claude Code SessionEnd event from stdin, records session
// statistics and updates ended_at timestamp in the graph.

import { resolveRepoHash } from "@/capture/hook";
import { openGraphDb } from "@/graph/semantic-db";
import { createSessionEndHandler } from "@/hooks/handlers/session-end";
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
			const handler = createSessionEndHandler(db);
			const result = await handler(event);
			process.stdout.write(JSON.stringify(result));
		} finally {
			await db.close();
		}
	} catch (err) {
		process.stderr.write(`sia SessionEnd hook error: ${err}\n`);
		process.exit(0);
	}
}

main();
