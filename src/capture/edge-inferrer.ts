// Module: edge-inferrer — Infer edges between new and existing entities

import type { SiaDb } from "@/graph/db-interface";
import { insertEdge } from "@/graph/edges";
import { getActiveEntities, getEntity } from "@/graph/entities";

/** Maximum edges created per new entity. */
const MAX_EDGES_PER_ENTITY = 5;

/** Minimum weight threshold for creating an edge. */
const MIN_WEIGHT = 0.3;

/** Type affinity pairs: source type -> target type -> edge label. */
const TYPE_AFFINITY: Record<string, { target: string; label: string }> = {
	Solution: { target: "Bug", label: "solves" },
	Bug: { target: "Solution", label: "solved_by" },
};

/**
 * Compute tag overlap weight between two tag sets.
 * Returns |intersection| / |union| (Jaccard similarity on tags).
 */
function tagOverlap(tagsA: string[], tagsB: string[]): number {
	const setA = new Set(tagsA);
	const setB = new Set(tagsB);

	if (setA.size === 0 || setB.size === 0) return 0;

	let intersectionSize = 0;
	for (const tag of setA) {
		if (setB.has(tag)) intersectionSize++;
	}

	const unionSize = setA.size + setB.size - intersectionSize;
	if (unionSize === 0) return 0;

	return intersectionSize / unionSize;
}

/**
 * Safely parse a JSON tags string into a string array.
 * Returns empty array on parse failure.
 */
function parseTags(raw: string): string[] {
	try {
		const parsed = JSON.parse(raw);
		if (Array.isArray(parsed)) return parsed;
		return [];
	} catch {
		return [];
	}
}

interface EdgeCandidate {
	targetId: string;
	edgeType: string;
	weight: number;
}

/**
 * Infer edges between newly created entities and existing entities in the graph.
 *
 * For each new entity ID:
 * 1. Get the entity via getEntity.
 * 2. If entity has no tags and type is not 'Solution' or 'Bug', skip.
 * 3. Query for related entities by same package_path, matching tags, or type affinity.
 * 4. For type affinity: Solution entities look for Bug entities with overlapping tags -> 'solves' edge.
 * 5. Create edges via insertEdge for matches with weight >= 0.3.
 * 6. Cap at 5 edges per new entity.
 *
 * Returns total edges created.
 */
export async function inferEdges(db: SiaDb, newEntityIds: string[]): Promise<number> {
	let totalCreated = 0;

	for (const entityId of newEntityIds) {
		const entity = await getEntity(db, entityId);
		if (!entity) continue;

		const tags = parseTags(entity.tags);
		const hasTypeAffinity = entity.type in TYPE_AFFINITY;

		// Skip entities with no tags and no type affinity
		if (tags.length === 0 && !hasTypeAffinity) continue;

		// Gather all active entities to find candidates
		const allActive = await getActiveEntities(db);

		const candidates: EdgeCandidate[] = [];

		for (const other of allActive) {
			// Skip self-edges
			if (other.id === entityId) continue;

			let bestWeight = 0;
			let bestEdgeType = "relates_to";

			// 1. Same package_path
			if (entity.package_path && other.package_path && entity.package_path === other.package_path) {
				const otherTags = parseTags(other.tags);
				const overlap = tagOverlap(tags, otherTags);
				// Package path match gives a base weight of 0.3, boosted by tag overlap
				const w = 0.3 + overlap * 0.4;
				if (w > bestWeight) {
					bestWeight = w;
					bestEdgeType = "relates_to";
				}
			}

			// 2. Tag overlap (regardless of package path)
			if (tags.length > 0) {
				const otherTags = parseTags(other.tags);
				const overlap = tagOverlap(tags, otherTags);
				if (overlap > bestWeight) {
					bestWeight = overlap;
					bestEdgeType = "relates_to";
				}
			}

			// 3. Type affinity (Solution<->Bug)
			if (hasTypeAffinity) {
				const affinity = TYPE_AFFINITY[entity.type];
				if (other.type === affinity.target) {
					const otherTags = parseTags(other.tags);
					const overlap = tagOverlap(tags, otherTags);
					// Type affinity gives a base boost of 0.35 + tag overlap contribution
					const w = 0.35 + overlap * 0.55;
					if (w > bestWeight) {
						bestWeight = w;
						bestEdgeType = affinity.label;
					}
				}
			}

			if (bestWeight >= MIN_WEIGHT) {
				candidates.push({
					targetId: other.id,
					edgeType: bestEdgeType,
					weight: bestWeight,
				});
			}
		}

		// Sort by weight descending and cap at MAX_EDGES_PER_ENTITY
		candidates.sort((a, b) => b.weight - a.weight);
		const toCreate = candidates.slice(0, MAX_EDGES_PER_ENTITY);

		for (const candidate of toCreate) {
			await insertEdge(db, {
				from_id: entityId,
				to_id: candidate.targetId,
				type: candidate.edgeType,
				weight: candidate.weight,
				extraction_method: "edge-inferrer",
			});
			totalCreated++;
		}
	}

	return totalCreated;
}
