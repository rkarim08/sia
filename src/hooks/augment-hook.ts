#!/usr/bin/env bun
// Plugin hook wrapper: PreToolUse — Auto-augmentation
//
// Reads a Claude Code PreToolUse hook event from stdin, extracts the
// search pattern, queries the SIA graph, and injects compact context
// via additionalContext in the hook response.

import { extractPattern } from "@/hooks/augmentation/pattern-extractor";
import { augment } from "@/hooks/augmentation/engine";
import { resolveProjectGraphDir } from "@/shared/git-utils";
import { readStdin } from "@/hooks/plugin-common";

async function main() {
	try {
		const raw = await readStdin();
		if (!raw.trim()) {
			process.exit(0);
		}

		let input: Record<string, unknown>;
		try {
			input = JSON.parse(raw);
		} catch {
			process.exit(0);
		}

		const toolName = input.tool_name as string | undefined;
		const toolInput = input.tool_input as Record<string, unknown> | undefined;

		if (!toolName || !toolInput) {
			process.exit(0);
		}

		const pattern = extractPattern(toolName, toolInput);
		if (!pattern) {
			process.exit(0);
		}

		// Resolve the .sia-graph directory from cwd
		const cwd = (input.cwd as string) || process.cwd();
		const siaGraphDir = resolveProjectGraphDir(cwd);
		if (!siaGraphDir) {
			process.exit(0);
		}

		const context = await augment(pattern, siaGraphDir);
		if (!context) {
			process.exit(0);
		}

		const response = {
			hookSpecificOutput: {
				hookEventName: "PreToolUse",
				additionalContext: context,
			},
		};
		process.stdout.write(JSON.stringify(response));
	} catch (err) {
		// Hooks must not crash Claude Code — fail silently
		process.stderr.write(`sia augment-hook error: ${err}\n`);
		process.exit(0);
	}
}

main();
