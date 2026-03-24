#!/usr/bin/env bun
// Plugin hook wrapper: UserPromptSubmit
//
// Reads Claude Code UserPromptSubmit event from stdin, creates a
// UserPrompt node and optionally a UserDecision if the prompt
// contains correction/preference patterns.

import { resolveRepoHash } from "@/capture/hook";
import { openGraphDb } from "@/graph/semantic-db";
import { handleUserPromptSubmit } from "@/hooks/handlers/user-prompt-submit";
import { parsePluginHookEvent, readStdin } from "@/hooks/plugin-common";
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
			const prompt = (event.tool_input?.prompt as string) ?? "";
			const result = await handleUserPromptSubmit(db, {
				session_id: event.session_id,
				prompt,
			}, config);
			process.stdout.write(JSON.stringify(result));
		} finally {
			await db.close();
		}
	} catch (err) {
		process.stderr.write(`sia UserPromptSubmit hook error: ${err}\n`);
		process.exit(0);
	}
}

main();
