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
			let formatted = formatSessionContext(context);

			// Load previous session subgraph if resuming
			if (isResume && event.session_id && event.session_id !== "unknown") {
				try {
					const { loadSubgraph } = await import("@/graph/session-resume");
					const resume = await loadSubgraph(db, event.session_id);
					if (resume) {
						const subgraph = JSON.parse(resume.subgraph_json);
						const entities = subgraph.entities as Array<{ name: string; summary: string; type: string }>;
						if (entities.length > 0) {
							formatted += "\n## Previous Session Context\n";
							formatted += "These entities were active in your previous session:\n\n";
							for (const entity of entities.slice(0, 10)) {
								formatted += `- **${entity.name}** (${entity.type}): ${entity.summary || "no summary"}\n`;
							}
						}
					}
				} catch (err) {
					process.stderr.write(`sia: session resume load failed (non-fatal): ${err}\n`);
				}
			}

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
