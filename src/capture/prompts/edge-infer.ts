// src/capture/prompts/edge-infer.ts — Edge inference prompt template

export function edgeInferPrompt(
	source: { id: string; kind: string; name: string; content: string },
	candidates: Array<{ id: string; kind: string; name: string; summary: string }>,
): { system: string; user: string } {
	const system = `You are a relationship inference engine for a code knowledge graph. Given a newly created entity and candidate related entities, propose edges (relationships) between them.

Valid edge types by source→target kind:
- Decision/Convention/Concept → CodeEntity/FileNode: pertains_to
- Bug → CodeEntity/FileNode: caused_by
- Solution → Bug: solves
- Solution → CodeEntity/FileNode: pertains_to
- Concept → Decision: elaborates
- Same kind → same kind: supersedes (if new replaces old)
- Same kind → same kind: contradicts (if they conflict)
- Any → Any: relates_to (general relationship)

Return JSON: { "edges": [{ "target_id": "<id>", "type": "<edge_type>", "weight": 0.0-1.0, "confidence": 0.0-1.0 }] }

Rules:
- Max 5 edges per entity
- Discard edges with weight < 0.3
- Only propose edges with valid source→target kind combinations
- Return { "edges": [] } if no meaningful relationships found`;

	const user = `New entity:\n${JSON.stringify(source, null, 2)}\n\nCandidate targets:\n${JSON.stringify(candidates, null, 2)}`;
	return { system, user };
}
