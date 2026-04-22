#!/usr/bin/env bun
// Plugin hook wrapper: PostToolUse
//
// Reads Claude Code hook event from stdin, delegates to the
// existing PostToolUse handler, writes response to stdout.

import { resolveRepoHash } from "@/capture/hook";
import { openGraphDb } from "@/graph/semantic-db";
import { createPostToolUseHandler } from "@/hooks/handlers/post-tool-use";
import { parsePluginHookEvent, readStdin } from "@/hooks/plugin-common";
import { runDiscomfortSignal } from "@/nous/discomfort-signal";
import { runSurpriseRouter } from "@/nous/surprise-router";
import { DEFAULT_NOUS_CONFIG } from "@/nous/types";
import { getConfig } from "@/shared/config";

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
			const config = getConfig();
			const handler = createPostToolUseHandler(db, config, repoHash);
			const result = await handler(event);
			process.stdout.write(JSON.stringify(result));

			// Nous cognitive monitoring — runs after the main PostToolUse work.
			// Any error here is logged and swallowed so the hook remains safe.
			try {
				const nousConfig = config.nous ?? DEFAULT_NOUS_CONFIG;
				if (nousConfig.enabled && event.session_id) {
					const responseText =
						typeof event.tool_response === "string"
							? event.tool_response
							: JSON.stringify(event.tool_response ?? "");

					runDiscomfortSignal(db, event.session_id, responseText, nousConfig);
					await runSurpriseRouter(db, event, nousConfig);
				}
			} catch (err) {
				process.stderr.write(`[Nous] PostToolUse error: ${err}\n`);
			}
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
