#!/usr/bin/env bun
// Plugin hook wrapper: PostToolUse(Bash) → commit-capture-dispatch
//
// Reads the Claude Code PostToolUse event from stdin, invokes the
// commit-capture-dispatch handler, writes the response (potentially
// including a systemMessage) to stdout. Any error is logged to stderr
// and the hook exits 0 so Claude Code is never blocked by this
// subscriber.

import { createCommitCaptureDispatchHandler } from "@/hooks/handlers/commit-capture-dispatch";
import { parsePluginHookEvent, readStdin } from "@/hooks/plugin-common";

async function main() {
	try {
		const input = await readStdin();
		if (!input.trim()) return;

		const event = parsePluginHookEvent(input);
		const handler = createCommitCaptureDispatchHandler();
		const result = await handler(event);

		// Only write a response when we actually emit something — Claude
		// Code treats an empty stdout as "no hook output" which is exactly
		// the right signal for the skipped case.
		if (result.systemMessage) {
			process.stdout.write(JSON.stringify(result));
		}
	} catch (err) {
		process.stderr.write(`sia commit-capture-dispatch hook error: ${err}\n`);
		process.exit(0);
	}
}

main();
