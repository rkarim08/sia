// src/hooks/adapters/cline.ts — Cline hook adapter

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { HookEvent } from "@/hooks/types";

/**
 * Tool name mapping from Cline's conventions to Claude Code conventions.
 * Cline uses snake_case tool names; Claude Code uses PascalCase.
 */
const CLINE_TOOL_NAME_MAP: Record<string, string> = {
	write_to_file: "Write",
	read_file: "Read",
	list_files: "LS",
	search_files: "Grep",
	execute_command: "Bash",
	browser_action: "WebFetch",
	ask_followup_question: "Ask",
	attempt_completion: "TodoWrite",
};

/**
 * Cline hooks are nearly identical to Claude Code — thin mapping.
 * The main difference is Cline uses snake_case tool names vs Claude Code's PascalCase.
 */
export function normalizeClineEvent(raw: Record<string, unknown>): HookEvent {
	const normalized = { ...raw } as Record<string, unknown>;

	// Normalize Cline snake_case tool names to Claude Code PascalCase
	if (typeof raw.tool_name === "string") {
		normalized.tool_name = CLINE_TOOL_NAME_MAP[raw.tool_name] ?? raw.tool_name;
	}

	return normalized as unknown as HookEvent;
}

/**
 * Detect whether the current project is using Cline.
 * Looks for the .clinerules/ directory used by Cline for custom instructions.
 */
export function detectCline(cwd: string): boolean {
	return existsSync(join(cwd, ".clinerules"));
}
