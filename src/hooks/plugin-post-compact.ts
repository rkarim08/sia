#!/usr/bin/env bun

// Plugin hook wrapper: PostCompact
//
// Reads Claude Code PostCompact event from stdin. Lightweight handler
// that logs compaction coverage info for observability.

import { createPostCompactHandler } from "@/hooks/handlers/post-compact";
import { parsePluginHookEvent, readStdin } from "@/hooks/plugin-common";

async function main() {
	try {
		const input = await readStdin();
		if (!input.trim()) {
			process.exit(0);
		}

		const event = parsePluginHookEvent(input);
		const handler = createPostCompactHandler();
		const result = await handler(event);
		process.stdout.write(JSON.stringify(result));
	} catch (err) {
		process.stderr.write(`sia PostCompact hook error: ${err}\n`);
		process.exit(0);
	}
}

main();
