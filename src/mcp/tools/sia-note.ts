// Module: sia-note — Developer-authored knowledge entry via MCP

import type { SiaDb } from "@/graph/db-interface";
import type { Entity } from "@/graph/entities";
import { buildNextSteps, type NextStep } from "@/mcp/next-steps";
import { OntologyError } from "@/ontology/errors";
import {
	createBug,
	createConcept,
	createConvention,
	createDecision,
	createSolution,
} from "@/ontology/middleware";

export interface SiaNoteInput {
	kind: "Decision" | "Convention" | "Bug" | "Solution" | "Concept";
	name: string;
	content: string;
	tags?: string[];
	relates_to?: string[]; // entity IDs → pertains_to/caused_by edges
	supersedes?: string; // entity ID this replaces
}

export interface SiaNoteResult {
	node_id: string;
	kind: string;
	edges_created: number;
	next_steps?: NextStep[];
}

/**
 * Create a developer-authored knowledge entry in the graph.
 * Routes to the appropriate ontology middleware function based on kind.
 *
 * For Bug: first relates_to entry becomes the causedBy target (optional — cause may be unknown).
 * For Convention: all relates_to become pertainsTo targets (at least 1 required).
 * For Decision: relates_to become pertainsTo, supersedes if provided.
 * For Solution: first relates_to entry becomes the solves target, rest become pertainsTo.
 * For Concept: relates_to become pertainsTo.
 */
export async function handleSiaNote(db: SiaDb, input: SiaNoteInput): Promise<SiaNoteResult> {
	const relatesTo = input.relates_to ?? [];

	// Validate all referenced entity IDs exist before creating edges
	const idsToValidate = [...relatesTo];
	if (input.supersedes) idsToValidate.push(input.supersedes);

	if (idsToValidate.length > 0) {
		const placeholders = idsToValidate.map(() => "?").join(", ");
		const { rows } = await db.execute(
			`SELECT id FROM graph_nodes WHERE id IN (${placeholders}) AND t_valid_until IS NULL`,
			idsToValidate,
		);
		const foundIds = new Set(rows.map((r) => r.id as string));
		const missing = idsToValidate.filter((id) => !foundIds.has(id));
		if (missing.length > 0) {
			throw new Error(
				`sia_note failed: Referenced entities not found: ${missing.join(", ")}. Use sia_search to find valid entity IDs.`,
			);
		}
	}

	try {
		let entity: Entity;
		let edgesCreated: number;

		switch (input.kind) {
			case "Bug": {
				entity = await createBug(db, {
					name: input.name,
					content: input.content,
					causedBy: relatesTo[0], // undefined when no relates_to provided
					tags: input.tags,
				});
				edgesCreated = relatesTo.length > 0 ? 1 : 0;
				break;
			}

			case "Convention": {
				if (relatesTo.length === 0) {
					throw new OntologyError(
						"Convention requires at least one relates_to entry as a pertainsTo target",
					);
				}
				entity = await createConvention(db, {
					name: input.name,
					content: input.content,
					pertainsTo: relatesTo,
					tags: input.tags,
				});
				edgesCreated = relatesTo.length;
				break;
			}

			case "Decision": {
				entity = await createDecision(db, {
					name: input.name,
					content: input.content,
					pertainsTo: relatesTo.length > 0 ? relatesTo : undefined,
					supersedes: input.supersedes,
					tags: input.tags,
				});
				edgesCreated = relatesTo.length + (input.supersedes ? 1 : 0);
				break;
			}

			case "Solution": {
				if (relatesTo.length === 0) {
					throw new OntologyError(
						"Solution requires at least one relates_to entry as the solves target",
					);
				}
				const pertainsTo = relatesTo.length > 1 ? relatesTo.slice(1) : undefined;
				entity = await createSolution(db, {
					name: input.name,
					content: input.content,
					solves: relatesTo[0],
					pertainsTo,
					tags: input.tags,
				});
				// 1 solves edge + any remaining pertains_to edges
				edgesCreated = 1 + (pertainsTo?.length ?? 0);
				break;
			}

			case "Concept": {
				entity = await createConcept(db, {
					name: input.name,
					content: input.content,
					pertainsTo: relatesTo.length > 0 ? relatesTo : undefined,
					tags: input.tags,
				});
				edgesCreated = relatesTo.length;
				break;
			}
		}

		const nextSteps = buildNextSteps("sia_note", { kind: input.kind });
		const response: SiaNoteResult = {
			node_id: entity.id,
			kind: input.kind,
			edges_created: edgesCreated,
		};
		if (nextSteps.length > 0) response.next_steps = nextSteps;
		return response;
	} catch (err) {
		if (err instanceof OntologyError) {
			throw new Error(`sia_note failed: ${err.message}`);
		}
		throw err;
	}
}
