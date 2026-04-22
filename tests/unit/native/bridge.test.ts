import { describe, expect, it } from "vitest";
import { astDiff, graphCompute, isNativeAvailable } from "@/native/bridge";

describe("isNativeAvailable", () => {
	it("returns one of the three valid tiers", () => {
		const result = isNativeAvailable();
		expect(["native", "wasm", "typescript"]).toContain(result);
	});
});

describe("astDiff via bridge", () => {
	it("returns a valid AstDiffResult using fallback", () => {
		const oldTree = [
			{ name: "foo", kind: "Function", parent: null },
			{ name: "bar", kind: "Function", parent: null },
		];
		const newTree = [
			{ name: "foo", kind: "Function", parent: null },
			{ name: "baz", kind: "Function", parent: null },
		];

		const enc = new TextEncoder();
		const oldBytes = enc.encode(JSON.stringify(oldTree));
		const newBytes = enc.encode(JSON.stringify(newTree));
		const nodeIdMap = new Map<number, string>([
			[0, "node-0"],
			[1, "node-1"],
		]);

		const result = astDiff(oldBytes, newBytes, nodeIdMap);

		expect(result).toBeDefined();
		expect(Array.isArray(result.inserts)).toBe(true);
		expect(Array.isArray(result.removes)).toBe(true);
		expect(Array.isArray(result.updates)).toBe(true);
		expect(Array.isArray(result.moves)).toBe(true);

		// "baz" is inserted, "bar" is removed
		const insertNames = result.inserts.map((i) => i.name);
		const removeIds = result.removes.map((r) => r.node_id);
		expect(insertNames).toContain("baz");
		expect(removeIds.length).toBeGreaterThan(0);
	});
});

describe("graphCompute via bridge", () => {
	it("pagerank returns scores for all nodes", () => {
		// Graph: 0->1, 0->2, 1->2
		// nodeIds: ["A", "B", "C"]
		const edges = new Int32Array([0, 1, 0, 2, 1, 2]);
		const nodeIds = ["A", "B", "C"];

		const result = graphCompute(edges, nodeIds, {
			kind: "pagerank",
			damping: 0.85,
			iterations: 30,
		});

		expect(result.scores).toBeInstanceOf(Float64Array);
		expect(result.node_ids).toEqual(nodeIds);
		expect(result.scores.length).toBe(nodeIds.length);

		// All scores should be positive
		for (const score of result.scores) {
			expect(score).toBeGreaterThan(0);
		}
	});
});
