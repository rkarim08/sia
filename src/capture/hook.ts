// Module: hook — Hook entry point for capturing Claude Code events

import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import type { HookPayload } from "@/capture/types";
import { resolveWorktreeRoot } from "@/shared/git-utils";

export type { HookPayload };

/**
 * Parse raw stdin JSON into a validated HookPayload.
 * Throws on invalid JSON or missing required fields.
 */
export function parseHookPayload(stdin: string): HookPayload {
	let parsed: unknown;
	try {
		parsed = JSON.parse(stdin);
	} catch {
		throw new Error("Invalid JSON in hook payload");
	}

	if (typeof parsed !== "object" || parsed === null) {
		throw new Error("Hook payload must be a JSON object");
	}

	const obj = parsed as Record<string, unknown>;

	if (typeof obj.cwd !== "string" || obj.cwd.length === 0) {
		throw new Error("Hook payload missing required field: cwd");
	}
	if (obj.type !== "PostToolUse" && obj.type !== "Stop") {
		throw new Error("Hook payload field 'type' must be 'PostToolUse' or 'Stop'");
	}
	if (typeof obj.sessionId !== "string" || obj.sessionId.length === 0) {
		throw new Error("Hook payload missing required field: sessionId");
	}
	if (typeof obj.content !== "string") {
		throw new Error("Hook payload missing required field: content");
	}

	return {
		cwd: obj.cwd as string,
		type: obj.type as "PostToolUse" | "Stop",
		sessionId: obj.sessionId as string,
		content: obj.content as string,
		toolName: typeof obj.toolName === "string" ? obj.toolName : undefined,
		filePath: typeof obj.filePath === "string" ? obj.filePath : undefined,
	};
}

/**
 * Derive a stable repo identifier from a working directory path.
 * Uses the git worktree root so that all paths within the same repo
 * (including subdirectories) resolve to the same hash.
 * Falls back to realpathSync for non-git directories.
 */
export function resolveRepoHash(cwd: string): string {
	const root = resolveWorktreeRoot(cwd) ?? realpathSync(cwd);
	return createHash("sha256").update(root).digest("hex");
}
