/**
 * Prompt templates for fact validation (always-active LLM role).
 */

/**
 * Build a system + user prompt pair for validating whether a stored fact
 * is still correct given current code context.
 */
export function factValidationPrompt(
	factContent: string,
	codeContext: string,
): { system: string; user: string } {
	const system = [
		"You are Sia, a knowledge-graph memory system for software projects.",
		"Your task is to validate whether a previously stored fact is still accurate",
		"given the current state of the codebase.",
		"",
		"Guidelines:",
		"- Compare the fact against the provided code context.",
		"- If the code confirms the fact, respond with action: 'confirm'.",
		"- If the code contradicts the fact, respond with action: 'invalidate'.",
		"- If you are unsure, respond with action: 'flag_for_review'.",
		"- Output valid JSON matching: { is_valid: boolean, confidence: number, reasoning: string, action: 'confirm' | 'invalidate' | 'flag_for_review' }",
	].join("\n");

	const user = [
		"## Stored Fact",
		factContent,
		"",
		"## Current Code Context",
		codeContext,
		"",
		"Is this fact still valid? Return JSON with: is_valid, confidence (0-1), reasoning, action.",
	].join("\n");

	return { system, user };
}
