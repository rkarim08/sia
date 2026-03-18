// src/capture/prompts/consolidate.ts — Two-phase consolidation prompt template

export function consolidatePrompt(
	candidate: { kind: string; name: string; content: string; summary: string },
	existingEntities: Array<{
		id: string;
		name: string;
		content: string;
		summary: string;
		type: string;
	}>,
): { system: string; user: string } {
	const system = `You are a knowledge graph consolidation engine. A new candidate fact has been extracted. Compare it against the existing entities and choose exactly one operation:

- NOOP: candidate duplicates an existing entity (>80% content overlap)
- UPDATE: candidate adds new information to an existing entity (20–80% overlap). Specify which entity ID.
- INVALIDATE: candidate supersedes or contradicts an existing entity. Specify which entity ID.
- ADD: candidate is genuinely new knowledge (no significant overlap with any existing entity)

Return JSON: { "decision": "ADD"|"UPDATE"|"INVALIDATE"|"NOOP", "target_id": "<entity_id or null>", "reasoning": "<brief explanation>" }
target_id is required for UPDATE and INVALIDATE, null for ADD and NOOP.`;

	const user = `Candidate:\n${JSON.stringify(candidate, null, 2)}\n\nExisting entities:\n${JSON.stringify(existingEntities, null, 2)}`;
	return { system, user };
}
