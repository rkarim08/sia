// src/capture/prompts/extract.ts — Track B LLM extraction prompt template
import { sanitizePromptInput } from "@/security/sanitize";

export interface EntityContext {
	name: string;
	type: string;
	summary: string;
}

export function extractPrompt(
	content: string,
	context?: EntityContext[],
): { system: string; user: string } {
	let contextBlock = "";
	if (context && context.length > 0) {
		const entries = context.map((e) => `- ${e.name} (${e.type}): ${e.summary}`).join("\n");
		contextBlock = `\nThe graph already contains these entities — avoid duplicates:\n${entries}\n`;
	}

	const system = `You are a knowledge extraction engine for a code knowledge graph.
Extract structured facts from the content provided by the user.
${contextBlock}
Return a JSON object with a "facts" array. Each fact must have:
- type: one of "Decision", "Convention", "Bug", "Solution", "Concept"
- name: concise name (3–200 characters)
- content: full description (10–2000 characters)
- summary: one sentence (max 20 words)
- tags: up to 5 relevant string tags
- file_paths: related file paths mentioned in context
- confidence: number 0.0–1.0 (how certain this fact is)
- proposed_relationships: optional array of { target_name: string, type: string, weight: number }

Rules:
- Only extract facts with confidence >= 0.6
- Do not extract raw code snippets as facts
- Decisions must include rationale
- Bugs must include symptoms or root cause
- Return { "facts": [] } if nothing worth extracting`;

	const user = `Content to analyze:\n\n${sanitizePromptInput(content)}`;
	return { system, user };
}
