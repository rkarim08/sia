import { describe, expect, it } from "vitest";
import { renderGraphHtml } from "@/visualization/graph-renderer";
import type { SubgraphData } from "@/visualization/subgraph-extract";

describe("graph renderer", () => {
	function makeData(nodeCount: number): SubgraphData {
		const nodes = Array.from({ length: nodeCount }, (_, i) => ({
			id: `node-${i}`,
			type: i % 2 === 0 ? "FileNode" : "Decision",
			name: `Test Node ${i}`,
			summary: `Summary for node ${i}`,
			importance: 0.5 + i * 0.1,
			trustTier: 3,
		}));
		const edges =
			nodeCount >= 2
				? [
						{
							id: "edge-0",
							from_id: "node-0",
							to_id: "node-1",
							type: "relates_to",
							weight: 0.8,
						},
					]
				: [];
		return { nodes, edges };
	}

	// ---------------------------------------------------------------
	// Generates valid HTML with DOCTYPE
	// ---------------------------------------------------------------

	it("generates valid HTML with DOCTYPE", () => {
		const html = renderGraphHtml({ nodes: [], edges: [] });
		expect(html).toMatch(/^<!DOCTYPE html>/);
		expect(html).toContain("<html");
		expect(html).toContain("</html>");
		expect(html).toContain("<head>");
		expect(html).toContain("<body>");
	});

	// ---------------------------------------------------------------
	// Includes node data in script
	// ---------------------------------------------------------------

	it("includes node data in script", () => {
		const data = makeData(2);
		const html = renderGraphHtml(data);

		expect(html).toContain("node-0");
		expect(html).toContain("node-1");
		expect(html).toContain("Test Node 0");
		expect(html).toContain("Test Node 1");
	});

	// ---------------------------------------------------------------
	// Includes D3 CDN link
	// ---------------------------------------------------------------

	it("includes D3 CDN link", () => {
		const html = renderGraphHtml({ nodes: [], edges: [] });
		expect(html).toContain("d3.v7");
		expect(html).toContain("https://d3js.org/d3.v7.min.js");
	});

	// ---------------------------------------------------------------
	// Includes color legend
	// ---------------------------------------------------------------

	it("includes color legend", () => {
		const html = renderGraphHtml({ nodes: [], edges: [] });

		// Structural category
		expect(html).toContain("Structural");
		expect(html).toContain("#4A90D9");

		// Semantic category
		expect(html).toContain("Semantic");
		expect(html).toContain("#5DB85D");

		// Community category
		expect(html).toContain("Community");
		expect(html).toContain("#9B59B6");

		// Content category
		expect(html).toContain("Content");
		expect(html).toContain("#E67E22");
	});

	// ---------------------------------------------------------------
	// Renders with custom title
	// ---------------------------------------------------------------

	it("renders with custom title", () => {
		const html = renderGraphHtml({ nodes: [], edges: [] }, "Auth Graph");

		expect(html).toContain("Auth Graph");
		expect(html).toContain("<title>Auth Graph</title>");
	});
});
