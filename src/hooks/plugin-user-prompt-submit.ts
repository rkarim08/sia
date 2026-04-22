#!/usr/bin/env bun
// Plugin hook wrapper: UserPromptSubmit
//
// Reads Claude Code UserPromptSubmit event from stdin, creates a
// UserPrompt node (plus optional UserDecision), runs top-k memory
// retrieval + open-Concern topic match, and returns the combined
// markdown as `hookSpecificOutput.additionalContext` so Claude Code
// injects it into the conversation.

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

		let pendingBackgroundWork: Promise<void> = Promise.resolve();
		try {
			const config = getConfig();
			const prompt = (event.tool_input?.prompt as string) ?? "";
			const result = await handleUserPromptSubmit(
				db,
				{
					session_id: event.session_id,
					prompt,
				},
				config,
			);
			pendingBackgroundWork = result.pendingBackgroundWork;

			// Claude Code hooks may inject additional context via
			// `hookSpecificOutput.additionalContext`. Only emit the field
			// when retrieval produced content — the contract is to omit the
			// key entirely when there is nothing to inject.
			const response: Record<string, unknown> = {
				nodesCreated: result.nodesCreated,
				taskType: result.taskType,
			};
			if (result.additionalContext && result.additionalContext.length > 0) {
				response.hookSpecificOutput = {
					hookEventName: "UserPromptSubmit",
					additionalContext: result.additionalContext,
				};
			}
			process.stdout.write(JSON.stringify(response));
		} finally {
			// Ensure any in-flight retrieval work has settled before closing
			// the DB so we don't get "database closed" errors from orphaned
			// queries. `pendingBackgroundWork` always resolves (errors are
			// swallowed by the handler) so `await` here is safe. A secondary
			// 500 ms ceiling prevents a hung query from blocking process exit.
			await Promise.race([
				pendingBackgroundWork,
				new Promise<void>((resolve) => {
					const t = setTimeout(resolve, 500);
					if (typeof t === "object" && t && "unref" in t) {
						(t as NodeJS.Timeout).unref();
					}
				}),
			]);
			await db.close();
		}
	} catch (err) {
		process.stderr.write(`sia UserPromptSubmit hook error: ${err}\n`);
		process.exit(0);
	}
}

main();
