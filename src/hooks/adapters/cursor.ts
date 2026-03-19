// src/hooks/adapters/cursor.ts — Cursor hook adapter

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { HookEvent } from "@/hooks/types";

/** Cursor's native hook event shape */
interface CursorHookEvent {
	event: "afterFileEdit" | "afterModelResponse" | "beforeSubmitPrompt";
	filePath?: string;
	content?: string;
	response?: string;
}

/**
 * Map Cursor hook events to Sia's HookEvent format.
 *
 * Cursor event → Claude Code HookEvent mapping:
 *   afterFileEdit       → PostToolUse (tool_name: Write)
 *   afterModelResponse  → Stop
 *   beforeSubmitPrompt  → UserPromptSubmit
 */
export function normalizeCursorEvent(raw: CursorHookEvent): HookEvent {
	const base: Partial<HookEvent> = {
		session_id: "",
		transcript_path: "",
		cwd: "",
	};

	switch (raw.event) {
		case "afterFileEdit":
			return {
				...base,
				hook_event_name: "PostToolUse",
				tool_name: "Write",
				tool_input: raw.filePath
					? {
							file_path: raw.filePath,
							content: raw.content ?? "",
						}
					: undefined,
			} as HookEvent;

		case "afterModelResponse":
			return {
				...base,
				hook_event_name: "Stop",
				reason: "exit",
			} as HookEvent;

		case "beforeSubmitPrompt":
			return {
				...base,
				hook_event_name: "UserPromptSubmit",
			} as HookEvent;
	}
}

/**
 * Detect whether the current project is using Cursor.
 * Looks for the .cursor/ directory created by Cursor IDE.
 */
export function detectCursor(cwd: string): boolean {
	return existsSync(join(cwd, ".cursor"));
}
