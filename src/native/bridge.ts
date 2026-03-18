// Module: native/bridge — Single import site for the native performance module
// Three-tier fallback: native → wasm → typescript
//
// Since @sia/native and @sia/native-wasm do not exist yet, this always
// falls back to the pure TypeScript implementations.

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

	// Attempt to load the native Rust module
	try {
		require("@sia/native");
		_cachedStatus = "native";
		return _cachedStatus;
	} catch {
		// not installed
	}

	// Attempt to load the WASM build
	try {
		require("@sia/native-wasm");
		_cachedStatus = "wasm";
		return _cachedStatus;
	} catch {
		// not installed
	}

	// Pure TypeScript fallback
	_cachedStatus = "typescript";
	return _cachedStatus;
}

/**
 * Reset the cached status (for testing).
 */
export function _resetNativeStatusCache(): void {
	_cachedStatus = null;
}

// ---------------------------------------------------------------------------
// Lazy native module handle
// ---------------------------------------------------------------------------

interface NativeModule {
	astDiff(
		oldTreeBytes: Uint8Array,
		newTreeBytes: Uint8Array,
		nodeIdMap: Map<number, string>,
	): AstDiffResult;
	graphCompute(edges: Int32Array, nodeIds: string[], algorithm: GraphAlgorithm): GraphComputeResult;
}

function loadNativeModule(pkg: string): NativeModule | null {
	try {
		return require(pkg) as NativeModule;
	} catch {
		return null;
	}
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
		if (mod) return mod.astDiff(oldTreeBytes, newTreeBytes, nodeIdMap);
	}

	if (tier === "wasm") {
		const mod = loadNativeModule("@sia/native-wasm");
		if (mod) return mod.astDiff(oldTreeBytes, newTreeBytes, nodeIdMap);
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
		if (mod) return mod.graphCompute(edges, nodeIds, algorithm);
	}

	if (tier === "wasm") {
		const mod = loadNativeModule("@sia/native-wasm");
		if (mod) return mod.graphCompute(edges, nodeIds, algorithm);
	}

	return fallbackGraphCompute(edges, nodeIds, algorithm);
}
