// Module: sia-impact — Blast radius analysis via BFS from a given entity

import type { SiaDb } from "@/graph/db-interface";

export interface SiaImpactInput {
	entity_id: string;
	max_depth?: number;
	edge_types?: string[];
	min_confidence?: number;
}

export interface ImpactEntity {
	id: string;
	name: string;
	type: string;
	file_paths: string;
}

export interface ImpactLayer {
	depth: number;
	label: string;
	entities: ImpactEntity[];
}

export interface AffectedProcess {
	name: string;
	step_count: number;
}

export interface SiaImpactResult {
	entity: { id: string; name: string; type: string };
	impact: ImpactLayer[];
	processes_affected: AffectedProcess[];
}

const DEPTH_LABELS: Record<number, string> = {
	1: "WILL BREAK",
	2: "LIKELY AFFECTED",
	3: "MAY NEED TESTING",
};

function labelForDepth(depth: number): string {
	return DEPTH_LABELS[depth] ?? "MAY NEED TESTING";
}

export async function handleSiaImpact(
	db: SiaDb,
	input: SiaImpactInput,
): Promise<SiaImpactResult> {
	const maxDepth = input.max_depth ?? 3;
	const minConfidence = input.min_confidence ?? 0.5;

	// Fetch the root entity
	const rootResult = await db.execute(
		"SELECT id, name, type FROM graph_nodes WHERE id = ?",
		[input.entity_id],
	);
	if (rootResult.rows.length === 0) {
		return {
			entity: { id: input.entity_id, name: "Unknown", type: "Unknown" },
			impact: [],
			processes_affected: [],
		};
	}
	const rootRow = rootResult.rows[0] as { id: string; name: string; type: string };

	// Build adjacency from all active edges (both directions)
	let edgeTypeFilter = "";
	const edgeParams: unknown[] = [minConfidence];
	if (input.edge_types && input.edge_types.length > 0) {
		const placeholders = input.edge_types.map(() => "?").join(", ");
		edgeTypeFilter = `AND type IN (${placeholders})`;
		edgeParams.push(...input.edge_types);
	}

	const edgeResult = await db.execute(
		`SELECT from_id, to_id
		 FROM graph_edges
		 WHERE t_valid_until IS NULL
		   AND confidence >= ?
		   ${edgeTypeFilter}`,
		edgeParams,
	);

	// Build bidirectional adjacency (impact analysis considers both directions)
	const adjacency = new Map<string, Set<string>>();
	for (const row of edgeResult.rows as Array<{ from_id: string; to_id: string }>) {
		if (!adjacency.has(row.from_id)) adjacency.set(row.from_id, new Set());
		if (!adjacency.has(row.to_id)) adjacency.set(row.to_id, new Set());
		adjacency.get(row.from_id)!.add(row.to_id);
		adjacency.get(row.to_id)!.add(row.from_id);
	}

	// BFS from entity_id up to max_depth
	const visited = new Set<string>([input.entity_id]);
	let frontier = [input.entity_id];
	const depthEntities = new Map<number, string[]>();

	for (let depth = 1; depth <= maxDepth; depth++) {
		const nextFrontier: string[] = [];

		for (const nodeId of frontier) {
			const neighbors = adjacency.get(nodeId) ?? new Set();
			for (const neighbor of neighbors) {
				if (!visited.has(neighbor)) {
					visited.add(neighbor);
					nextFrontier.push(neighbor);
				}
			}
		}

		if (nextFrontier.length > 0) {
			depthEntities.set(depth, nextFrontier);
		}

		frontier = nextFrontier;
		if (frontier.length === 0) break;
	}

	// Fetch entity details for all impacted nodes
	const allImpactedIds = [...depthEntities.values()].flat();
	const impact: ImpactLayer[] = [];

	if (allImpactedIds.length > 0) {
		const placeholders = allImpactedIds.map(() => "?").join(", ");
		const detailResult = await db.execute(
			`SELECT id, name, type, file_paths
			 FROM graph_nodes
			 WHERE id IN (${placeholders})
			   AND t_valid_until IS NULL
			   AND archived_at IS NULL`,
			allImpactedIds,
		);

		const entityDetails = new Map<string, ImpactEntity>();
		for (const row of detailResult.rows as Array<{
			id: string;
			name: string;
			type: string;
			file_paths: string;
		}>) {
			entityDetails.set(row.id, {
				id: row.id,
				name: row.name,
				type: row.type,
				file_paths: row.file_paths,
			});
		}

		for (const [depth, ids] of depthEntities) {
			const entities = ids
				.map((id) => entityDetails.get(id))
				.filter((e): e is ImpactEntity => e !== undefined);

			if (entities.length > 0) {
				impact.push({
					depth,
					label: labelForDepth(depth),
					entities,
				});
			}
		}
	}

	// Find affected processes
	const allAffectedIds = [input.entity_id, ...allImpactedIds];
	const processPlaceholders = allAffectedIds.map(() => "?").join(", ");
	const processResult = await db.execute(
		`SELECT DISTINCT p.name, p.step_count
		 FROM processes p
		 JOIN process_steps ps ON ps.process_id = p.id
		 WHERE ps.node_id IN (${processPlaceholders})`,
		allAffectedIds,
	);

	const processes_affected: AffectedProcess[] = (
		processResult.rows as Array<{ name: string; step_count: number }>
	).map((row) => ({
		name: row.name,
		step_count: row.step_count,
	}));

	return {
		entity: { id: rootRow.id, name: rootRow.name, type: rootRow.type },
		impact,
		processes_affected,
	};
}
