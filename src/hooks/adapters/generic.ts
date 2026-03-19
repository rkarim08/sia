// src/hooks/adapters/generic.ts — Fallback adapter for agents without hook systems

import type { CaptureMode } from "@/llm/provider-registry";

/**
 * For agents without hook systems (Windsurf, Aider, etc.), fall back to api
 * capture mode. In api mode, Sia periodically polls or processes transcripts
 * via direct LLM calls rather than relying on event hooks.
 */
export function getGenericCaptureMode(): CaptureMode {
	return "api";
}
