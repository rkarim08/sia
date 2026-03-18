// src/capture/prompts/extract-flagged.ts — Augmented extraction for developer-flagged content
import { sanitizeFlagReason, sanitizePromptInput } from "@/security/sanitize";

export function extractFlaggedPrompt(
	flag: { reason: string; session_id: string },
	transcriptChunk: string,
): { system: string; user: string } {
	const system = `You are a knowledge extraction engine for a code knowledge graph.
The developer has explicitly flagged the following content as significant.
Apply a lower confidence threshold (0.4) and pay special attention to the flagged reason.

Extract structured facts with confidence >= 0.4 (lower than the normal 0.6 threshold).
Return a JSON object with a "facts" array. Each fact must have:
- type: one of "Decision", "Convention", "Bug", "Solution", "Concept"
- name: concise name (3–200 characters)
- content: full description (10–2000 characters)
- summary: one sentence (max 20 words)
- tags: up to 5 relevant string tags
- file_paths: related file paths mentioned in context
- confidence: number 0.0–1.0
- proposed_relationships: optional array of { target_name, type, weight }

Return { "facts": [] } if nothing worth extracting.`;

	const sanitizedReason = sanitizeFlagReason(flag.reason);
	const sanitizedContent = sanitizePromptInput(transcriptChunk);

	const user = `*** DEVELOPER FLAG ***
Reason: ${sanitizedReason}
*** END FLAG ***

Content to analyze:
${sanitizedContent}`;

	return { system, user };
}
