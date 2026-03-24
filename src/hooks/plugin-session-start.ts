#!/usr/bin/env bun
// Plugin hook wrapper: SessionStart
//
// Injects recent decisions, conventions, and known bugs as context
// at the beginning of a Claude Code session.

import { resolveRepoHash } from "@/capture/hook";
import { openGraphDb } from "@/graph/semantic-db";
import { buildSessionContext, formatSessionContext } from "@/hooks/handlers/session-start";
import { parsePluginHookEvent, readStdin } from "@/hooks/plugin-common";
import type { HookEvent } from "@/hooks/types";

async function main() {
	try {
		const input = await readStdin();
		// SessionStart may be invoked without event data on initial install
		let event: HookEvent;
		if (input.trim()) {
			event = parsePluginHookEvent(input);
		} else {
			event = {
				session_id: "unknown",
				cwd: process.cwd(),
				transcript_path: "",
				hook_event_name: "SessionStart",
			};
		}

		const cwd = event.cwd || process.cwd();
		const repoHash = resolveRepoHash(cwd);
		const db = openGraphDb(repoHash);

		try {
			const isResume = event.source === "resume";
			const context = await buildSessionContext(db, cwd, isResume);
			const formatted = formatSessionContext(context);

			// SessionStart hooks output to stdout — Claude Code injects
			// the output as context into the conversation.
			process.stdout.write(formatted);
		} finally {
			await db.close();
		}
	} catch (err) {
		process.stderr.write(`sia SessionStart hook error: ${err}\n`);
		process.exit(0);
	}
}

main();
