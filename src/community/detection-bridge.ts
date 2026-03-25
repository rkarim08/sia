// Module: detection-bridge — Community detection with native/JS fallback
//
// Routes to the Rust Leiden implementation when @sia/native is available,
// otherwise runs a simplified JavaScript Louvain algorithm.

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CommunityLevelResult {
	/** community label for each node (index = node index) */
	membership: number[];
	/** modularity Q score for this level */
	modularity: number;
	/** number of distinct communities at this level */
	n_communities: number;
}

export interface CommunityResult {
	levels: CommunityLevelResult[];
	backend: "rust-leiden" | "js-louvain";
}

// ---------------------------------------------------------------------------
// Native module probe (same pattern as bridge.ts)
// ---------------------------------------------------------------------------

interface NativeLeidenModule {
	detectCommunities(
		edges: Array<[number, number, number]>,
		nodeCount: number,
		resolutions?: number[],
	): CommunityResult;
}

function loadNativeLeiden(): NativeLeidenModule | null {
	try {
		return require("@sia/native") as NativeLeidenModule;
	} catch {
		process.stderr.write("sia: native Leiden module not available, using JS fallback\n");
		return null;
	}
}

// ---------------------------------------------------------------------------
// Simplified Louvain — pure TypeScript fallback
// ---------------------------------------------------------------------------

/**
 * Compute modularity Q for a given partition.
 *
 * Q = (1/2m) * sum_{ij}[ A_ij - k_i * k_j / (2m) ] * delta(c_i, c_j)
 *
 * where m = total edge weight, k_i = weighted degree of node i,
 * and A_ij = weight of edge (i,j).
 */
function computeModularity(
	adjacency: Map<number, Map<number, number>>,
	membership: number[],
	totalWeight: number,
	degrees: Float64Array,
): number {
	if (totalWeight === 0) return 0;
	const m2 = 2 * totalWeight;
	let q = 0;

	for (const [i, nbrs] of adjacency) {
		for (const [j, w] of nbrs) {
			if (membership[i] === membership[j]) {
				q += w - (degrees[i] * degrees[j]) / m2;
			}
		}
	}

	return q / m2;
}

/**
 * Compute the modularity gain from moving node `v` into community `C`.
 *
 * Standard Louvain formula:
 * ΔQ = k_v_in / m - resolution * k_v * sigma_tot / (2m^2)
 *    = 2*k_v_in / m2 - 2*resolution * k_v * sigma_tot / m2^2
 *
 * where m2 = 2m, k_v_in = edge weight sum between v and C,
 * sigma_tot = sum of degrees in C.
 */
function modularityGain(
	kVIn: number,
	kV: number,
	sigmaTot: number,
	m2: number,
	resolution: number,
): number {
	return (2 * kVIn) / m2 - (2 * resolution * kV * sigmaTot) / (m2 * m2);
}

function buildAdjacency(
	edges: Array<[number, number, number]>,
	nodeCount: number,
): {
	adj: Map<number, Map<number, number>>;
	degrees: Float64Array;
	totalWeight: number;
} {
	const adj = new Map<number, Map<number, number>>();
	for (let i = 0; i < nodeCount; i++) adj.set(i, new Map());

	let totalWeight = 0;
	for (const [from, to, weight] of edges) {
		if (from < 0 || to < 0 || from >= nodeCount || to >= nodeCount) continue;
		const w = weight ?? 1;

		// Undirected: add both directions
		const fwd = adj.get(from);
		if (fwd) fwd.set(to, (fwd.get(to) ?? 0) + w);

		if (from !== to) {
			const bwd = adj.get(to);
			if (bwd) bwd.set(from, (bwd.get(from) ?? 0) + w);
		}

		totalWeight += w;
	}

	const degrees = new Float64Array(nodeCount);
	for (const [node, nbrs] of adj) {
		let deg = 0;
		for (const w of nbrs.values()) deg += w;
		degrees[node] = deg;
	}

	return { adj, degrees, totalWeight };
}

/**
 * Run one pass of the Louvain algorithm at a given resolution.
 * Returns the membership array.
 */
function louvainPass(
	adj: Map<number, Map<number, number>>,
	degrees: Float64Array,
	totalWeight: number,
	initialMembership: number[],
	resolution: number,
	maxIterations = 100,
): number[] {
	const n = degrees.length;
	if (n === 0) return [];

	const m2 = 2 * totalWeight;
	const membership = [...initialMembership];

	// sigma_tot[c] = sum of degrees in community c
	const sigmaTot = new Map<number, number>();
	for (let i = 0; i < n; i++) {
		const c = membership[i];
		sigmaTot.set(c, (sigmaTot.get(c) ?? 0) + degrees[i]);
	}

	let improved = true;
	let iterations = 0;

	while (improved && iterations < maxIterations) {
		improved = false;
		iterations++;

		for (let v = 0; v < n; v++) {
			const currentComm = membership[v];
			const kV = degrees[v];

			// Weight from v to each neighboring community
			const commWeights = new Map<number, number>();
			for (const [nbr, w] of adj.get(v) ?? new Map()) {
				const c = membership[nbr];
				commWeights.set(c, (commWeights.get(c) ?? 0) + w);
			}

			// Gain from removing v from current community
			const kVInCurrent = commWeights.get(currentComm) ?? 0;
			const sigmaCurrent = sigmaTot.get(currentComm) ?? 0;

			// Try moving v to each neighboring community
			let bestGain = 0;
			let bestComm = currentComm;

			for (const [targetComm, kVIn] of commWeights) {
				if (targetComm === currentComm) continue;
				const sigmaTarget = sigmaTot.get(targetComm) ?? 0;

				// Gain from adding v to targetComm minus cost of removing from currentComm
				const gain =
					modularityGain(kVIn, kV, sigmaTarget, m2, resolution) -
					modularityGain(kVInCurrent, kV, sigmaCurrent - kV, m2, resolution);

				if (gain > bestGain) {
					bestGain = gain;
					bestComm = targetComm;
				}
			}

			if (bestComm !== currentComm) {
				// Move v to bestComm
				sigmaTot.set(currentComm, (sigmaTot.get(currentComm) ?? 0) - kV);
				sigmaTot.set(bestComm, (sigmaTot.get(bestComm) ?? 0) + kV);
				membership[v] = bestComm;
				improved = true;
			}
		}
	}

	// Compact community IDs to [0, k)
	const remap = new Map<number, number>();
	let nextId = 0;
	for (let i = 0; i < n; i++) {
		if (!remap.has(membership[i])) {
			remap.set(membership[i], nextId++);
		}
		membership[i] = remap.get(membership[i]) ?? 0;
	}

	return membership;
}

/**
 * Post-process: split disconnected nodes within a community into separate
 * communities using BFS. The largest (first-found) component keeps the
 * original community ID; additional components get new IDs.
 */
function splitDisconnected(
	adj: Map<number, Map<number, number>>,
	membership: number[],
	n: number,
): number[] {
	const result = [...membership];
	let nextComm = Math.max(0, ...membership) + 1;

	// Group nodes by community
	const communityNodes = new Map<number, number[]>();
	for (let i = 0; i < n; i++) {
		const c = membership[i];
		if (!communityNodes.has(c)) communityNodes.set(c, []);
		communityNodes.get(c)?.push(i);
	}

	for (const [, nodes] of communityNodes) {
		if (nodes.length <= 1) continue;
		const nodeSet = new Set(nodes);
		const visited = new Set<number>();
		let isFirstComponent = true;

		for (const start of nodes) {
			if (visited.has(start)) continue;

			// BFS within community
			const queue = [start];
			const component: number[] = [];
			visited.add(start);
			while (queue.length > 0) {
				const cur = queue.shift();
				if (cur === undefined) break;
				component.push(cur);
				for (const nbr of adj.get(cur)?.keys() ?? []) {
					if (nodeSet.has(nbr) && !visited.has(nbr)) {
						visited.add(nbr);
						queue.push(nbr);
					}
				}
			}

			if (isFirstComponent) {
				// First component keeps the original community ID
				isFirstComponent = false;
			} else {
				// Subsequent disconnected components get new community IDs
				for (const node of component) {
					result[node] = nextComm;
				}
				nextComm++;
			}
		}
	}

	return result;
}

function jsLouvain(
	edges: Array<[number, number, number]>,
	nodeCount: number,
	resolutions: number[],
): CommunityResult {
	if (nodeCount === 0) {
		return {
			levels: [],
			backend: "js-louvain",
		};
	}

	const { adj, degrees, totalWeight } = buildAdjacency(edges, nodeCount);
	const levels: CommunityLevelResult[] = [];

	for (const resolution of resolutions) {
		// Each node starts in its own community
		const initial = Array.from({ length: nodeCount }, (_, i) => i);
		let membership = louvainPass(adj, degrees, totalWeight, initial, resolution);
		membership = splitDisconnected(adj, membership, nodeCount);

		const n_communities = new Set(membership).size;
		const modularity = computeModularity(adj, membership, totalWeight, degrees);

		levels.push({ membership, modularity, n_communities });
	}

	return { levels, backend: "js-louvain" };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Detect communities in a weighted graph.
 *
 * @param edges       Array of [from, to, weight] triples (node indices).
 * @param nodeCount   Total number of nodes.
 * @param resolutions Resolution parameters per level. Defaults to [1.0].
 *                    Higher resolution → more, smaller communities.
 */
export function detectCommunities(
	edges: Array<[number, number, number]>,
	nodeCount: number,
	resolutions: number[] = [1.0],
): CommunityResult {
	// Try native Rust Leiden implementation first
	const nativeMod = loadNativeLeiden();
	if (nativeMod) {
		try {
			return nativeMod.detectCommunities(edges, nodeCount, resolutions);
		} catch (err) {
			process.stderr.write(
				`sia: native Leiden failed at runtime: ${err instanceof Error ? err.message : String(err)} — using JS fallback\n`,
			);
		}
	}

	return jsLouvain(edges, nodeCount, resolutions);
}
