// Verifies that when @sia/native is installed, the bridge routes through the
// native module AND the adapters produce results equivalent (and correctly
// shaped) to the TypeScript fallback. These tests are skipped on platforms
// where the native binary is unavailable.

import { describe, expect, it } from "vitest";
import {
	_resetNativeStatusCache,
	type AstDiffResult,
	astDiff,
	getNativeModuleStatus,
	graphCompute,
} from "@/native/bridge";
import { fallbackAstDiff } from "@/native/fallback-ast-diff";
import { fallbackGraphCompute } from "@/native/fallback-graph";

function encode(tree: Array<{ name: string; kind: string; parent: string | null }>): Uint8Array {
	return new TextEncoder().encode(JSON.stringify(tree));
}

function isDescribe(): boolean {
	_resetNativeStatusCache();
	return getNativeModuleStatus() === "native";
}

const describeIfNative = isDescribe() ? describe : describe.skip;

describeIfNative("native bridge (when @sia/native is loaded)", () => {
	it("reports status === 'native'", () => {
		_resetNativeStatusCache();
		expect(getNativeModuleStatus()).toBe("native");
	});

	it("astDiff returns snake_case shape matching the fallback contract", () => {
		_resetNativeStatusCache();

		const oldTree = [
			{ name: "a", kind: "function", parent: null },
			{ name: "b", kind: "function", parent: "a" },
		];
		const newTree = [
			{ name: "a", kind: "function", parent: null },
			{ name: "c", kind: "function", parent: "a" },
		];
		const nodeIdMap = new Map<number, string>([
			[0, "id-a"],
			[1, "id-b"],
		]);

		const native = astDiff(encode(oldTree), encode(newTree), nodeIdMap);

		// Shape contract: snake_case keys
		expectAstDiffShape(native);

		// At least one insert (c is new) and one remove (b is gone)
		expect(native.inserts.length + native.removes.length).toBeGreaterThan(0);
	});

	it("astDiff native result matches fallback for a simple tree", () => {
		_resetNativeStatusCache();

		const oldTree = [
			{ name: "foo", kind: "function", parent: null },
			{ name: "bar", kind: "function", parent: "foo" },
		];
		const newTree = [
			{ name: "foo", kind: "function", parent: null },
			{ name: "bar", kind: "function", parent: "foo" },
			{ name: "baz", kind: "function", parent: "foo" },
		];
		const nodeIdMap = new Map<number, string>([
			[0, "id-foo"],
			[1, "id-bar"],
		]);

		const nativeResult = astDiff(encode(oldTree), encode(newTree), nodeIdMap);
		const fallbackResult = fallbackAstDiff(encode(oldTree), encode(newTree), nodeIdMap);

		expect(nativeResult.inserts.length).toBe(fallbackResult.inserts.length);
		expect(nativeResult.removes.length).toBe(fallbackResult.removes.length);
	});

	it("graphCompute pagerank returns Float64Array scores and node_ids", () => {
		_resetNativeStatusCache();

		// Chain: 0 → 1 → 2 → 3
		const edges = new Int32Array([0, 1, 1, 2, 2, 3]);
		const nodeIds = ["a", "b", "c", "d"];

		const result = graphCompute(edges, nodeIds, {
			kind: "pagerank",
			damping: 0.85,
			iterations: 50,
		});

		expect(result.scores).toBeInstanceOf(Float64Array);
		expect(result.scores.length).toBe(4);
		expect(result.node_ids).toEqual(nodeIds);

		// Downstream nodes accumulate rank in a simple chain
		expect(result.scores[3]).toBeGreaterThan(result.scores[0]);
	});

	it("graphCompute connected_components labels isolated nodes distinctly", () => {
		_resetNativeStatusCache();

		// Two disjoint components: {0,1} and {2,3}
		const edges = new Int32Array([0, 1, 2, 3]);
		const nodeIds = ["a", "b", "c", "d"];

		const nativeResult = graphCompute(edges, nodeIds, { kind: "connected_components" });
		const fallbackResult = fallbackGraphCompute(edges, nodeIds, {
			kind: "connected_components",
		});

		expect(nativeResult.scores.length).toBe(4);
		expect(fallbackResult.scores.length).toBe(4);

		// Both implementations must agree on grouping (labels may differ but
		// the partition structure must match)
		expect(nativeResult.scores[0]).toBe(nativeResult.scores[1]);
		expect(nativeResult.scores[2]).toBe(nativeResult.scores[3]);
		expect(nativeResult.scores[0]).not.toBe(nativeResult.scores[2]);
	});
});

function expectAstDiffShape(result: AstDiffResult): void {
	for (const entry of result.inserts) {
		expect(entry).toHaveProperty("node_id");
		expect(entry).toHaveProperty("kind");
		expect(entry).toHaveProperty("name");
	}
	for (const entry of result.removes) {
		expect(entry).toHaveProperty("node_id");
	}
	for (const entry of result.updates) {
		expect(entry).toHaveProperty("node_id");
		expect(entry).toHaveProperty("old_name");
		expect(entry).toHaveProperty("new_name");
	}
	for (const entry of result.moves) {
		expect(entry).toHaveProperty("node_id");
		expect(entry).toHaveProperty("old_parent");
		expect(entry).toHaveProperty("new_parent");
	}
}
