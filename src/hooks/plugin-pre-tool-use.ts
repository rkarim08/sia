#!/usr/bin/env bun
// Plugin hook wrapper: PreToolUse — Nous Significance Detector + Preference Guard
//
// Runs before any tool call. Two subscribers:
//  1. Significance detector — updates the current session's
//     currentCallSignificance so PostToolUse modules (discomfort-signal,
//     surprise-router) can weight their thresholds.
//  2. Preference guard — denies Bash|Write|Edit calls that conflict with an
//     active Tier-1 Preference. Only fires on confident prohibition matches.
//
// Must never crash the CLI — on any error we exit 0 and silently drop the
// event.

import { resolveRepoHash } from "@/capture/hook";
import { openGraphDb } from "@/graph/semantic-db";
import { runPreferenceGuard } from "@/hooks/handlers/preference-guard";
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

			// Preference guard — denies tool calls that conflict with an
			// active Tier-1 Preference. Non-null response short-circuits
			// the event and is emitted to Claude Code as a deny.
			const guardResponse = await runPreferenceGuard(db, event);
			if (guardResponse) {
				process.stdout.write(JSON.stringify(guardResponse));
				return;
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
