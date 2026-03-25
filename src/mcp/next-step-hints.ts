// Module: next-step-hints — Suggest next MCP tool calls after each tool invocation

/**
 * Returns a contextual hint string suggesting the next MCP tool call
 * the agent should consider after using the given tool.
 */
export function getNextStepHint(toolName: string): string {
	const hints: Record<string, string> = {
		sia_search:
			"Next: Use sia_expand on a specific entity to see its connections, or sia_by_file to see all entities in a file.",
		sia_by_file: "Next: Use sia_expand on an entity to explore its relationships.",
		sia_expand:
			"Next: Use sia_impact to analyze blast radius, or sia_at_time for historical context.",
		sia_community: "Next: Use sia_search to find specific entities within a community.",
		sia_at_time: "Next: Compare with current state using sia_search to identify what changed.",
		sia_note: "Knowledge captured. Use sia_search to verify it's findable.",
		sia_impact: "Next: Use sia_detect_changes to see which files are affected.",
		sia_detect_changes: "Next: Use sia_impact on affected symbols to assess blast radius.",
	};
	return hints[toolName] ?? "";
}
