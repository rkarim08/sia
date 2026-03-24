import { describe, expect, it } from "vitest";
import { generateGraphExplorerHtml } from "@/visualization/views/graph-explorer";
import { generateTimelineHtml, type TimelineEvent } from "@/visualization/views/timeline";
import type { SubgraphData } from "@/visualization/subgraph-extract";

function makeTestData(nodeCount = 3): SubgraphData {
	const nodes = Array.from({ length: nodeCount }, (_, i) => ({
		id: `node-${i}`,
		type: i % 3 === 0 ? "FileNode" : i % 3 === 1 ? "Decision" : "Community",
		name: `Test Node ${i}`,
		summary: `Summary for node ${i}`,
		importance: 0.5 + i * 0.1,
		trustTier: (i % 4) + 1 as 1 | 2 | 3 | 4,
	}));
	const edges =
		nodeCount >= 2
			? [{ id: "edge-0", from_id: "node-0", to_id: "node-1", type: "imports", weight: 0.8 }]
			: [];
	return { nodes, edges };
}

describe("graph explorer view", () => {
	it("generates valid HTML with DOCTYPE", () => {
		const data = makeTestData();
		const html = generateGraphExplorerHtml(data);
		expect(html).toMatch(/^<!DOCTYPE html>/);
		expect(html).toContain("<html");
		expect(html).toContain("</html>");
	});

	it("includes D3.js CDN link", () => {
		const html = generateGraphExplorerHtml(makeTestData());
		expect(html).toContain("d3.v7");
		expect(html).toContain("https://d3js.org/d3.v7.min.js");
	});

	it("includes node data in script", () => {
		const data = makeTestData();
		const html = generateGraphExplorerHtml(data);
		expect(html).toContain("node-0");
		expect(html).toContain("Test Node 0");
		expect(html).toContain("Test Node 1");
	});

	it("includes trust tier filter controls", () => {
		const html = generateGraphExplorerHtml(makeTestData());
		expect(html).toContain("Trust Tier");
		// Should have tier checkboxes or filter controls
		expect(html).toContain("tier");
	});

	it("includes search box", () => {
		const html = generateGraphExplorerHtml(makeTestData());
		expect(html).toContain("search");
		expect(html).toContain("Search");
	});

	it("includes entity detail panel", () => {
		const html = generateGraphExplorerHtml(makeTestData());
		expect(html).toContain("info-panel");
		expect(html).toContain("info-name");
	});

	it("includes type filter checkboxes", () => {
		const data = makeTestData();
		const html = generateGraphExplorerHtml(data);
		expect(html).toContain("FileNode");
		expect(html).toContain("Decision");
		expect(html).toContain("applyFilters");
	});

	it("accepts custom title", () => {
		const html = generateGraphExplorerHtml(makeTestData(), { title: "Auth Graph" });
		expect(html).toContain("Auth Graph");
		expect(html).toContain("<title>Auth Graph</title>");
	});

	it("handles empty data", () => {
		const html = generateGraphExplorerHtml({ nodes: [], edges: [] });
		expect(html).toContain("<!DOCTYPE html>");
		// Stats are populated at runtime by JS; the JSON data should be empty arrays
		expect(html).toContain("[]");
	});

	it("includes community coloring references", () => {
		const html = generateGraphExplorerHtml(makeTestData());
		// Should reference community-based coloring in the code
		expect(html).toContain("communityId");
	});
});

function makeTimelineEvents(count = 3): TimelineEvent[] {
	const base = Date.now() - 86400_000 * 30; // 30 days ago
	return Array.from({ length: count }, (_, i) => ({
		id: `evt-${i}`,
		type: i % 2 === 0 ? "Decision" : "Bug",
		name: `Event ${i}`,
		created_at: base + i * 86400_000,
		invalidated_at: i === 1 ? base + (i + 10) * 86400_000 : undefined,
		kind: i % 2 === 0 ? "Decision" : "Bug",
	}));
}

describe("timeline view", () => {
	it("generates valid HTML with DOCTYPE", () => {
		const html = generateTimelineHtml(makeTimelineEvents());
		expect(html).toMatch(/^<!DOCTYPE html>/);
		expect(html).toContain("</html>");
	});

	it("includes D3.js CDN link", () => {
		const html = generateTimelineHtml(makeTimelineEvents());
		expect(html).toContain("d3.v7");
	});

	it("includes event data", () => {
		const html = generateTimelineHtml(makeTimelineEvents());
		expect(html).toContain("evt-0");
		expect(html).toContain("Event 0");
	});

	it("renders invalidated events differently", () => {
		const events = makeTimelineEvents();
		const html = generateTimelineHtml(events);
		// Should reference invalidated_at for faded rendering
		expect(html).toContain("invalidated_at");
	});

	it("supports custom title", () => {
		const html = generateTimelineHtml(makeTimelineEvents(), { title: "Bug Timeline" });
		expect(html).toContain("Bug Timeline");
	});

	it("handles empty events", () => {
		const html = generateTimelineHtml([]);
		expect(html).toContain("<!DOCTYPE html>");
	});

	it("includes zoom and pan support", () => {
		const html = generateTimelineHtml(makeTimelineEvents());
		expect(html).toContain("zoom");
	});

	it("includes time axis", () => {
		const html = generateTimelineHtml(makeTimelineEvents());
		// D3 time scale reference
		expect(html).toContain("scaleTime");
	});
});
