import { describe, expect, it } from "vitest";
import { fallbackGraphCompute } from "@/native/fallback-graph";

describe("fallbackGraphCompute — pagerank", () => {
	it("hub node scores higher than leaf nodes", () => {
		// Star graph: nodes 0,1,2,3 where 1,2,3 all point to 0
		// So 0 is the hub (sink), receiving all edges
		// nodeIds: ["hub","leaf1","leaf2","leaf3"]
		// edges: leaf1->hub, leaf2->hub, leaf3->hub
		const edges = new Int32Array([1, 0, 2, 0, 3, 0]);
		const nodeIds = ["hub", "leaf1", "leaf2", "leaf3"];

		const result = fallbackGraphCompute(edges, nodeIds, {
			kind: "pagerank",
			damping: 0.85,
			iterations: 50,
		});

		expect(result.scores).toBeInstanceOf(Float64Array);
		expect(result.node_ids).toEqual(nodeIds);
		expect(result.scores.length).toBe(4);

		const hubScore = result.scores[0];
		const leaf1Score = result.scores[1];
		const leaf2Score = result.scores[2];
		const leaf3Score = result.scores[3];

		// Hub should score higher than any leaf
		expect(hubScore).toBeGreaterThan(leaf1Score);
		expect(hubScore).toBeGreaterThan(leaf2Score);
		expect(hubScore).toBeGreaterThan(leaf3Score);
	});

	it("equal scores in a cycle", () => {
		// Cycle: 0->1->2->0
		const edges = new Int32Array([0, 1, 1, 2, 2, 0]);
		const nodeIds = ["A", "B", "C"];

		const result = fallbackGraphCompute(edges, nodeIds, {
			kind: "pagerank",
			damping: 0.85,
			iterations: 100,
		});

		const scores = Array.from(result.scores);
		const mean = scores.reduce((a, b) => a + b, 0) / scores.length;

		// In a perfect cycle all scores converge to equal — allow small tolerance
		for (const s of scores) {
			expect(Math.abs(s - mean)).toBeLessThan(0.01);
		}
	});

	it("handles empty graph gracefully", () => {
		const edges = new Int32Array([]);
		const nodeIds: string[] = [];

		const result = fallbackGraphCompute(edges, nodeIds, {
			kind: "pagerank",
			damping: 0.85,
			iterations: 30,
		});

		expect(result.scores.length).toBe(0);
		expect(result.node_ids).toEqual([]);
	});
});

describe("fallbackGraphCompute — shortest_path", () => {
	it("computes correct distances from source", () => {
		// Chain graph: 0->1->2->3 (no shortcut)
		// S->M1=1, S->M2=2, S->T=3
		const edges = new Int32Array([0, 1, 1, 2, 2, 3]);
		const nodeIds = ["S", "M1", "M2", "T"];

		const result = fallbackGraphCompute(edges, nodeIds, {
			kind: "shortest_path",
			source: "S",
		});

		expect(result.node_ids).toEqual(nodeIds);
		const distS = result.scores[0];
		const distM1 = result.scores[1];
		const distM2 = result.scores[2];
		const distT = result.scores[3];

		expect(distS).toBe(0);
		expect(distM1).toBe(1);
		expect(distM2).toBe(2);
		expect(distT).toBe(3);
	});

	it("unreachable nodes get Infinity", () => {
		// Disconnected: 0->1, node 2 is isolated
		const edges = new Int32Array([0, 1]);
		const nodeIds = ["A", "B", "C"];

		const result = fallbackGraphCompute(edges, nodeIds, {
			kind: "shortest_path",
			source: "A",
		});

		expect(result.scores[0]).toBe(0);
		expect(result.scores[1]).toBe(1);
		expect(result.scores[2]).toBe(Number.POSITIVE_INFINITY);
	});
});

describe("fallbackGraphCompute — connected_components", () => {
	it("correctly identifies connected components", () => {
		// Two separate components: {0,1,2} and {3,4}
		// edges: 0<->1, 1<->2, 3<->4
		const edges = new Int32Array([0, 1, 1, 0, 1, 2, 2, 1, 3, 4, 4, 3]);
		const nodeIds = ["A", "B", "C", "D", "E"];

		const result = fallbackGraphCompute(edges, nodeIds, {
			kind: "connected_components",
		});

		expect(result.scores.length).toBe(5);
		// Nodes in same component should have same label
		expect(result.scores[0]).toBe(result.scores[1]);
		expect(result.scores[1]).toBe(result.scores[2]);
		expect(result.scores[3]).toBe(result.scores[4]);
		// Different components should have different labels
		expect(result.scores[0]).not.toBe(result.scores[3]);
	});

	it("single node is its own component", () => {
		const edges = new Int32Array([]);
		const nodeIds = ["solo"];

		const result = fallbackGraphCompute(edges, nodeIds, {
			kind: "connected_components",
		});

		expect(result.scores.length).toBe(1);
		expect(result.scores[0]).toBe(0);
	});
});

describe("fallbackGraphCompute — betweenness_centrality", () => {
	it("bridge node has higher centrality than endpoints", () => {
		// Path graph: 0-1-2, node 1 is the bridge
		const edges = new Int32Array([0, 1, 1, 0, 1, 2, 2, 1]);
		const nodeIds = ["A", "B", "C"];

		const result = fallbackGraphCompute(edges, nodeIds, {
			kind: "betweenness_centrality",
		});

		expect(result.scores.length).toBe(3);
		// B (index 1) is the bridge between A and C
		const scoreA = result.scores[0];
		const scoreB = result.scores[1];
		const scoreC = result.scores[2];

		expect(scoreB).toBeGreaterThan(scoreA);
		expect(scoreB).toBeGreaterThan(scoreC);
	});
});
