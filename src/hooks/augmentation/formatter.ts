// Module: formatter — Formats graph query results into compact context blocks

/** Maximum output length in characters (~500 tokens). */
const MAX_OUTPUT_CHARS = 2000;

/** Maximum entities to include in output. */
const MAX_ENTITIES = 3;

/** Maximum edges per entity. */
const MAX_EDGES_PER_ENTITY = 3;

/** An edge to display in the formatted output. */
export interface AugmentEdge {
	targetName: string;
	edgeType: string;
}

/** An entity with its edges and optional decision/convention annotation. */
export interface AugmentEntity {
	id: string;
	name: string;
	type: string;
	filePaths: string[];
	trustTier: number;
	edges: AugmentEdge[];
	decision?: { description: string; date: string };
}

/**
 * Format graph query results into a compact text block for context injection.
 *
 * Caps at 3 entities, 3 edges per entity, 1 decision/convention per entity.
 * Total output is capped at ~2000 chars. Empty results produce empty string.
 */
export function formatContext(pattern: string, entities: AugmentEntity[]): string {
	if (entities.length === 0) {
		return "";
	}

	const capped = entities.slice(0, MAX_ENTITIES);
	const header = `[SIA: ${pattern}] ${capped.length} related entities found:\n`;

	const lines: string[] = [header];

	for (const entity of capped) {
		const filePath = entity.filePaths[0] ?? "";
		const entityLine = `${entity.name} (${filePath}) -- ${entity.type}, trust:${entity.trustTier}`;
		lines.push(entityLine);

		// Edges (capped)
		if (entity.edges.length > 0) {
			const cappedEdges = entity.edges.slice(0, MAX_EDGES_PER_ENTITY);
			const edgeParts = cappedEdges.map((e) => `${e.targetName} (${e.edgeType})`);
			lines.push(`  Related: ${edgeParts.join(", ")}`);
		}

		// Decision/Convention annotation (at most 1)
		if (entity.decision) {
			lines.push(`  Decision: "${entity.decision.description}" (${entity.decision.date})`);
		}
	}

	const result = lines.join("\n");

	// Truncate to budget if needed
	if (result.length > MAX_OUTPUT_CHARS) {
		return `${result.slice(0, MAX_OUTPUT_CHARS - 3)}...`;
	}

	return result;
}
