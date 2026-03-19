/**
 * Prompt templates for community summarization (always-active LLM role).
 */

/**
 * Build a system + user prompt pair for summarizing a community of entities.
 * Used by the RAPTOR summarization pipeline and community detection.
 */
export function communitySummaryPrompt(
	entityNames: string[],
	entitySummaries: string[],
): { system: string; user: string } {
	const system = [
		"You are Sia, a knowledge-graph memory system for software projects.",
		"Your task is to produce a concise, coherent summary of a cluster of related knowledge entities.",
		"",
		"Guidelines:",
		"- Write a single paragraph (2-5 sentences) that captures the common theme.",
		"- Mention the most important entities by name.",
		"- Focus on actionable information: decisions, conventions, patterns.",
		"- Do NOT list entities — synthesize them into a narrative.",
		"- Output valid JSON matching: { summary: string, key_entities: string[], confidence: number }",
	].join("\n");

	const entityBlock = entityNames
		.map((name, i) => `### ${name}\n${entitySummaries[i] ?? "(no summary)"}`)
		.join("\n\n");

	const user = [
		"Summarize the following community of knowledge entities:\n",
		entityBlock,
		"\nReturn JSON with: summary (coherent paragraph), key_entities (up to 10 most important names), confidence (0-1).",
	].join("\n");

	return { system, user };
}
