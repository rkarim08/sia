// src/hooks/adapters/claude-code.ts — Native Claude Code adapter (identity mapping)

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { HookEvent } from "@/hooks/types";

/**
 * Claude Code adapter — identity mapping, no transformation needed.
 * Claude Code emits events that already match Sia's HookEvent format exactly.
 */
export function normalizeClaudeCodeEvent(raw: Record<string, unknown>): HookEvent {
	return raw as unknown as HookEvent;
}

/**
 * Detect whether the current project is using Claude Code.
 * Looks for the .claude/ directory created by `claude` CLI initialization.
 */
export function detectClaudeCode(cwd: string): boolean {
	return existsSync(join(cwd, ".claude"));
}
