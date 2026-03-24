// Module: dependency-map — Generate file dependency map HTML with D3.js
//
// Hierarchical force-directed graph showing file-level dependencies
// (imports/calls edges). Directional arrows show dependency direction.

import type { SubgraphData } from "@/visualization/subgraph-extract";

const TYPE_COLORS: Record<string, string> = {
	FileNode: "#4A90D9",
	CodeEntity: "#4A90D9",
	PackageNode: "#E67E22",
	Decision: "#5DB85D",
	Convention: "#5DB85D",
	Bug: "#E74C3C",
	Solution: "#2ECC71",
};

const DEFAULT_COLOR = "#95A5A6";

function escapeHtml(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Generate a self-contained HTML page showing file dependency relationships.
 */
export function generateDependencyMapHtml(
	data: SubgraphData,
	opts?: { rootFile?: string },
): string {
	const pageTitle = opts?.rootFile
		? `Dependencies: ${opts.rootFile}`
		: "SIA Dependency Map";
	const nodesJson = JSON.stringify(data.nodes);
	const edgesJson = JSON.stringify(data.edges);
	const typeColorsJson = JSON.stringify(TYPE_COLORS);
	const rootFile = opts?.rootFile ?? "";

	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(pageTitle)}</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #1a1a2e; color: #e0e0e0; overflow: hidden; }
#dep-container { width: 100vw; height: 100vh; }
svg { width: 100%; height: 100%; }
.title-bar { position: fixed; top: 16px; left: 50%; transform: translateX(-50%); z-index: 10; font-size: 18px; font-weight: 600; color: #fff; text-shadow: 0 2px 4px rgba(0,0,0,0.5); }
.stats { font-size: 11px; color: #888; text-align: center; margin-top: 2px; }
.tooltip { position: absolute; background: #2a2a4a; border: 1px solid #444; border-radius: 6px; padding: 10px 14px; font-size: 12px; color: #e0e0e0; pointer-events: none; opacity: 0; transition: opacity 0.15s; z-index: 20; max-width: 300px; }
line.dep-edge { stroke-opacity: 0.5; }
line.dep-edge:hover { stroke-opacity: 0.9; }
circle.dep-node { cursor: pointer; stroke: #fff; stroke-width: 1.5; }
circle.dep-node:hover { stroke-width: 3; }
circle.dep-node.root { stroke: #e94560; stroke-width: 3; }
text.dep-label { font-size: 10px; fill: #ccc; pointer-events: none; text-anchor: middle; }
marker { fill: #888; }
</style>
</head>
<body>
<div class="title-bar">
	<div>${escapeHtml(pageTitle)}</div>
	<div class="stats" id="stats"></div>
</div>
<div class="tooltip" id="tooltip"></div>
<div id="dep-container"></div>
<script src="https://d3js.org/d3.v7.min.js"></script>
<script>
(function() {
	var rawNodes = ${nodesJson};
	var rawEdges = ${edgesJson};
	var typeColors = ${typeColorsJson};
	var defaultColor = "${DEFAULT_COLOR}";
	var rootFile = "${escapeHtml(rootFile)}";

	document.getElementById("stats").textContent =
		rawNodes.length + " files, " + rawEdges.length + " dependencies";

	var nodes = rawNodes.map(function(n) { return Object.assign({}, n); });
	var edges = rawEdges.map(function(e) {
		return Object.assign({}, e, { source: e.from_id, target: e.to_id });
	});

	var nodeById = new Map();
	nodes.forEach(function(n) { nodeById.set(n.id, n); });
	edges = edges.filter(function(e) { return nodeById.has(e.source) && nodeById.has(e.target); });

	var width = window.innerWidth;
	var height = window.innerHeight;

	var svg = d3.select("#dep-container")
		.append("svg")
		.attr("width", width)
		.attr("height", height);

	// Arrow marker for directed edges
	svg.append("defs").append("marker")
		.attr("id", "arrow")
		.attr("viewBox", "0 -5 10 10")
		.attr("refX", 20)
		.attr("refY", 0)
		.attr("markerWidth", 6)
		.attr("markerHeight", 6)
		.attr("orient", "auto")
		.append("path")
		.attr("d", "M0,-5L10,0L0,5")
		.attr("fill", "#888");

	var g = svg.append("g");

	var zoom = d3.zoom()
		.scaleExtent([0.1, 8])
		.on("zoom", function(event) { g.attr("transform", event.transform); });
	svg.call(zoom);

	var simulation = d3.forceSimulation(nodes)
		.force("link", d3.forceLink(edges).id(function(d) { return d.id; }).distance(120))
		.force("charge", d3.forceManyBody().strength(-300))
		.force("center", d3.forceCenter(width / 2, height / 2))
		.force("collision", d3.forceCollide().radius(20));

	function nodeRadius(d) { return 6 + (d.importance || 0.5) * 12; }
	function nodeColor(d) { return typeColors[d.type] || defaultColor; }

	var edgeElements = g.append("g").selectAll("line").data(edges).join("line")
		.attr("class", "dep-edge")
		.attr("stroke", "#556")
		.attr("stroke-width", 1.5)
		.attr("marker-end", "url(#arrow)");

	var nodeElements = g.append("g").selectAll("circle").data(nodes).join("circle")
		.attr("class", function(d) {
			return "dep-node" + (rootFile && d.name === rootFile ? " root" : "");
		})
		.attr("r", nodeRadius)
		.attr("fill", nodeColor)
		.call(d3.drag()
			.on("start", function(event, d) {
				if (!event.active) simulation.alphaTarget(0.3).restart();
				d.fx = d.x; d.fy = d.y;
			})
			.on("drag", function(event, d) { d.fx = event.x; d.fy = event.y; })
			.on("end", function(event, d) {
				if (!event.active) simulation.alphaTarget(0);
				d.fx = null; d.fy = null;
			}));

	var labelElements = g.append("g").selectAll("text").data(nodes).join("text")
		.attr("class", "dep-label")
		.text(function(d) {
			var name = d.name;
			// Show just filename for paths
			var parts = name.split("/");
			var short = parts[parts.length - 1];
			return short.length > 20 ? short.slice(0, 18) + "..." : short;
		})
		.attr("dy", function(d) { return nodeRadius(d) + 14; });

	var tooltipEl = document.getElementById("tooltip");

	nodeElements.on("mouseover", function(event, d) {
		tooltipEl.textContent = d.name + " (" + d.type + ")";
		tooltipEl.style.opacity = 1;
		tooltipEl.style.left = (event.pageX + 12) + "px";
		tooltipEl.style.top = (event.pageY - 10) + "px";
	}).on("mouseout", function() { tooltipEl.style.opacity = 0; });

	simulation.on("tick", function() {
		edgeElements
			.attr("x1", function(d) { return d.source.x; })
			.attr("y1", function(d) { return d.source.y; })
			.attr("x2", function(d) { return d.target.x; })
			.attr("y2", function(d) { return d.target.y; });
		nodeElements
			.attr("cx", function(d) { return d.x; })
			.attr("cy", function(d) { return d.y; });
		labelElements
			.attr("x", function(d) { return d.x; })
			.attr("y", function(d) { return d.y; });
	});
})();
</script>
</body>
</html>`;
}
