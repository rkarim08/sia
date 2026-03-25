// Module: leiden — community detection via a simplified Louvain/Leiden pass

import { randomUUID } from "node:crypto";
import type { SiaDb } from "@/graph/db-interface";

export interface LeidenOpts {
	/** Custom resolution parameters per level (fine → coarse). Defaults: [2.0, 1.0, 0.5]. */
	resolutions?: number[];
}

export interface CommunityResult {
	/** Community counts per level (index = level). */
	levels: number[];
	/** Total communities created across all levels. */
	totalCommunities: number;
	/** Wall-clock duration for the run. */
	durationMs: number;
}

interface EntityRow {
	id: string;
	package_path: string | null;
	importance: number;
}

interface EdgeRow {
	fromId: string;
	toId: string;
	type: string;
	weight: number;
}

interface Unit {
	id: string;
	members: Set<string>;
}

interface DetectedCommunity {
	id: string;
	level: number;
	members: Set<string>;
	parentId: string | null;
	packagePath: string | null;
}

const DEFAULT_RESOLUTIONS = [2.0, 1.0, 0.5];

const EDGE_TYPE_WEIGHTS: Record<string, number> = {
	calls: 0.5,
	imports: 0.5,
	inherits_from: 0.5,
	contains: 0.5,
	depends_on: 0.5,
	co_occurrence: 0.3,
	cochange: 0.2,
	"git-cochange": 0.2,
};

function weightForEdge(type: string | null, base: number): number {
	// Specification notes equal weights for now, but keep the map for future tuning.
	const typeWeight = type ? (EDGE_TYPE_WEIGHTS[type] ?? 0.3) : 0.3;
	return base * typeWeight;
}

function dedupeEdges(
	edges: EdgeRow[],
	validNodes: Set<string>,
): Array<{ a: string; b: string; w: number }> {
	const map = new Map<string, number>();
	for (const edge of edges) {
		if (!validNodes.has(edge.fromId) || !validNodes.has(edge.toId)) continue;
		const keyParts = [edge.fromId, edge.toId].sort();
		const key = `${keyParts[0]}::${keyParts[1]}`;
		const baseWeight = typeof edge.weight === "number" ? edge.weight : 1;
		const w = weightForEdge(edge.type, baseWeight);
		map.set(key, (map.get(key) ?? 0) + w);
	}
	const result: Array<{ a: string; b: string; w: number }> = [];
	for (const [key, w] of map) {
		const [a, b] = key.split("::");
		result.push({ a, b, w });
	}
	return result;
}

function buildUnitAdjacency(
	edges: Array<{ a: string; b: string; w: number }>,
	entityToUnit: Map<string, string>,
): Map<string, Map<string, number>> {
	const adj = new Map<string, Map<string, number>>();
	const ensure = (id: string): Map<string, number> => {
		let entry = adj.get(id);
		if (!entry) {
			entry = new Map();
			adj.set(id, entry);
		}
		return entry;
	};

	for (const { a, b, w } of edges) {
		const ua = entityToUnit.get(a);
		const ub = entityToUnit.get(b);
		if (!ua || !ub) continue;

		if (ua === ub) {
			const selfAdj = ensure(ua);
			selfAdj.set(ua, (selfAdj.get(ua) ?? 0) + w);
			continue;
		}

		const adjA = ensure(ua);
		adjA.set(ub, (adjA.get(ub) ?? 0) + w);

		const adjB = ensure(ub);
		adjB.set(ua, (adjB.get(ua) ?? 0) + w);
	}

	return adj;
}

function louvain(
	units: Unit[],
	adjacency: Map<string, Map<string, number>>,
	resolution: number,
	maxIterations = 100,
): Map<string, string> {
	const community = new Map<string, string>();
	const sumTot = new Map<string, number>();
	const degrees = new Map<string, number>();

	for (const unit of units) {
		community.set(unit.id, unit.id);
		const deg = Array.from(adjacency.get(unit.id)?.values() ?? []).reduce((a, b) => a + b, 0);
		degrees.set(unit.id, deg);
		sumTot.set(unit.id, deg);
	}

	const m2 = Array.from(degrees.values()).reduce((a, b) => a + b, 0) || 1; // 2 * total edge weight

	let iterations = 0;
	let moved = true;
	while (moved && iterations < maxIterations) {
		iterations++;
		moved = false;
		for (const unit of units) {
			const node = unit.id;
			const nodeComm = community.get(node) ?? node;
			const nodeDegree = degrees.get(node) ?? 0;

			// Temporarily remove node from its community
			sumTot.set(nodeComm, (sumTot.get(nodeComm) ?? 0) - nodeDegree);

			const neighborWeights = adjacency.get(node) ?? new Map<string, number>();
			const communityWeights = new Map<string, number>();
			for (const [neighbor, weight] of neighborWeights) {
				const comm = community.get(neighbor);
				if (!comm) continue;
				communityWeights.set(comm, (communityWeights.get(comm) ?? 0) + weight);
			}

			let bestComm = nodeComm;
			let bestGain = 0;
			for (const [comm, kin] of communityWeights) {
				const tot = sumTot.get(comm) ?? 0;
				const gain = kin - (resolution * nodeDegree * tot) / m2;
				if (gain > bestGain + 1e-9) {
					bestGain = gain;
					bestComm = comm;
				}
			}

			sumTot.set(bestComm, (sumTot.get(bestComm) ?? 0) + nodeDegree);
			community.set(node, bestComm);
			if (bestComm !== nodeComm) {
				moved = true;
			}
		}
	}

	// Normalize community identifiers to stable compact ids
	const normalized = new Map<string, string>();
	let idx = 0;
	for (const comm of new Set(community.values())) {
		normalized.set(comm, `c${idx++}`);
	}

	const assignment = new Map<string, string>();
	for (const [node, comm] of community) {
		assignment.set(node, normalized.get(comm) ?? comm);
	}
	return assignment;
}

function refinePartition(
	assignment: Map<string, string>,
	adjacency: Map<string, Map<string, number>>,
): Map<string, string> {
	// Group nodes by community
	const communities = new Map<string, string[]>();
	for (const [node, comm] of assignment) {
		let members = communities.get(comm);
		if (!members) {
			members = [];
			communities.set(comm, members);
		}
		members.push(node);
	}

	const refined = new Map<string, string>();
	for (const [comm, members] of communities) {
		if (members.length <= 1) {
			for (const m of members) refined.set(m, comm);
			continue;
		}

		// BFS to find connected components within this community
		const memberSet = new Set(members);
		const visited = new Set<string>();
		let componentIdx = 0;

		for (const start of members) {
			if (visited.has(start)) continue;
			const component: string[] = [];
			const queue = [start];
			visited.add(start);

			while (queue.length > 0) {
				const node = queue.shift();
				if (!node) break;
				component.push(node);
				const neighbors = adjacency.get(node);
				if (neighbors) {
					for (const [neighbor] of neighbors) {
						if (memberSet.has(neighbor) && !visited.has(neighbor)) {
							visited.add(neighbor);
							queue.push(neighbor);
						}
					}
				}
			}

			const compId = componentIdx === 0 ? comm : `${comm}_${componentIdx}`;
			for (const node of component) {
				refined.set(node, compId);
			}
			componentIdx++;
		}
	}

	return refined;
}

function determinePackagePath(
	members: Set<string>,
	entityPackages: Map<string, string | null>,
): string | null {
	let current: string | null | undefined;
	for (const id of members) {
		const pkg = entityPackages.get(id) ?? null;
		if (pkg === null) return null;
		if (current === undefined) {
			current = pkg;
		} else if (current !== pkg) {
			return null;
		}
	}
	return current ?? null;
}

/**
 * Compute cohesion for a community: ratio of internal edges to total edges
 * touching any member of the community.
 */
export function computeCohesion(
	members: string[],
	edges: Array<{ from_id: string; to_id: string }>,
): number {
	const memberSet = new Set(members);
	let internal = 0;
	let total = 0;
	for (const edge of edges) {
		if (memberSet.has(edge.from_id) || memberSet.has(edge.to_id)) {
			total++;
			if (memberSet.has(edge.from_id) && memberSet.has(edge.to_id)) {
				internal++;
			}
		}
	}
	return total > 0 ? internal / total : 0;
}

function assignParents(levels: DetectedCommunity[][]): void {
	for (let i = 0; i < levels.length - 1; i++) {
		const parents = levels[i + 1];

		// Build a map: member → parent community ID for O(1) lookup
		const memberToParent = new Map<string, string>();
		for (const parent of parents) {
			for (const member of parent.members) {
				memberToParent.set(member, parent.id);
			}
		}

		// Assign parent by checking first member (all members should share the same parent)
		for (const community of levels[i]) {
			const firstMember = community.members.values().next().value;
			if (firstMember !== undefined) {
				const parentId = memberToParent.get(firstMember);
				community.parentId = parentId ?? null;
			} else {
				community.parentId = null;
			}
		}
	}
}

export async function detectCommunities(
	db: SiaDb,
	opts: LeidenOpts = {},
): Promise<CommunityResult> {
	const start = Date.now();
	const resolutions = opts.resolutions ?? DEFAULT_RESOLUTIONS;

	const entityResult = await db.execute(
		`SELECT id, package_path, importance
                 FROM graph_nodes
                 WHERE t_valid_until IS NULL AND archived_at IS NULL`,
	);
	const entities = entityResult.rows as unknown as EntityRow[];
	if (entities.length === 0) {
		return { levels: resolutions.map(() => 0), totalCommunities: 0, durationMs: 0 };
	}

	const entityPackages = new Map<string, string | null>();
	for (const entity of entities) {
		entityPackages.set(entity.id, entity.package_path);
	}
	const validIds = new Set(entities.map((e) => e.id));

	const edgeResult = await db.execute(
		`SELECT from_id as fromId, to_id as toId, type, weight
                 FROM graph_edges
                 WHERE t_valid_until IS NULL`,
	);
	const edges = edgeResult.rows as unknown as EdgeRow[];
	const undirectedEdges = dedupeEdges(edges, validIds);

	let units: Unit[] = entities.map((e) => ({ id: e.id, members: new Set([e.id]) }));
	const levelCommunities: DetectedCommunity[][] = [];

	for (let level = 0; level < resolutions.length; level++) {
		// Per-package Level 0: group entities by package_path, run separate louvain+refine per package
		if (level === 0 && entityPackages.size > 0) {
			const byPackage = new Map<string, Unit[]>();
			for (const unit of units) {
				const pkg = entityPackages.get([...unit.members][0]) ?? "__root__";
				let pkgList = byPackage.get(pkg);
				if (!pkgList) {
					pkgList = [];
					byPackage.set(pkg, pkgList);
				}
				pkgList.push(unit);
			}

			const allDetected: DetectedCommunity[] = [];
			for (const [pkg, pkgUnits] of byPackage) {
				const pkgEntityToUnit = new Map<string, string>();
				for (const unit of pkgUnits) {
					for (const member of unit.members) {
						pkgEntityToUnit.set(member, unit.id);
					}
				}

				const pkgAdj = buildUnitAdjacency(undirectedEdges, pkgEntityToUnit);
				const pkgAssignment = louvain(pkgUnits, pkgAdj, resolutions[level]);
				const pkgRefined = refinePartition(pkgAssignment, pkgAdj);

				const communityMembers = new Map<string, Set<string>>();
				for (const unit of pkgUnits) {
					const commKey = pkgRefined.get(unit.id) ?? unit.id;
					if (!communityMembers.has(commKey)) communityMembers.set(commKey, new Set());
					for (const member of unit.members) {
						communityMembers.get(commKey)?.add(member);
					}
				}

				for (const [_key, members] of communityMembers) {
					const id = randomUUID();
					allDetected.push({
						id,
						level: 0,
						members,
						parentId: null,
						packagePath: pkg === "__root__" ? null : pkg,
					});
				}
			}

			levelCommunities.push(allDetected);
			units = allDetected.map((c) => ({ id: c.id, members: c.members }));
			continue;
		}

		const entityToUnit = new Map<string, string>();
		for (const unit of units) {
			for (const member of unit.members) {
				entityToUnit.set(member, unit.id);
			}
		}

		const unitAdj = buildUnitAdjacency(undirectedEdges, entityToUnit);
		const assignment = louvain(units, unitAdj, resolutions[level]);
		const refinedAssignment = refinePartition(assignment, unitAdj);

		const communityMembers = new Map<string, Set<string>>();
		const communityUnits = new Map<string, Unit[]>();
		for (const unit of units) {
			const commKey = refinedAssignment.get(unit.id) ?? unit.id;
			if (!communityMembers.has(commKey)) {
				communityMembers.set(commKey, new Set());
				communityUnits.set(commKey, []);
			}
			for (const member of unit.members) {
				communityMembers.get(commKey)?.add(member);
			}
			communityUnits.get(commKey)?.push(unit);
		}

		const detected: DetectedCommunity[] = [];
		for (const [_key, members] of communityMembers) {
			const id = randomUUID();
			const pkg = determinePackagePath(members, entityPackages);
			detected.push({
				id,
				level,
				members,
				parentId: null,
				packagePath: level === 0 ? pkg : null,
			});
		}

		levelCommunities.push(detected);

		// Prepare units for next level
		units = detected.map((c) => ({ id: c.id, members: c.members }));
	}

	assignParents(levelCommunities);

	// Compute cohesion scores for all communities
	const rawEdges = edges.map((e) => ({ from_id: e.fromId, to_id: e.toId }));
	const cohesionScores = new Map<string, number>();
	for (const level of levelCommunities) {
		for (const community of level) {
			const members = [...community.members];
			cohesionScores.set(community.id, computeCohesion(members, rawEdges));
		}
	}

	// Persist communities and memberships
	await db.transaction(async (tx) => {
		await tx.execute("DELETE FROM community_members");
		await tx.execute("DELETE FROM communities");

		const now = Date.now();
		const levelsDescending = [...levelCommunities].reverse();
		for (const level of levelsDescending) {
			for (const community of level) {
				const memberCount = community.members.size;
				const cohesion = cohesionScores.get(community.id) ?? null;
				await tx.execute(
					`INSERT INTO communities (
                                                id, level, parent_id, summary, summary_hash,
                                                member_count, last_summary_member_count,
                                                package_path, cohesion, created_at, updated_at
                                        ) VALUES (?, ?, ?, NULL, NULL, ?, 0, ?, ?, ?, ?)`,
					[
						community.id,
						community.level,
						community.parentId,
						memberCount,
						community.packagePath,
						cohesion,
						now,
						now,
					],
				);

				for (const member of community.members) {
					await tx.execute(
						`INSERT INTO community_members (community_id, entity_id, level)
                                                 VALUES (?, ?, ?)`,
						[community.id, member, community.level],
					);
				}
			}
		}
	});

	const levels = levelCommunities.map((c) => c.length);
	return {
		levels,
		totalCommunities: levels.reduce((a, b) => a + b, 0),
		durationMs: Date.now() - start,
	};
}
