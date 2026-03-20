// Module: user-prompt-submit — UserPromptSubmit hook handler
//
// When a user submits a prompt:
// - Always creates a UserPrompt node in the graph.
// - If the prompt contains correction/preference patterns (e.g. "use X instead
//   of Y", "don't use Z", "always do X"), also creates a UserDecision node
//   with trust_tier 1.

import type { SiaDb } from "@/graph/db-interface";
import { insertEntity } from "@/graph/entities";
import type { SiaConfig } from "@/shared/config";

export interface UserPromptEvent {
	session_id: string;
	prompt: string;
}

const CORRECTION_PATTERNS = [
	/use\s+\S+\s+instead\s+of/i,
	/don't use/i,
	/do not use/i,
	/switch to/i,
	/prefer\s+\S+/i,
	/always\s+\S+/i,
	/never\s+\S+/i,
];

export async function handleUserPromptSubmit(
	db: SiaDb,
	event: UserPromptEvent,
	_config: SiaConfig,
): Promise<{ nodesCreated: number }> {
	if (!event.prompt?.trim()) return { nodesCreated: 0 };

	let nodesCreated = 0;

	// Always create a UserPrompt node
	await insertEntity(db, {
		type: "Concept",
		name: event.prompt.slice(0, 50),
		content: event.prompt,
		summary: event.prompt.slice(0, 80),
		tags: JSON.stringify(["user-prompt"]),
		kind: "UserPrompt",
		session_id: event.session_id,
	});
	nodesCreated++;

	// Check for correction/preference patterns → UserDecision
	for (const pattern of CORRECTION_PATTERNS) {
		if (pattern.test(event.prompt)) {
			await insertEntity(db, {
				type: "Decision",
				name: event.prompt.slice(0, 50),
				content: event.prompt,
				summary: event.prompt.slice(0, 80),
				tags: JSON.stringify(["user-preference"]),
				trust_tier: 1,
				kind: "UserDecision",
				session_id: event.session_id,
			});
			nodesCreated++;
			break; // Only one UserDecision per prompt
		}
	}

	return { nodesCreated };
}
