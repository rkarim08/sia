#!/usr/bin/env bun
// Plugin hook wrapper: PostToolUse
//
// Reads Claude Code hook event from stdin, delegates to the
// existing PostToolUse handler, writes response to stdout.

import { resolveRepoHash } from "@/capture/hook";
import { openGraphDb } from "@/graph/semantic-db";
import { createPostToolUseHandler } from "@/hooks/handlers/post-tool-use";
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
			const handler = createPostToolUseHandler(db);
			const result = await handler(event);
			process.stdout.write(JSON.stringify(result));
		} finally {
			await db.close();
		}
	} catch (err) {
		// Hooks must not crash Claude Code — fail silently
		process.stderr.write(`sia PostToolUse hook error: ${err}\n`);
		process.exit(0);
	}
}

main();
