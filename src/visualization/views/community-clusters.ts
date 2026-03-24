// Module: community-clusters — Generate community cluster view HTML with D3.js
//
// Grouped force layout where communities are visually clustered with
// colored convex hull boundaries. Clicking a community shows its members.

export interface CommunityData {
	communities: Array<{
		id: string;
		name: string;
		level: number;
		summary: string;
		memberCount: number;
	}>;
	members: Array<{
		entityId: string;
		communityId: string;
		entityName: string;
		entityType: string;
	}>;
}

function escapeHtml(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Generate a self-contained HTML page showing community clusters with hull boundaries.
 */
export function generateCommunityClusterHtml(data: CommunityData): string {
	const pageTitle = "SIA Community Clusters";
	const communitiesJson = JSON.stringify(data.communities);
	const membersJson = JSON.stringify(data.members);

	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(pageTitle)}</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #1a1a2e; color: #e0e0e0; overflow: hidden; }
#cluster-container { width: 100vw; height: 100vh; }
svg { width: 100%; height: 100%; }
.title-bar { position: fixed; top: 16px; left: 50%; transform: translateX(-50%); z-index: 10; font-size: 18px; font-weight: 600; color: #fff; text-shadow: 0 2px 4px rgba(0,0,0,0.5); }
.stats { font-size: 11px; color: #888; text-align: center; margin-top: 2px; }
.panel { position: fixed; top: 16px; right: 16px; z-index: 10; background: #2a2a4a; border: 1px solid #444; border-radius: 8px; padding: 16px; max-width: 340px; max-height: 80vh; overflow-y: auto; display: none; }
.panel.visible { display: block; }
.panel h2 { font-size: 16px; margin-bottom: 4px; color: #fff; }
.panel p { font-size: 12px; color: #aaa; margin-bottom: 8px; }
.panel .member-list { list-style: none; }
.panel .member-list li { font-size: 12px; color: #ccc; padding: 3px 0; border-bottom: 1px solid #333; }
.panel .member-type { font-size: 10px; color: #888; margin-left: 6px; }
path.hull { fill-opacity: 0.12; stroke-width: 2; stroke-opacity: 0.5; cursor: pointer; }
path.hull:hover { fill-opacity: 0.2; stroke-opacity: 0.8; }
circle.member-node { stroke: #fff; stroke-width: 1; cursor: pointer; }
circle.member-node:hover { stroke-width: 2.5; }
text.member-label { font-size: 9px; fill: #aaa; pointer-events: none; text-anchor: middle; }
text.community-label { font-size: 13px; font-weight: 600; fill: #fff; pointer-events: none; text-anchor: middle; text-shadow: 0 1px 3px rgba(0,0,0,0.7); }
</style>
</head>
<body>
<div class="title-bar">
	<div>${escapeHtml(pageTitle)}</div>
	<div class="stats" id="stats"></div>
</div>
<div class="panel" id="detail-panel">
	<h2 id="panel-name"></h2>
	<p id="panel-summary"></p>
	<ul class="member-list" id="panel-members"></ul>
</div>
<div id="cluster-container"></div>
<script src="https://d3js.org/d3.v7.min.js"></script>
<script>
(function() {
	var communities = ${communitiesJson};
	var members = ${membersJson};

	document.getElementById("stats").textContent =
		communities.length + " communities, " + members.length + " members";

	var colors = d3.scaleOrdinal(d3.schemeTableau10);
	var width = window.innerWidth;
	var height = window.innerHeight;

	// Build member nodes with community assignment
	var membersByCommunity = {};
	communities.forEach(function(c) { membersByCommunity[c.id] = []; });
	members.forEach(function(m) {
		if (!membersByCommunity[m.communityId]) membersByCommunity[m.communityId] = [];
		membersByCommunity[m.communityId].push(m);
	});

	// Create nodes for simulation
	var nodes = members.map(function(m) {
		return { id: m.entityId, name: m.entityName, type: m.entityType, communityId: m.communityId };
	});

	// Community centers for clustering force
	var commCenters = {};
	var angle = 0;
	var radius = Math.min(width, height) * 0.25;
	communities.forEach(function(c, i) {
		angle = (2 * Math.PI * i) / Math.max(communities.length, 1);
		commCenters[c.id] = { x: width / 2 + radius * Math.cos(angle), y: height / 2 + radius * Math.sin(angle) };
	});

	var svg = d3.select("#cluster-container")
		.append("svg")
		.attr("width", width)
		.attr("height", height);

	var g = svg.append("g");

	var zoom = d3.zoom()
		.scaleExtent([0.1, 8])
		.on("zoom", function(event) { g.attr("transform", event.transform); });
	svg.call(zoom);

	// Clustering force
	var simulation = d3.forceSimulation(nodes)
		.force("charge", d3.forceManyBody().strength(-60))
		.force("collision", d3.forceCollide().radius(12))
		.force("x", d3.forceX(function(d) { return (commCenters[d.communityId] || {x: width/2}).x; }).strength(0.3))
		.force("y", d3.forceY(function(d) { return (commCenters[d.communityId] || {y: height/2}).y; }).strength(0.3));

	// Hull layer
	var hullG = g.append("g");
	// Node layer
	var nodeG = g.append("g");
	// Label layer
	var labelG = g.append("g");
	// Community name layer
	var commLabelG = g.append("g");

	var nodeElements = nodeG.selectAll("circle").data(nodes).join("circle")
		.attr("class", "member-node")
		.attr("r", 7)
		.attr("fill", function(d) { return colors(d.communityId); })
		.on("click", function(event, d) { showCommunityDetail(d.communityId); })
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

	var memberLabels = labelG.selectAll("text").data(nodes).join("text")
		.attr("class", "member-label")
		.text(function(d) { return d.name.length > 15 ? d.name.slice(0, 13) + "..." : d.name; })
		.attr("dy", 18);

	// Convex hull computation
	function computeHulls() {
		var hulls = [];
		communities.forEach(function(c) {
			var pts = [];
			nodes.forEach(function(n) {
				if (n.communityId === c.id && n.x != null && n.y != null) {
					// Add padding points for a rounder hull
					pts.push([n.x - 15, n.y - 15]);
					pts.push([n.x + 15, n.y - 15]);
					pts.push([n.x - 15, n.y + 15]);
					pts.push([n.x + 15, n.y + 15]);
				}
			});
			if (pts.length >= 6) { // need at least 3 original points (6 padded)
				hulls.push({ id: c.id, name: c.name, path: d3.polygonHull(pts) });
			}
		});
		return hulls;
	}

	simulation.on("tick", function() {
		nodeElements.attr("cx", function(d) { return d.x; }).attr("cy", function(d) { return d.y; });
		memberLabels.attr("x", function(d) { return d.x; }).attr("y", function(d) { return d.y; });

		// Update hulls
		var hulls = computeHulls();
		var hullPaths = hullG.selectAll("path.hull").data(hulls, function(d) { return d.id; });
		hullPaths.enter().append("path")
			.attr("class", "hull")
			.attr("fill", function(d) { return colors(d.id); })
			.attr("stroke", function(d) { return colors(d.id); })
			.on("click", function(event, d) { showCommunityDetail(d.id); })
			.merge(hullPaths)
			.attr("d", function(d) {
				return d.path ? "M" + d.path.map(function(p) { return p.join(","); }).join("L") + "Z" : "";
			});
		hullPaths.exit().remove();

		// Update community labels at hull centers
		var commLabels = commLabelG.selectAll("text.community-label")
			.data(hulls, function(d) { return d.id; });
		commLabels.enter().append("text")
			.attr("class", "community-label")
			.merge(commLabels)
			.text(function(d) { return d.name; })
			.attr("x", function(d) {
				if (!d.path) return 0;
				return d3.mean(d.path, function(p) { return p[0]; });
			})
			.attr("y", function(d) {
				if (!d.path) return 0;
				return d3.mean(d.path, function(p) { return p[1]; }) - 20;
			});
		commLabels.exit().remove();
	});

	// Detail panel
	function showCommunityDetail(communityId) {
		var comm = communities.find(function(c) { return c.id === communityId; });
		if (!comm) return;
		var panel = document.getElementById("detail-panel");
		panel.classList.add("visible");
		document.getElementById("panel-name").textContent = comm.name;
		document.getElementById("panel-summary").textContent = comm.summary;

		var memberList = document.getElementById("panel-members");
		// Clear existing members safely
		while (memberList.firstChild) memberList.removeChild(memberList.firstChild);

		var communityMembers = membersByCommunity[communityId] || [];
		communityMembers.forEach(function(m) {
			var li = document.createElement("li");
			li.textContent = m.entityName;
			var typeSpan = document.createElement("span");
			typeSpan.className = "member-type";
			typeSpan.textContent = m.entityType;
			li.appendChild(typeSpan);
			memberList.appendChild(li);
		});
	}
})();
</script>
</body>
</html>`;
}
