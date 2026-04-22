// Module: native/bridge — Single import site for the native performance module
// Three-tier fallback: native → wasm → typescript
//
// The @sia/native Rust module exposes a camelCase surface (NAPI's default
// casing). The bridge's public contract uses snake_case to match the
// TypeScript fallback's ergonomic shape for consumers. The adapters below
// translate between the two.

import { fallbackAstDiff } from "./fallback-ast-diff";
import { fallbackGraphCompute } from "./fallback-graph";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface AstDiffResult {
	inserts: Array<{ node_id: string; kind: string; name: string }>;
	removes: Array<{ node_id: string }>;
	updates: Array<{ node_id: string; old_name: string; new_name: string }>;
	moves: Array<{ node_id: string; old_parent: string; new_parent: string }>;
}

export interface GraphComputeResult {
	scores: Float64Array;
	node_ids: string[];
}

export type GraphAlgorithm =
	| { kind: "pagerank"; damping: number; iterations: number; seed_nodes?: string[] }
	| { kind: "shortest_path"; source: string }
	| { kind: "betweenness_centrality" }
	| { kind: "connected_components" };

// ---------------------------------------------------------------------------
// Native module shape (camelCase, matches @sia/native's NAPI bindings)
// ---------------------------------------------------------------------------

interface NativeAstDiffResult {
	inserts: Array<{ nodeId: string; kind: string; name: string }>;
	removes: Array<{ nodeId: string }>;
	updates: Array<{ nodeId: string; oldName: string; newName: string }>;
	moves: Array<{ nodeId: string; oldParent: string; newParent: string }>;
}

interface NativeGraphComputeResult {
	scores: number[];
	nodeIds: string[];
}

interface NativeGraphAlgorithmConfig {
	kind: "Pagerank" | "ShortestPath" | "BetweennessCentrality" | "ConnectedComponents";
	damping?: number;
	iterations?: number;
	seedNodes?: string[];
	source?: string;
}

interface NativeModule {
	isNative(): boolean;
	isWasm(): boolean;
	astDiff(
		oldTreeBytes: Uint8Array,
		newTreeBytes: Uint8Array,
		nodeIdMap: string[],
	): NativeAstDiffResult;
	graphCompute(
		edges: Int32Array,
		nodeIds: string[],
		algorithm: NativeGraphAlgorithmConfig,
	): NativeGraphComputeResult;
}

// ---------------------------------------------------------------------------
// Tier detection
// ---------------------------------------------------------------------------

export type NativeModuleStatus = "native" | "wasm" | "typescript";

let _cachedStatus: NativeModuleStatus | null = null;

/**
 * Probe the three tiers in order and return which one is available:
 * 1. `@sia/native`      — compiled Rust module
 * 2. `@sia/native-wasm` — WASM build of the same Rust module
 * 3. `typescript`       — pure TS fallback (always available)
 */
export function isNativeAvailable(): NativeModuleStatus {
	return getNativeModuleStatus();
}

/**
 * Detect which implementation is active:
 * - "native"     — native Rust module loaded successfully
 * - "wasm"       — WASM fallback loaded successfully
 * - "typescript" — pure TypeScript fallback (no compiled module)
 */
export function getNativeModuleStatus(): NativeModuleStatus {
	if (_cachedStatus !== null) {
		return _cachedStatus;
	}

	try {
		require("@sia/native");
		_cachedStatus = "native";
		return _cachedStatus;
	} catch {
		// not installed or platform binary missing
	}

	try {
		require("@sia/native-wasm");
		_cachedStatus = "wasm";
		return _cachedStatus;
	} catch {
		// not installed
	}

	_cachedStatus = "typescript";
	return _cachedStatus;
}

/** Reset the cached status. Exposed for tests. */
export function _resetNativeStatusCache(): void {
	_cachedStatus = null;
}

function loadNativeModule(pkg: string): NativeModule | null {
	try {
		return require(pkg) as NativeModule;
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------
// Adapters — native shape ↔ bridge shape
// ---------------------------------------------------------------------------

/**
 * Convert a sparse index→id map into the dense string array the native
 * expects. Gaps are filled with the empty string; the array length is
 * `max(keys) + 1`.
 */
function nodeIdMapToArray(nodeIdMap: Map<number, string>): string[] {
	if (nodeIdMap.size === 0) return [];
	let max = -1;
	for (const k of nodeIdMap.keys()) {
		if (k > max) max = k;
	}
	const arr = new Array<string>(max + 1).fill("");
	for (const [k, v] of nodeIdMap) arr[k] = v;
	return arr;
}

/** Translate native (camelCase) to bridge (snake_case). */
function adaptAstDiffResult(result: NativeAstDiffResult): AstDiffResult {
	return {
		inserts: result.inserts.map((i) => ({ node_id: i.nodeId, kind: i.kind, name: i.name })),
		removes: result.removes.map((r) => ({ node_id: r.nodeId })),
		updates: result.updates.map((u) => ({
			node_id: u.nodeId,
			old_name: u.oldName,
			new_name: u.newName,
		})),
		moves: result.moves.map((m) => ({
			node_id: m.nodeId,
			old_parent: m.oldParent,
			new_parent: m.newParent,
		})),
	};
}

const ALGORITHM_KIND_MAP = {
	pagerank: "Pagerank",
	shortest_path: "ShortestPath",
	betweenness_centrality: "BetweennessCentrality",
	connected_components: "ConnectedComponents",
} as const;

/** Translate bridge algorithm config to native config. */
function adaptAlgorithmConfig(algorithm: GraphAlgorithm): NativeGraphAlgorithmConfig {
	switch (algorithm.kind) {
		case "pagerank":
			return {
				kind: ALGORITHM_KIND_MAP.pagerank,
				damping: algorithm.damping,
				iterations: algorithm.iterations,
				seedNodes: algorithm.seed_nodes,
			};
		case "shortest_path":
			return { kind: ALGORITHM_KIND_MAP.shortest_path, source: algorithm.source };
		case "betweenness_centrality":
			return { kind: ALGORITHM_KIND_MAP.betweenness_centrality };
		case "connected_components":
			return { kind: ALGORITHM_KIND_MAP.connected_components };
	}
}

/**
 * The Rust AST diff deserialiser expects `parent: String` (not `Option<String>`),
 * so `{parent: null}` entries from the bridge's public contract are re-encoded
 * to `{parent: ""}` before being handed to the native module. Both representations
 * have identical meaning in the diff algorithm — absence of a parent.
 */
function normalizeTreeBytesForNative(bytes: Uint8Array): Uint8Array {
	const text = new TextDecoder().decode(bytes);
	try {
		const parsed = JSON.parse(text) as unknown;
		if (!Array.isArray(parsed)) return bytes;
		const normalized = (parsed as Array<Record<string, unknown>>).map((n) => ({
			name: typeof n.name === "string" ? n.name : String(n.name ?? ""),
			kind: typeof n.kind === "string" ? n.kind : String(n.kind ?? ""),
			parent: n.parent == null ? "" : String(n.parent),
		}));
		return new TextEncoder().encode(JSON.stringify(normalized));
	} catch {
		return bytes;
	}
}

/**
 * Expand `[from, to, from, to, ...]` (bridge pairs) into
 * `[from, to, weight, from, to, weight, ...]` (native triplets) with weight=1.
 */
function edgesToTriplets(edges: Int32Array): Int32Array {
	const pairCount = Math.floor(edges.length / 2);
	const out = new Int32Array(pairCount * 3);
	for (let i = 0; i < pairCount; i++) {
		out[i * 3] = edges[i * 2];
		out[i * 3 + 1] = edges[i * 2 + 1];
		out[i * 3 + 2] = 1;
	}
	return out;
}

// ---------------------------------------------------------------------------
// Public API — routes to the best available implementation
// ---------------------------------------------------------------------------

/**
 * Diff two AST trees encoded as byte arrays.
 *
 * In the TypeScript fallback the bytes are JSON-encoded arrays of
 * `{name, kind, parent}` objects. `nodeIdMap` maps positional indices in the
 * old tree to stable node IDs.
 */
export function astDiff(
	oldTreeBytes: Uint8Array,
	newTreeBytes: Uint8Array,
	nodeIdMap: Map<number, string>,
): AstDiffResult {
	const tier = getNativeModuleStatus();

	if (tier === "native") {
		const mod = loadNativeModule("@sia/native");
		if (mod) {
			return adaptAstDiffResult(
				mod.astDiff(
					normalizeTreeBytesForNative(oldTreeBytes),
					normalizeTreeBytesForNative(newTreeBytes),
					nodeIdMapToArray(nodeIdMap),
				),
			);
		}
	}

	if (tier === "wasm") {
		const mod = loadNativeModule("@sia/native-wasm");
		if (mod) {
			return adaptAstDiffResult(
				mod.astDiff(
					normalizeTreeBytesForNative(oldTreeBytes),
					normalizeTreeBytesForNative(newTreeBytes),
					nodeIdMapToArray(nodeIdMap),
				),
			);
		}
	}

	return fallbackAstDiff(oldTreeBytes, newTreeBytes, nodeIdMap);
}

/**
 * Run a graph algorithm on a flat edge list.
 *
 * `edges` is a flat Int32Array of `[from, to, from, to, …]` pairs where
 * indices refer to positions in `nodeIds`.
 */
export function graphCompute(
	edges: Int32Array,
	nodeIds: string[],
	algorithm: GraphAlgorithm,
): GraphComputeResult {
	const tier = getNativeModuleStatus();

	if (tier === "native") {
		const mod = loadNativeModule("@sia/native");
		if (mod) {
			const result = mod.graphCompute(
				edgesToTriplets(edges),
				nodeIds,
				adaptAlgorithmConfig(algorithm),
			);
			return { scores: new Float64Array(result.scores), node_ids: result.nodeIds };
		}
	}

	if (tier === "wasm") {
		const mod = loadNativeModule("@sia/native-wasm");
		if (mod) {
			const result = mod.graphCompute(
				edgesToTriplets(edges),
				nodeIds,
				adaptAlgorithmConfig(algorithm),
			);
			return { scores: new Float64Array(result.scores), node_ids: result.nodeIds };
		}
	}

	return fallbackGraphCompute(edges, nodeIds, algorithm);
}
