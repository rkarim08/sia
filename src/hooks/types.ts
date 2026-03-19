// src/hooks/types.ts — Shared types for the hook system

/** JSON envelope received from Claude Code hook events */
export interface HookEvent {
	session_id: string;
	transcript_path: string;
	cwd: string;
	hook_event_name: string;
	permission_mode?: string;

	// Tool-specific (PostToolUse, PreToolUse)
	tool_name?: string;
	tool_input?: Record<string, unknown>;
	tool_response?: unknown;
	tool_use_id?: string;

	// Compaction-specific
	trigger?: "auto" | "manual";
	compact_summary?: string;
	custom_instructions?: string;

	// Session-specific
	source?: "startup" | "resume" | "clear";
	reason?: "exit" | "sigint" | "error";
}

/** Standard response from a hook handler */
export interface HookResponse {
	status:
		| "processed"
		| "skipped"
		| "error"
		| "already_captured"
		| "needs_semantic_analysis"
		| "no_new_knowledge";
	nodes_created?: number;
	edges_created?: number;
	error?: string;
	[key: string]: unknown;
}

/** Handler function signature */
export type HookHandler = (event: HookEvent) => Promise<HookResponse>;
