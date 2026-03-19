// src/hooks/agent-detect.ts — Auto-detection of AI coding agents

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { CaptureMode } from "@/llm/provider-registry";

/** Known AI coding agents that Sia can integrate with */
export type DetectedAgent = "claude-code" | "cursor" | "cline" | "generic";

/**
 * Detect which AI agent is active based on directory markers.
 * Used by `npx sia install` to configure appropriate hooks.
 *
 * Detection order (precedence):
 *   1. .claude/        → claude-code
 *   2. .cursor/        → cursor
 *   3. .clinerules/    → cline
 *   4. (none found)    → generic
 */
export function detectAgent(cwd: string): DetectedAgent {
	if (existsSync(join(cwd, ".claude"))) return "claude-code";
	if (existsSync(join(cwd, ".cursor"))) return "cursor";
	if (existsSync(join(cwd, ".clinerules"))) return "cline";
	return "generic";
}

/**
 * Get the recommended capture mode for the detected agent.
 * Agents with hook systems use "hooks" mode; those without use "api" mode.
 */
export function getRecommendedCaptureMode(agent: DetectedAgent): CaptureMode {
	if (agent === "generic") return "api";
	return "hooks";
}
