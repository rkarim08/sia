// Module: process-tracer — BFS-based execution flow detection
//
// Traces processes from entry points through `calls` edges,
// producing execution flow paths that are persisted to the
// processes and process_steps tables.

import { randomUUID } from "node:crypto";
import type { EntryPointScore } from "@/ast/entry-point-scorer";
import type { SiaDb } from "@/graph/db-interface";

export interface TracedProcess {
	name: string; // "EntryName -> TerminalName"
	entryNodeId: string;
	terminalNodeId: string;
	steps: Array<{ nodeId: string; stepOrder: number; confidence: number }>;
	scope: "intra" | "cross";
}

interface TraceOpts {
	maxDepth?: number;
	maxBranches?: number;
	minConfidence?: number;
}

const DEFAULT_MAX_DEPTH = 10;
const DEFAULT_MAX_BRANCHES = 4;
const DEFAULT_MIN_CONFIDENCE = 0.5;

export async function traceProcesses(
	db: SiaDb,
	entryPoints: EntryPointScore[],
	opts?: TraceOpts,
): Promise<TracedProcess[]> {
	const maxDepth = opts?.maxDepth ?? DEFAULT_MAX_DEPTH;
	const maxBranches = opts?.maxBranches ?? DEFAULT_MAX_BRANCHES;
	const minConfidence = opts?.minConfidence ?? DEFAULT_MIN_CONFIDENCE;

	// Filter entry points with score > 0.5
	const validEntries = entryPoints.filter((ep) => ep.score > 0.5);
	if (validEntries.length === 0) return [];

	// Build adjacency map from calls edges
	const edgeResult = await db.execute(
		`SELECT from_id, to_id, confidence
		 FROM graph_edges
		 WHERE type = 'calls'
		   AND t_valid_until IS NULL
		   AND confidence >= ?`,
		[minConfidence],
	);
	const edges = edgeResult.rows as Array<{
		from_id: string;
		to_id: string;
		confidence: number;
	}>;

	const adjacency = new Map<string, Array<{ toId: string; confidence: number }>>();
	for (const edge of edges) {
		// Skip self-loops
		if (edge.from_id === edge.to_id) continue;
		let targets = adjacency.get(edge.from_id);
		if (!targets) {
			targets = [];
			adjacency.set(edge.from_id, targets);
		}
		targets.push({ toId: edge.to_id, confidence: edge.confidence });
	}

	// Fetch node names for labeling
	const nameResult = await db.execute(
		`SELECT id, name FROM graph_nodes
		 WHERE type = 'CodeEntity'
		   AND t_valid_until IS NULL
		   AND archived_at IS NULL`,
	);
	const nameMap = new Map<string, string>();
	for (const row of nameResult.rows as Array<{ id: string; name: string }>) {
		nameMap.set(row.id, row.name);
	}

	// Fetch community memberships for scope detection
	const communityResult = await db.execute(
		"SELECT entity_id, community_id FROM community_members",
	);
	const entityToCommunity = new Map<string, string>();
	for (const row of communityResult.rows as Array<{
		entity_id: string;
		community_id: string;
	}>) {
		entityToCommunity.set(row.entity_id, row.community_id);
	}

	// Trace all paths from each entry point using DFS with depth limit
	const allProcesses: TracedProcess[] = [];

	for (const entry of validEntries) {
		const paths = tracePaths(
			entry.entityId,
			adjacency,
			maxDepth,
			maxBranches,
		);

		for (const path of paths) {
			if (path.length < 2) continue; // Skip single-node paths

			const entryId = path[0].nodeId;
			const terminalId = path[path.length - 1].nodeId;
			const entryName = nameMap.get(entryId) ?? "Unknown";
			const terminalName = nameMap.get(terminalId) ?? "Unknown";

			// Determine scope
			const entryCommunity = entityToCommunity.get(entryId);
			const terminalCommunity = entityToCommunity.get(terminalId);
			const scope: "intra" | "cross" =
				entryCommunity && terminalCommunity && entryCommunity === terminalCommunity
					? "intra"
					: "cross";

			allProcesses.push({
				name: `${entryName} -> ${terminalName}`,
				entryNodeId: entryId,
				terminalNodeId: terminalId,
				steps: path.map((step, idx) => ({
					nodeId: step.nodeId,
					stepOrder: idx,
					confidence: step.confidence,
				})),
				scope,
			});
		}
	}

	// Dedup: remove subset processes
	const deduped = deduplicateProcesses(allProcesses);

	// Persist to database
	await persistProcesses(db, deduped, entryPoints);

	return deduped;
}

/** Trace all paths from a starting node using DFS, respecting depth and branch limits. */
function tracePaths(
	startId: string,
	adjacency: Map<string, Array<{ toId: string; confidence: number }>>,
	maxDepth: number,
	maxBranches: number,
): Array<Array<{ nodeId: string; confidence: number }>> {
	const results: Array<Array<{ nodeId: string; confidence: number }>> = [];

	// DFS stack: each entry is (currentPath, visitedSet)
	const stack: Array<{
		path: Array<{ nodeId: string; confidence: number }>;
		visited: Set<string>;
	}> = [];

	stack.push({
		path: [{ nodeId: startId, confidence: 1.0 }],
		visited: new Set([startId]),
	});

	while (stack.length > 0) {
		const current = stack.pop()!;
		const lastNode = current.path[current.path.length - 1].nodeId;
		const depth = current.path.length - 1;

		// Get outgoing calls edges
		const neighbors = adjacency.get(lastNode) ?? [];
		const unvisitedNeighbors = neighbors.filter((n) => !current.visited.has(n.toId));

		// If terminal (no unvisited neighbors or at max depth), record the path
		if (unvisitedNeighbors.length === 0 || depth >= maxDepth) {
			if (current.path.length >= 2) {
				results.push(current.path);
			}
			continue;
		}

		// Limit branches
		const branchTargets = unvisitedNeighbors.slice(0, maxBranches);

		for (const target of branchTargets) {
			const newVisited = new Set(current.visited);
			newVisited.add(target.toId);
			stack.push({
				path: [...current.path, { nodeId: target.toId, confidence: target.confidence }],
				visited: newVisited,
			});
		}
	}

	return results;
}

/** Remove processes that are strict subsets of other processes. */
function deduplicateProcesses(processes: TracedProcess[]): TracedProcess[] {
	if (processes.length <= 1) return processes;

	// Sort by step count descending so longer processes come first
	const sorted = [...processes].sort((a, b) => b.steps.length - a.steps.length);

	const kept: TracedProcess[] = [];

	for (const proc of sorted) {
		const procNodeSet = new Set(proc.steps.map((s) => s.nodeId));

		// Check if this process is a subset of any already-kept process
		const isSubset = kept.some((existing) => {
			if (existing.steps.length <= proc.steps.length) return false;
			const existingSet = new Set(existing.steps.map((s) => s.nodeId));
			return [...procNodeSet].every((id) => existingSet.has(id));
		});

		if (!isSubset) {
			kept.push(proc);
		}
	}

	return kept;
}

/** Persist traced processes and their steps to the database. */
async function persistProcesses(
	db: SiaDb,
	processes: TracedProcess[],
	entryPoints: EntryPointScore[],
): Promise<void> {
	const entryScoreMap = new Map<string, number>();
	for (const ep of entryPoints) {
		entryScoreMap.set(ep.entityId, ep.score);
	}

	const now = Date.now();

	for (const proc of processes) {
		const processId = randomUUID();
		const entryScore = entryScoreMap.get(proc.entryNodeId) ?? 0.5;

		await db.execute(
			`INSERT INTO processes (id, name, entry_node_id, terminal_node_id, step_count, scope, entry_score, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				processId,
				proc.name,
				proc.entryNodeId,
				proc.terminalNodeId,
				proc.steps.length,
				proc.scope,
				entryScore,
				now,
				now,
			],
		);

		for (const step of proc.steps) {
			await db.execute(
				`INSERT OR IGNORE INTO process_steps (process_id, node_id, step_order, confidence)
				 VALUES (?, ?, ?, ?)`,
				[processId, step.nodeId, step.stepOrder, step.confidence],
			);
		}
	}
}
