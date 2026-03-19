// src/llm/prompts/extraction.ts — Batch extraction prompt for api/hybrid capture mode

/**
 * Extraction prompt for api/hybrid capture mode.
 * Used when hooks are unavailable (non-Claude-Code agents, CLI batch operations).
 *
 * Uses XML-delimited sections for cross-provider compatibility.
 * Works across Claude, GPT, Gemini, and Ollama without modification.
 */
export function batchExtractionPrompt(
	transcriptChunk: string,
	context?: Array<{ name: string; type: string }>,
): { system: string; user: string } {
	const system = [
		"<instructions>",
		"Extract structured knowledge facts from the following development session transcript.",
		"",
		"For each fact, identify:",
		"- Entity: the named concept, file, function, decision, or convention",
		"- Type: Technology | File | Function | Decision | Convention | Bug | Pattern | Other",
		"- Summary: a concise description of what is known about this entity",
		"- Relationships: connections to other entities (optional)",
		"",
		"Guidelines:",
		"- Extract only factual, reusable knowledge — skip transient reasoning steps.",
		"- Focus on architectural decisions, naming conventions, API contracts, and technical patterns.",
		"- Prefer specificity: 'uses bun:sqlite via SiaDb adapter' over 'uses a database'.",
		"- Output valid JSON: { entities: Array<{ name: string, type: string, summary: string, related?: string[] }> }",
		"</instructions>",
	].join("\n");

	const contextBlock = buildContextBlock(context);
	const user = [
		contextBlock,
		"<transcript>",
		transcriptChunk,
		"</transcript>",
		"",
		"Extract all knowledge entities from the transcript above. Return JSON with an `entities` array.",
	]
		.filter(Boolean)
		.join("\n");

	return { system, user };
}

/** Build the context block if prior entities are provided. */
function buildContextBlock(context?: Array<{ name: string; type: string }>): string {
	if (!context || context.length === 0) return "";

	const lines = context.map((e) => `- ${e.name} (${e.type})`).join("\n");
	return ["<context>", "Known entities (avoid duplicating these):", lines, "</context>", ""].join(
		"\n",
	);
}
