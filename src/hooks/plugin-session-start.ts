#!/usr/bin/env bun
// Plugin hook wrapper: SessionStart
//
// Injects recent decisions, conventions, and known bugs as context
// at the beginning of a Claude Code session.

import { resolveRepoHash } from "@/capture/hook";
import { openGraphDb } from "@/graph/semantic-db";
import { buildSessionContext, formatSessionContext } from "@/hooks/handlers/session-start";
import { readStdin } from "@/hooks/plugin-common";

async function main() {
	try {
		const input = await readStdin();
		const event = input.trim() ? JSON.parse(input) : {};

		const cwd = (event.cwd as string) || process.cwd();
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
