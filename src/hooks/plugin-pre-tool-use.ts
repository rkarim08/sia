#!/usr/bin/env bun
// Plugin hook wrapper: PreToolUse — Nous Significance Detector
//
// Runs before any tool call. Updates the current session's
// currentCallSignificance so that PostToolUse modules (discomfort-signal,
// surprise-router) can weight their thresholds. Must never crash the CLI —
// on any error we exit 0 and silently drop the event.

import { resolveRepoHash } from "@/capture/hook";
import { openGraphDb } from "@/graph/semantic-db";
import { parsePluginHookEvent, readStdin } from "@/hooks/plugin-common";
import { runSignificanceDetector } from "@/nous/significance-detector";
import { DEFAULT_NOUS_CONFIG } from "@/nous/types";
import { getConfig } from "@/shared/config";

async function main() {
	try {
		const input = await readStdin();
		if (!input.trim()) process.exit(0);

		const event = parsePluginHookEvent(input);
		if (!event.session_id) process.exit(0);

		const cwd = event.cwd || process.cwd();
		const repoHash = resolveRepoHash(cwd);
		const db = openGraphDb(repoHash);

		try {
			const config = getConfig();
			const nousConfig = config.nous ?? DEFAULT_NOUS_CONFIG;
			if (nousConfig.enabled) {
				runSignificanceDetector(
					db,
					event.session_id,
					event.tool_name ?? "",
					(event.tool_input ?? {}) as Record<string, unknown>,
					nousConfig,
				);
			}
		} finally {
			await db.close();
		}
	} catch (err) {
		process.stderr.write(`sia Nous PreToolUse hook error: ${err}\n`);
		process.exit(0);
	}
}

main();
