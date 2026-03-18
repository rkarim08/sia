import { describe, expect, it } from "vitest";
import { detectCommunities } from "@/community/detection-bridge";

describe("detectCommunities", () => {
	it("returns backend: 'js-louvain' when native is unavailable", () => {
		const edges: Array<[number, number, number]> = [
			[0, 1, 1],
			[1, 2, 1],
			[3, 4, 1],
		];
		const result = detectCommunities(edges, 5);
		expect(result.backend).toBe("js-louvain");
	});

	it("returns membership array matching nodeCount", () => {
		const edges: Array<[number, number, number]> = [
			[0, 1, 1],
			[1, 2, 1],
			[3, 4, 1],
		];
		const nodeCount = 5;
		const result = detectCommunities(edges, nodeCount);

		expect(result.levels.length).toBeGreaterThan(0);
		expect(result.levels[0].membership.length).toBe(nodeCount);
	});

	it("finds communities in a graph with clear clusters", () => {
		// Two tight cliques {0,1,2,3} and {4,5,6,7}, connected by a single bridge.
		// Each clique has every pair connected with weight 4 (very strong intra-cluster ties).
		// The bridge weight is 1 (weak inter-cluster tie).
		const clique = (nodes: number[], w: number): Array<[number, number, number]> => {
			const out: Array<[number, number, number]> = [];
			for (let i = 0; i < nodes.length; i++) {
				for (let j = i + 1; j < nodes.length; j++) {
					out.push([nodes[i], nodes[j], w]);
					out.push([nodes[j], nodes[i], w]);
				}
			}
			return out;
		};

		const edges: Array<[number, number, number]> = [
			...clique([0, 1, 2, 3], 4), // dense first cluster
			[3, 4, 1], // bridge (one-directional to avoid pulling the clusters together)
			...clique([4, 5, 6, 7], 4), // dense second cluster
		];
		const nodeCount = 8;
		const result = detectCommunities(edges, nodeCount);

		expect(result.levels.length).toBeGreaterThan(0);
		const level0 = result.levels[0];
		expect(level0.membership.length).toBe(nodeCount);

		// Should detect at least 2 communities
		const communityIds = new Set(level0.membership);
		expect(communityIds.size).toBeGreaterThanOrEqual(2);

		// Nodes 0,1,2,3 should all be in the same community (full clique — strong signal)
		const comm0 = level0.membership[0];
		expect(level0.membership[1]).toBe(comm0);
		expect(level0.membership[2]).toBe(comm0);
		expect(level0.membership[3]).toBe(comm0);

		// Nodes 4,5,6,7 should all be in the same community
		const comm4 = level0.membership[4];
		expect(level0.membership[5]).toBe(comm4);
		expect(level0.membership[6]).toBe(comm4);
		expect(level0.membership[7]).toBe(comm4);

		// The two cliques should be in different communities
		expect(comm0).not.toBe(comm4);
	});

	it("reports valid modularity score", () => {
		const edges: Array<[number, number, number]> = [
			[0, 1, 1],
			[1, 2, 1],
		];
		const result = detectCommunities(edges, 3);
		for (const level of result.levels) {
			expect(typeof level.modularity).toBe("number");
			expect(level.modularity).toBeGreaterThanOrEqual(-1);
			expect(level.modularity).toBeLessThanOrEqual(1);
		}
	});

	it("handles isolated nodes (no edges)", () => {
		const edges: Array<[number, number, number]> = [];
		const nodeCount = 4;
		const result = detectCommunities(edges, nodeCount);

		expect(result.levels[0].membership.length).toBe(nodeCount);
		// Each isolated node is its own community
		const communities = new Set(result.levels[0].membership);
		expect(communities.size).toBe(nodeCount);
	});

	it("accepts custom resolutions", () => {
		const edges: Array<[number, number, number]> = [
			[0, 1, 1],
			[1, 2, 1],
			[2, 3, 1],
		];
		const result = detectCommunities(edges, 4, [1.5, 0.5]);
		expect(result.levels.length).toBe(2);
	});
});
