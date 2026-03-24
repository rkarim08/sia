// Module: timeline — Generate temporal timeline HTML visualization with D3.js
//
// Shows entities on a horizontal time axis with colored dots/bars by type.
// Invalidated entities appear as faded bars from created → invalidated.

export interface TimelineEvent {
	id: string;
	type: string;
	name: string;
	created_at: number;
	invalidated_at?: number;
	kind?: string;
}

const TYPE_COLORS: Record<string, string> = {
	Decision: "#5DB85D",
	Convention: "#5DB85D",
	Bug: "#E74C3C",
	Solution: "#2ECC71",
	FileNode: "#4A90D9",
	CodeEntity: "#4A90D9",
	Community: "#9B59B6",
	Concept: "#5DB85D",
	ContentChunk: "#E67E22",
};

const DEFAULT_COLOR = "#95A5A6";

function escapeHtml(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Generate a self-contained HTML page with a temporal timeline of events.
 */
export function generateTimelineHtml(
	events: TimelineEvent[],
	opts?: { title?: string; since?: number },
): string {
	const pageTitle = opts?.title ?? "SIA Timeline";
	const eventsJson = JSON.stringify(events);
	const typeColorsJson = JSON.stringify(TYPE_COLORS);

	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(pageTitle)}</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #1a1a2e; color: #e0e0e0; overflow: hidden; }
#timeline-container { width: 100vw; height: 100vh; }
svg { width: 100%; height: 100%; }
.title-bar { position: fixed; top: 16px; left: 50%; transform: translateX(-50%); z-index: 10; font-size: 18px; font-weight: 600; color: #fff; text-shadow: 0 2px 4px rgba(0,0,0,0.5); }
.stats { font-size: 11px; color: #888; text-align: center; margin-top: 2px; }
.tooltip { position: absolute; background: #2a2a4a; border: 1px solid #444; border-radius: 6px; padding: 10px 14px; font-size: 12px; color: #e0e0e0; pointer-events: none; opacity: 0; transition: opacity 0.15s; z-index: 20; max-width: 300px; }
.tooltip .tt-name { font-weight: 600; color: #fff; margin-bottom: 4px; }
.tooltip .tt-type { font-size: 11px; padding: 1px 6px; border-radius: 8px; display: inline-block; margin-bottom: 4px; }
.tooltip .tt-date { font-size: 11px; color: #888; }
.legend { position: fixed; bottom: 16px; left: 16px; z-index: 10; background: #2a2a4a; border: 1px solid #444; border-radius: 8px; padding: 12px 16px; }
.legend-item { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.legend-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
.legend-label { font-size: 11px; color: #ccc; }
.axis text { fill: #888; font-size: 11px; }
.axis line, .axis path { stroke: #444; }
</style>
</head>
<body>
<div class="title-bar">
	<div>${escapeHtml(pageTitle)}</div>
	<div class="stats" id="stats"></div>
</div>
<div class="tooltip" id="tooltip"></div>
<div class="legend" id="legend"></div>
<div id="timeline-container"></div>
<script src="https://d3js.org/d3.v7.min.js"></script>
<script>
(function() {
	var events = ${eventsJson};
	var typeColors = ${typeColorsJson};
	var defaultColor = "${DEFAULT_COLOR}";

	document.getElementById("stats").textContent = events.length + " events";

	// Build legend from unique types using safe DOM methods
	var types = [...new Set(events.map(function(e) { return e.type; }))].sort();
	var legendEl = document.getElementById("legend");
	types.forEach(function(t) {
		var item = document.createElement("div");
		item.className = "legend-item";
		var dot = document.createElement("span");
		dot.className = "legend-dot";
		dot.style.background = typeColors[t] || defaultColor;
		var label = document.createElement("span");
		label.className = "legend-label";
		label.textContent = t;
		item.appendChild(dot);
		item.appendChild(label);
		legendEl.appendChild(item);
	});

	var width = window.innerWidth;
	var height = window.innerHeight;
	var margin = { top: 80, right: 40, bottom: 60, left: 40 };
	var innerW = width - margin.left - margin.right;
	var innerH = height - margin.top - margin.bottom;

	var svg = d3.select("#timeline-container")
		.append("svg")
		.attr("width", width)
		.attr("height", height);

	var g = svg.append("g").attr("transform", "translate(" + margin.left + "," + margin.top + ")");

	// Time scale
	var allTimes = [];
	events.forEach(function(e) {
		allTimes.push(e.created_at);
		if (e.invalidated_at) allTimes.push(e.invalidated_at);
	});
	if (allTimes.length === 0) allTimes = [Date.now() - 86400000, Date.now()];

	var xScale = d3.scaleTime()
		.domain([d3.min(allTimes), d3.max(allTimes)])
		.range([0, innerW])
		.nice();

	// Y positions: spread events vertically by type
	var typeIndex = {};
	types.forEach(function(t, i) { typeIndex[t] = i; });
	var yBand = innerH / Math.max(types.length, 1);

	// X axis
	g.append("g")
		.attr("class", "axis")
		.attr("transform", "translate(0," + innerH + ")")
		.call(d3.axisBottom(xScale).ticks(8));

	// Zoom
	var zoomG = g.append("g");
	var zoom = d3.zoom()
		.scaleExtent([0.5, 20])
		.translateExtent([[-100, -100], [innerW + 100, innerH + 100]])
		.on("zoom", function(event) {
			var newX = event.transform.rescaleX(xScale);
			zoomG.selectAll(".event-bar")
				.attr("x", function(d) { return newX(d.created_at); })
				.attr("width", function(d) {
					return d.invalidated_at ? Math.max(2, newX(d.invalidated_at) - newX(d.created_at)) : 0;
				});
			zoomG.selectAll(".event-dot")
				.attr("cx", function(d) { return newX(d.created_at); });
			zoomG.selectAll(".event-label")
				.attr("x", function(d) { return newX(d.created_at) + 8; });
			g.select(".axis").call(d3.axisBottom(newX).ticks(8));
		});
	svg.call(zoom);

	var tooltipEl = document.getElementById("tooltip");

	function showTooltip(event, d) {
		var created = new Date(d.created_at).toLocaleDateString();
		// Build tooltip content safely using DOM methods
		tooltipEl.textContent = "";
		var nameDiv = document.createElement("div");
		nameDiv.className = "tt-name";
		nameDiv.textContent = d.name;
		tooltipEl.appendChild(nameDiv);

		var typeSpan = document.createElement("span");
		typeSpan.className = "tt-type";
		typeSpan.style.background = typeColors[d.type] || defaultColor;
		typeSpan.style.color = "#fff";
		typeSpan.textContent = d.type;
		tooltipEl.appendChild(typeSpan);

		var dateDiv = document.createElement("div");
		dateDiv.className = "tt-date";
		dateDiv.textContent = "Created: " + created;
		tooltipEl.appendChild(dateDiv);

		if (d.invalidated_at) {
			var invDiv = document.createElement("div");
			invDiv.className = "tt-date";
			invDiv.style.color = "#E74C3C";
			invDiv.textContent = "Invalidated: " + new Date(d.invalidated_at).toLocaleDateString();
			tooltipEl.appendChild(invDiv);
		}

		tooltipEl.style.opacity = 1;
		tooltipEl.style.left = (event.pageX + 12) + "px";
		tooltipEl.style.top = (event.pageY - 10) + "px";
	}

	function hideTooltip() { tooltipEl.style.opacity = 0; }

	// Draw invalidated bars (faded)
	zoomG.selectAll(".event-bar")
		.data(events.filter(function(e) { return !!e.invalidated_at; }))
		.join("rect")
		.attr("class", "event-bar")
		.attr("x", function(d) { return xScale(d.created_at); })
		.attr("y", function(d) { return (typeIndex[d.type] || 0) * yBand + yBand * 0.3; })
		.attr("width", function(d) { return Math.max(2, xScale(d.invalidated_at) - xScale(d.created_at)); })
		.attr("height", yBand * 0.4)
		.attr("rx", 3)
		.attr("fill", function(d) { return typeColors[d.type] || defaultColor; })
		.attr("opacity", 0.25)
		.on("mouseover", showTooltip)
		.on("mouseout", hideTooltip);

	// Draw event dots
	zoomG.selectAll(".event-dot")
		.data(events)
		.join("circle")
		.attr("class", "event-dot")
		.attr("cx", function(d) { return xScale(d.created_at); })
		.attr("cy", function(d) { return (typeIndex[d.type] || 0) * yBand + yBand * 0.5; })
		.attr("r", 6)
		.attr("fill", function(d) { return typeColors[d.type] || defaultColor; })
		.attr("stroke", "#fff")
		.attr("stroke-width", 1.5)
		.attr("opacity", function(d) { return d.invalidated_at ? 0.4 : 1; })
		.attr("cursor", "pointer")
		.on("mouseover", showTooltip)
		.on("mouseout", hideTooltip);

	// Draw labels
	zoomG.selectAll(".event-label")
		.data(events)
		.join("text")
		.attr("class", "event-label")
		.attr("x", function(d) { return xScale(d.created_at) + 8; })
		.attr("y", function(d) { return (typeIndex[d.type] || 0) * yBand + yBand * 0.55; })
		.attr("fill", function(d) { return d.invalidated_at ? "#666" : "#ccc"; })
		.attr("font-size", "10px")
		.text(function(d) { return d.name.length > 25 ? d.name.slice(0, 23) + "..." : d.name; });
})();
</script>
</body>
</html>`;
}
