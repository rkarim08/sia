// Module: plugin-common — Shared utilities for plugin hook wrappers
//
// Claude Code hook events arrive as JSON on stdin. This module parses
// them into SIA's HookEvent type.

import type { HookEvent } from "./types";

/**
 * Parse a Claude Code hook event from a JSON string.
 * Validates required fields and returns a typed HookEvent.
 */
export function parsePluginHookEvent(input: string): HookEvent {
	let parsed: Record<string, unknown>;
	try {
		parsed = JSON.parse(input);
	} catch {
		throw new Error("Invalid JSON in hook event");
	}

	if (!parsed.session_id || typeof parsed.session_id !== "string") {
		throw new Error("Missing required field: session_id");
	}

	return {
		session_id: parsed.session_id as string,
		transcript_path: (parsed.transcript_path as string) ?? "",
		cwd: (parsed.cwd as string) ?? process.cwd(),
		hook_event_name: (parsed.hook_event_name as string) ?? "unknown",
		tool_name: parsed.tool_name as string | undefined,
		tool_input: parsed.tool_input as Record<string, unknown> | undefined,
		tool_response: parsed.tool_response,
		tool_use_id: parsed.tool_use_id as string | undefined,
		source: parsed.source as HookEvent["source"],
		reason: parsed.reason as HookEvent["reason"],
	};
}

/**
 * Read all of stdin as a string.
 */
export async function readStdin(): Promise<string> {
	const chunks: Buffer[] = [];
	for await (const chunk of process.stdin) {
		chunks.push(chunk as Buffer);
	}
	return Buffer.concat(chunks).toString("utf-8");
}
