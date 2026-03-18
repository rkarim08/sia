// Module: fallback-graph — Pure TypeScript graph algorithm implementations
// Used when the native Rust module is unavailable.

import type { GraphAlgorithm, GraphComputeResult } from "./bridge";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Build adjacency list from flat Int32Array of [from, to] pairs. */
function buildAdjacency(edges: Int32Array, nodeCount: number): Map<number, number[]> {
	const adj = new Map<number, number[]>();
	for (let i = 0; i < nodeCount; i++) adj.set(i, []);

	for (let i = 0; i < edges.length - 1; i += 2) {
		const from = edges[i];
		const to = edges[i + 1];
		if (from >= 0 && to >= 0) {
			adj.get(from)?.push(to);
		}
	}
	return adj;
}

// ---------------------------------------------------------------------------
// PageRank (power iteration)
// ---------------------------------------------------------------------------

function pagerank(
	edges: Int32Array,
	nodeIds: string[],
	damping: number,
	maxIterations: number,
	_seedNodes?: string[],
): Float64Array {
	const n = nodeIds.length;
	if (n === 0) return new Float64Array(0);

	// outDegree[i] = number of out-edges from node i
	const outDegree = new Int32Array(n);
	for (let i = 0; i < edges.length - 1; i += 2) {
		const from = edges[i];
		if (from >= 0 && from < n) {
			outDegree[from]++;
		}
	}

	// Incoming edge map: to -> [from, ...]
	const incoming = new Map<number, number[]>();
	for (let i = 0; i < n; i++) incoming.set(i, []);
	for (let i = 0; i < edges.length - 1; i += 2) {
		const from = edges[i];
		const to = edges[i + 1];
		if (from >= 0 && to >= 0 && from < n && to < n) {
			incoming.get(to)?.push(from);
		}
	}

	let scores = new Float64Array(n).fill(1 / n);
	const uniform = 1 / n;

	for (let iter = 0; iter < maxIterations; iter++) {
		const next = new Float64Array(n);

		// Dangling node mass (nodes with no out-edges)
		let dangling = 0;
		for (let i = 0; i < n; i++) {
			if (outDegree[i] === 0) dangling += scores[i];
		}

		for (let v = 0; v < n; v++) {
			let rank = dangling * uniform; // spread dangling mass uniformly
			for (const u of incoming.get(v) ?? []) {
				rank += scores[u] / outDegree[u];
			}
			next[v] = (1 - damping) * uniform + damping * rank;
		}

		let delta = 0;
		for (let i = 0; i < n; i++) {
			delta += Math.abs(next[i] - scores[i]);
		}
		scores = next;
		if (delta < 1e-8) break;
	}

	return scores;
}

// ---------------------------------------------------------------------------
// Dijkstra (shortest path from source)
// ---------------------------------------------------------------------------

function dijkstra(edges: Int32Array, nodeIds: string[], source: string): Float64Array {
	const n = nodeIds.length;
	if (n === 0) return new Float64Array(0);

	const sourceIdx = nodeIds.indexOf(source);
	const dist = new Float64Array(n).fill(Number.POSITIVE_INFINITY);
	if (sourceIdx < 0) return dist;

	dist[sourceIdx] = 0;

	// Min-heap: [dist, nodeIndex]
	// Simple binary min-heap implementation
	const heap: Array<[number, number]> = [[0, sourceIdx]];

	function heapPush(item: [number, number]): void {
		heap.push(item);
		let i = heap.length - 1;
		while (i > 0) {
			const parent = Math.floor((i - 1) / 2);
			if (heap[parent][0] <= heap[i][0]) break;
			[heap[parent], heap[i]] = [heap[i], heap[parent]];
			i = parent;
		}
	}

	function heapPop(): [number, number] | undefined {
		if (heap.length === 0) return undefined;
		const top = heap[0];
		const last = heap.pop();
		if (last !== undefined && heap.length > 0) {
			heap[0] = last;
			let i = 0;
			while (true) {
				const left = 2 * i + 1;
				const right = 2 * i + 2;
				let smallest = i;
				if (left < heap.length && heap[left][0] < heap[smallest][0]) smallest = left;
				if (right < heap.length && heap[right][0] < heap[smallest][0]) smallest = right;
				if (smallest === i) break;
				[heap[i], heap[smallest]] = [heap[smallest], heap[i]];
				i = smallest;
			}
		}
		return top;
	}

	// Build adjacency with unit weights (edge length = 1)
	const adj = buildAdjacency(edges, n);

	while (heap.length > 0) {
		const top = heapPop();
		if (!top) break;
		const [d, u] = top;
		if (d > dist[u]) continue; // stale entry
		for (const v of adj.get(u) ?? []) {
			const nd = dist[u] + 1;
			if (nd < dist[v]) {
				dist[v] = nd;
				heapPush([nd, v]);
			}
		}
	}

	return dist;
}

// ---------------------------------------------------------------------------
// Union-Find (connected components)
// ---------------------------------------------------------------------------

function connectedComponents(edges: Int32Array, nodeCount: number): Float64Array {
	if (nodeCount === 0) return new Float64Array(0);

	const parent = new Int32Array(nodeCount);
	const rank = new Int32Array(nodeCount);
	for (let i = 0; i < nodeCount; i++) parent[i] = i;

	function find(x: number): number {
		let cur = x;
		while (parent[cur] !== cur) {
			parent[cur] = parent[parent[cur]]; // path halving
			cur = parent[cur];
		}
		return cur;
	}

	function union(a: number, b: number): void {
		const ra = find(a);
		const rb = find(b);
		if (ra === rb) return;
		if (rank[ra] < rank[rb]) {
			parent[ra] = rb;
		} else if (rank[ra] > rank[rb]) {
			parent[rb] = ra;
		} else {
			parent[rb] = ra;
			rank[ra]++;
		}
	}

	for (let i = 0; i < edges.length - 1; i += 2) {
		const from = edges[i];
		const to = edges[i + 1];
		if (from >= 0 && to >= 0 && from < nodeCount && to < nodeCount) {
			union(from, to);
		}
	}

	// Assign compact component labels
	const rootToLabel = new Map<number, number>();
	let nextLabel = 0;
	const result = new Float64Array(nodeCount);
	for (let i = 0; i < nodeCount; i++) {
		const root = find(i);
		if (!rootToLabel.has(root)) {
			rootToLabel.set(root, nextLabel++);
		}
		result[i] = rootToLabel.get(root) ?? 0;
	}
	return result;
}

// ---------------------------------------------------------------------------
// Brandes betweenness centrality
// ---------------------------------------------------------------------------

function betweennessCentrality(edges: Int32Array, nodeIds: string[]): Float64Array {
	const n = nodeIds.length;
	if (n === 0) return new Float64Array(0);

	const adj = new Map<number, number[]>();
	for (let i = 0; i < n; i++) adj.set(i, []);
	for (let i = 0; i < edges.length - 1; i += 2) {
		const from = edges[i];
		const to = edges[i + 1];
		if (from >= 0 && to >= 0 && from < n && to < n) {
			adj.get(from)?.push(to);
			adj.get(to)?.push(from); // treat as undirected for betweenness
		}
	}

	// Deduplicate adjacency
	for (const [k, v] of adj) {
		adj.set(k, [...new Set(v)]);
	}

	const betweenness = new Float64Array(n);

	for (let s = 0; s < n; s++) {
		const stack: number[] = [];
		const pred: number[][] = Array.from({ length: n }, () => []);
		const sigma = new Float64Array(n); // number of shortest paths from s
		const dist = new Float64Array(n).fill(-1);

		sigma[s] = 1;
		dist[s] = 0;
		const queue: number[] = [s];

		while (queue.length > 0) {
			const v = queue.shift();
			if (v === undefined) break;
			stack.push(v);
			for (const w of adj.get(v) ?? []) {
				if (dist[w] < 0) {
					queue.push(w);
					dist[w] = dist[v] + 1;
				}
				if (dist[w] === dist[v] + 1) {
					sigma[w] += sigma[v];
					pred[w].push(v);
				}
			}
		}

		const delta = new Float64Array(n);
		while (stack.length > 0) {
			const w = stack.pop();
			if (w === undefined) break;
			for (const v of pred[w]) {
				delta[v] += (sigma[v] / sigma[w]) * (1 + delta[w]);
			}
			if (w !== s) betweenness[w] += delta[w];
		}
	}

	// Normalize (undirected: divide by 2)
	for (let i = 0; i < n; i++) {
		betweenness[i] /= 2;
	}

	return betweenness;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export function fallbackGraphCompute(
	edges: Int32Array,
	nodeIds: string[],
	algorithm: GraphAlgorithm,
): GraphComputeResult {
	let scores: Float64Array;

	switch (algorithm.kind) {
		case "pagerank":
			scores = pagerank(
				edges,
				nodeIds,
				algorithm.damping,
				algorithm.iterations,
				algorithm.seed_nodes,
			);
			break;
		case "shortest_path":
			scores = dijkstra(edges, nodeIds, algorithm.source);
			break;
		case "connected_components":
			scores = connectedComponents(edges, nodeIds.length);
			break;
		case "betweenness_centrality":
			scores = betweennessCentrality(edges, nodeIds);
			break;
		default: {
			// Exhaustive check
			const _never: never = algorithm;
			throw new Error(`Unknown algorithm: ${JSON.stringify(_never)}`);
		}
	}

	return { scores, node_ids: nodeIds };
}
