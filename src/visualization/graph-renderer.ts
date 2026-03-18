// Module: graph-renderer — Generate self-contained HTML visualization with D3.js

import type { SubgraphData } from "@/visualization/subgraph-extract";

/** Color palette by entity type category. */
const TYPE_COLORS: Record<string, string> = {
	FileNode: "#4A90D9",
	CodeEntity: "#4A90D9",
	PackageNode: "#4A90D9",
	Decision: "#5DB85D",
	Convention: "#5DB85D",
	Bug: "#5DB85D",
	Solution: "#5DB85D",
	Concept: "#5DB85D",
	Community: "#9B59B6",
	ContentChunk: "#E67E22",
	Dependency: "#95A5A6",
};

const CATEGORY_LABELS: Array<{ label: string; color: string; types: string[] }> = [
	{ label: "Structural", color: "#4A90D9", types: ["FileNode", "CodeEntity", "PackageNode"] },
	{
		label: "Semantic",
		color: "#5DB85D",
		types: ["Decision", "Convention", "Bug", "Solution", "Concept"],
	},
	{ label: "Community", color: "#9B59B6", types: ["Community"] },
	{ label: "Content", color: "#E67E22", types: ["ContentChunk"] },
	{ label: "Other", color: "#95A5A6", types: ["Dependency"] },
];

const DEFAULT_COLOR = "#95A5A6";

/**
 * Generate a self-contained HTML file with D3.js force-directed graph visualization.
 * All CSS is inlined. D3 v7 is loaded from CDN.
 */
export function renderGraphHtml(data: SubgraphData, title?: string): string {
	const pageTitle = title ?? "Sia Knowledge Graph";
	const nodesJson = JSON.stringify(data.nodes);
	const edgesJson = JSON.stringify(data.edges);
	const typeColorsJson = JSON.stringify(TYPE_COLORS);
	const defaultColor = DEFAULT_COLOR;

	// Build legend HTML
	const legendHtml = CATEGORY_LABELS.map(
		(cat) =>
			`<div class="legend-item">
				<span class="legend-dot" style="background:${cat.color}"></span>
				<span class="legend-label">${cat.label} (${cat.types.join(", ")})</span>
			</div>`,
	).join("\n");

	// Build type checkboxes for filter panel
	const allTypes = [...new Set(data.nodes.map((n) => n.type))].sort();
	const filterCheckboxes = allTypes
		.map(
			(t) =>
				`<label class="filter-checkbox">
				<input type="checkbox" value="${t}" checked onchange="applyFilters()"> ${t}
			</label>`,
		)
		.join("\n");

	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(pageTitle)}</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #1a1a2e; color: #e0e0e0; overflow: hidden; }
#graph-container { width: 100vw; height: 100vh; }
svg { width: 100%; height: 100%; }
.controls { position: fixed; top: 16px; left: 16px; z-index: 10; display: flex; flex-direction: column; gap: 8px; }
.search-box { padding: 8px 12px; border-radius: 6px; border: 1px solid #444; background: #2a2a4a; color: #e0e0e0; font-size: 14px; width: 240px; }
.search-box::placeholder { color: #888; }
.panel { position: fixed; top: 16px; right: 16px; z-index: 10; background: #2a2a4a; border: 1px solid #444; border-radius: 8px; padding: 16px; max-width: 320px; max-height: 80vh; overflow-y: auto; }
.panel h2 { font-size: 16px; margin-bottom: 8px; color: #fff; }
.panel h3 { font-size: 14px; margin-bottom: 4px; color: #ccc; }
.panel p { font-size: 12px; color: #aaa; margin-bottom: 4px; }
.panel .node-type { font-size: 11px; padding: 2px 8px; border-radius: 10px; display: inline-block; margin-bottom: 8px; }
.info-panel { display: none; }
.info-panel.visible { display: block; }
.legend { position: fixed; bottom: 16px; left: 16px; z-index: 10; background: #2a2a4a; border: 1px solid #444; border-radius: 8px; padding: 12px 16px; }
.legend-item { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.legend-dot { width: 12px; height: 12px; border-radius: 50%; flex-shrink: 0; }
.legend-label { font-size: 12px; color: #ccc; }
.filter-panel { position: fixed; bottom: 16px; right: 16px; z-index: 10; background: #2a2a4a; border: 1px solid #444; border-radius: 8px; padding: 12px 16px; }
.filter-panel h3 { font-size: 13px; margin-bottom: 8px; color: #fff; }
.filter-checkbox { display: block; font-size: 12px; color: #ccc; margin-bottom: 4px; cursor: pointer; }
.filter-checkbox input { margin-right: 6px; }
.title-bar { position: fixed; top: 16px; left: 50%; transform: translateX(-50%); z-index: 10; font-size: 18px; font-weight: 600; color: #fff; text-shadow: 0 2px 4px rgba(0,0,0,0.5); }
.stats { font-size: 11px; color: #888; text-align: center; margin-top: 2px; }
line.edge { stroke-opacity: 0.4; }
line.edge:hover { stroke-opacity: 0.8; }
circle.node { cursor: pointer; stroke: #fff; stroke-width: 1.5; }
circle.node:hover { stroke-width: 3; }
circle.node.highlighted { stroke: #FFD700; stroke-width: 3; }
circle.node.dimmed { opacity: 0.15; }
line.edge.dimmed { opacity: 0.05; }
text.node-label { font-size: 10px; fill: #ccc; pointer-events: none; text-anchor: middle; }
text.node-label.dimmed { opacity: 0.1; }
</style>
</head>
<body>
<div class="title-bar">
	<div>${escapeHtml(pageTitle)}</div>
	<div class="stats" id="stats"></div>
</div>
<div class="controls">
	<input type="text" class="search-box" id="search" placeholder="Search nodes by name..." oninput="onSearch(this.value)">
</div>
<div class="panel info-panel" id="info-panel">
	<h2 id="info-name"></h2>
	<span class="node-type" id="info-type"></span>
	<p id="info-summary"></p>
	<p><strong>Importance:</strong> <span id="info-importance"></span></p>
	<p><strong>Trust Tier:</strong> <span id="info-trust"></span></p>
	<p><strong>ID:</strong> <span id="info-id" style="font-size:10px;word-break:break-all"></span></p>
</div>
<div class="legend">
	${legendHtml}
</div>
<div class="filter-panel" id="filter-panel">
	<h3>Filter by Type</h3>
	${filterCheckboxes}
</div>
<div id="graph-container"></div>
<script src="https://d3js.org/d3.v7.min.js"></script>
<script>
(function() {
	const rawNodes = ${nodesJson};
	const rawEdges = ${edgesJson};
	const typeColors = ${typeColorsJson};
	const defaultColor = "${defaultColor}";

	document.getElementById("stats").textContent =
		rawNodes.length + " nodes, " + rawEdges.length + " edges";

	// Build working copies
	let nodes = rawNodes.map(function(n) { return Object.assign({}, n); });
	let edges = rawEdges.map(function(e) { return Object.assign({}, e, { source: e.from_id, target: e.to_id }); });

	const nodeById = new Map();
	nodes.forEach(function(n) { nodeById.set(n.id, n); });

	// Filter edges to only include those whose endpoints exist
	edges = edges.filter(function(e) { return nodeById.has(e.source) && nodeById.has(e.target); });

	const width = window.innerWidth;
	const height = window.innerHeight;

	const svg = d3.select("#graph-container")
		.append("svg")
		.attr("width", width)
		.attr("height", height);

	const g = svg.append("g");

	// Zoom
	const zoom = d3.zoom()
		.scaleExtent([0.1, 8])
		.on("zoom", function(event) { g.attr("transform", event.transform); });
	svg.call(zoom);

	// Simulation
	const simulation = d3.forceSimulation(nodes)
		.force("link", d3.forceLink(edges).id(function(d) { return d.id; }).distance(80))
		.force("charge", d3.forceManyBody().strength(-200))
		.force("center", d3.forceCenter(width / 2, height / 2))
		.force("collision", d3.forceCollide().radius(function(d) { return nodeRadius(d) + 2; }));

	function nodeRadius(d) {
		return 5 + (d.importance || 0.5) * 15;
	}

	function nodeColor(d) {
		return typeColors[d.type] || defaultColor;
	}

	// Draw edges
	const edgeElements = g.append("g")
		.selectAll("line")
		.data(edges)
		.join("line")
		.attr("class", "edge")
		.attr("stroke", "#556")
		.attr("stroke-width", function(d) { return Math.max(1, (d.weight || 1) * 2); });

	// Draw nodes
	const nodeElements = g.append("g")
		.selectAll("circle")
		.data(nodes)
		.join("circle")
		.attr("class", "node")
		.attr("r", nodeRadius)
		.attr("fill", nodeColor)
		.on("click", function(event, d) { showInfo(d); })
		.call(d3.drag()
			.on("start", dragStarted)
			.on("drag", dragged)
			.on("end", dragEnded));

	// Draw labels
	const labelElements = g.append("g")
		.selectAll("text")
		.data(nodes)
		.join("text")
		.attr("class", "node-label")
		.text(function(d) { return d.name.length > 20 ? d.name.slice(0, 18) + "..." : d.name; })
		.attr("dy", function(d) { return nodeRadius(d) + 12; });

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

	// Drag handlers
	function dragStarted(event, d) {
		if (!event.active) simulation.alphaTarget(0.3).restart();
		d.fx = d.x;
		d.fy = d.y;
	}
	function dragged(event, d) {
		d.fx = event.x;
		d.fy = event.y;
	}
	function dragEnded(event, d) {
		if (!event.active) simulation.alphaTarget(0);
		d.fx = null;
		d.fy = null;
	}

	// Info panel
	function showInfo(d) {
		var panel = document.getElementById("info-panel");
		panel.classList.add("visible");
		document.getElementById("info-name").textContent = d.name;
		var typeEl = document.getElementById("info-type");
		typeEl.textContent = d.type;
		typeEl.style.background = nodeColor(d);
		typeEl.style.color = "#fff";
		document.getElementById("info-summary").textContent = d.summary || "(no summary)";
		document.getElementById("info-importance").textContent = d.importance.toFixed(2);
		document.getElementById("info-trust").textContent = d.trustTier;
		document.getElementById("info-id").textContent = d.id;
	}

	// Search
	window.onSearch = function(query) {
		var q = query.toLowerCase().trim();
		if (!q) {
			nodeElements.classed("highlighted", false).classed("dimmed", false);
			edgeElements.classed("dimmed", false);
			labelElements.classed("dimmed", false);
			return;
		}
		var matchIds = new Set();
		nodes.forEach(function(n) {
			if (n.name.toLowerCase().includes(q)) matchIds.add(n.id);
		});
		nodeElements.classed("highlighted", function(d) { return matchIds.has(d.id); });
		nodeElements.classed("dimmed", function(d) { return !matchIds.has(d.id); });
		edgeElements.classed("dimmed", function(d) {
			var sid = typeof d.source === "object" ? d.source.id : d.source;
			var tid = typeof d.target === "object" ? d.target.id : d.target;
			return !matchIds.has(sid) && !matchIds.has(tid);
		});
		labelElements.classed("dimmed", function(d) { return !matchIds.has(d.id); });
	};

	// Filter by type
	window.applyFilters = function() {
		var checkboxes = document.querySelectorAll(".filter-checkbox input");
		var activeTypes = new Set();
		checkboxes.forEach(function(cb) { if (cb.checked) activeTypes.add(cb.value); });

		nodeElements.style("display", function(d) { return activeTypes.has(d.type) ? null : "none"; });
		labelElements.style("display", function(d) { return activeTypes.has(d.type) ? null : "none"; });
		edgeElements.style("display", function(d) {
			var sid = typeof d.source === "object" ? d.source.id : d.source;
			var tid = typeof d.target === "object" ? d.target.id : d.target;
			var sn = nodeById.get(sid);
			var tn = nodeById.get(tid);
			return (sn && activeTypes.has(sn.type) && tn && activeTypes.has(tn.type)) ? null : "none";
		});
	};
})();
</script>
</body>
</html>`;
}

/** Escape HTML special characters. */
function escapeHtml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}
