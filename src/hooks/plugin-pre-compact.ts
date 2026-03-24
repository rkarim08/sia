#!/usr/bin/env bun
// Plugin hook wrapper: PreCompact
//
// Reads Claude Code PreCompact event from stdin, scans transcript
// tail for unextracted knowledge before compaction discards detail.

import { resolveRepoHash } from "@/capture/hook";
import { openGraphDb } from "@/graph/semantic-db";
import { createPreCompactHandler } from "@/hooks/handlers/pre-compact";
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
			const handler = createPreCompactHandler(db);
			const result = await handler(event);
			process.stdout.write(JSON.stringify(result));
		} finally {
			await db.close();
		}
	} catch (err) {
		process.stderr.write(`sia PreCompact hook error: ${err}\n`);
		process.exit(0);
	}
}

main();
