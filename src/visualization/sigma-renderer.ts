// Module: sigma-renderer — Generate self-contained HTML visualization with Sigma.js 3 + Graphology
//
// Replaces the D3.js SVG renderer with a WebGL-based renderer capable of handling
// large graphs (10k+ nodes). The output is a single HTML file with CDN-loaded
// dependencies that can be opened directly in a browser.
//
// Note: The generated HTML uses innerHTML for building UI from internal graph data
// (node types, edge types, file paths). All data originates from the local Sia
// database and is serialized via JSON.stringify, not from external user input.

import type { SubgraphData } from "@/visualization/subgraph-extract";

export interface RenderOpts {
	title?: string;
}

function escapeHtml(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

export function renderSigmaHtml(data: SubgraphData, opts?: RenderOpts): string {
	const title = opts?.title ?? "Sia Knowledge Graph";
	const nodesJson = JSON.stringify(data.nodes);
	const edgesJson = JSON.stringify(data.edges);
	const communitiesJson = JSON.stringify(data.communities ?? []);

	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(title)}</title>
<script src="https://cdn.jsdelivr.net/npm/graphology@0.26.0/dist/graphology.umd.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/sigma@3.0.2/build/sigma.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/graphology-layout-forceatlas2@0.10.1/build/graphology-layout-forceatlas2.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/graphology-layout-noverlap@0.4.2/build/graphology-layout-noverlap.min.js"></script>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: 100%; height: 100%; overflow: hidden; font-family: 'Inter', -apple-system, sans-serif; background: #1a1a2e; color: #e0e0e0; }
#app { display: grid; grid-template-columns: 280px 1fr 320px; height: 100vh; }
#sidebar-left { background: #2a2a4a; border-right: 1px solid #444; overflow-y: auto; padding: 12px; }
#graph-container { position: relative; }
#sigma-container { width: 100%; height: 100%; }
#sidebar-right { background: #2a2a4a; border-left: 1px solid #444; overflow-y: auto; padding: 12px; }
.search-overlay { position: absolute; top: 16px; left: 50%; transform: translateX(-50%); z-index: 100; }
.search-input { background: #2a2a4a; border: 1px solid #555; color: #e0e0e0; padding: 8px 16px; border-radius: 8px; width: 320px; font-size: 14px; }
.search-input::placeholder { color: #888; }
.search-results { background: #2a2a4a; border: 1px solid #555; border-radius: 8px; margin-top: 4px; max-height: 300px; overflow-y: auto; }
.search-result-item { padding: 8px 16px; cursor: pointer; font-size: 13px; }
.search-result-item:hover, .search-result-item.selected { background: #3a3a6a; }
.zoom-toolbar { position: absolute; bottom: 16px; right: 16px; display: flex; flex-direction: column; gap: 4px; z-index: 100; }
.zoom-btn { background: #2a2a4a; border: 1px solid #555; color: #e0e0e0; width: 36px; height: 36px; border-radius: 6px; cursor: pointer; font-size: 16px; display: flex; align-items: center; justify-content: center; }
.zoom-btn:hover { background: #3a3a6a; }
.detail-panel { display: none; }
.detail-panel.active { display: block; }
.type-badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; color: #fff; }
.filter-group { margin-bottom: 12px; }
.filter-item { display: flex; align-items: center; gap: 8px; padding: 4px 0; cursor: pointer; font-size: 13px; }
.filter-item input[type="checkbox"] { margin: 0; }
.color-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
.tab-bar { display: flex; border-bottom: 1px solid #444; margin-bottom: 12px; }
.tab { padding: 8px 16px; cursor: pointer; border-bottom: 2px solid transparent; font-size: 13px; }
.tab.active { border-bottom-color: #6c63ff; color: #6c63ff; }
.file-tree-item { padding: 4px 0; cursor: pointer; font-size: 13px; }
.file-tree-item:hover { color: #6c63ff; }
h4.section-title { margin-bottom: 8px; font-size: 12px; text-transform: uppercase; color: #888; }
#detail-edges div { font-size: 12px; padding: 2px 0; cursor: pointer; }
#detail-edges div:hover { color: #6c63ff; }
</style>
</head>
<body>
<div id="app">
  <div id="sidebar-left">
    <div class="tab-bar">
      <div class="tab active" data-tab="explorer" onclick="switchTab('explorer')">Explorer</div>
      <div class="tab" data-tab="filters" onclick="switchTab('filters')">Filters</div>
    </div>
    <div id="tab-explorer" class="tab-content">
      <input type="text" id="tree-search" placeholder="Filter files..." style="width:100%;padding:6px;background:#1a1a2e;border:1px solid #555;color:#e0e0e0;border-radius:4px;margin-bottom:8px;font-size:13px;">
      <div id="file-tree"></div>
    </div>
    <div id="tab-filters" class="tab-content" style="display:none;">
      <div class="filter-group">
        <h4 class="section-title">Node Types</h4>
        <div id="node-type-filters"></div>
      </div>
      <div class="filter-group">
        <h4 class="section-title">Edge Types</h4>
        <div id="edge-type-filters"></div>
      </div>
      <div class="filter-group">
        <h4 class="section-title">Depth Filter</h4>
        <div id="depth-filter" style="display:flex;gap:4px;flex-wrap:wrap;">
          <button class="zoom-btn" onclick="setDepthFilter(1)" style="width:auto;padding:4px 12px;height:auto;">1-hop</button>
          <button class="zoom-btn" onclick="setDepthFilter(2)" style="width:auto;padding:4px 12px;height:auto;">2-hop</button>
          <button class="zoom-btn" onclick="setDepthFilter(3)" style="width:auto;padding:4px 12px;height:auto;">3-hop</button>
          <button class="zoom-btn" onclick="setDepthFilter('all')" style="width:auto;padding:4px 12px;height:auto;">All</button>
        </div>
      </div>
    </div>
  </div>
  <div id="graph-container">
    <div id="sigma-container"></div>
    <div class="search-overlay">
      <input type="text" class="search-input" id="search-input" placeholder="Search nodes (Cmd+K)...">
      <div class="search-results" id="search-results" style="display:none;"></div>
    </div>
    <div class="zoom-toolbar">
      <button class="zoom-btn" onclick="zoomIn()" title="Zoom In">+</button>
      <button class="zoom-btn" onclick="zoomOut()" title="Zoom Out">&minus;</button>
      <button class="zoom-btn" onclick="zoomFit()" title="Fit">&squ;</button>
      <button class="zoom-btn" onclick="focusSelected()" title="Focus">&#9678;</button>
      <button class="zoom-btn" onclick="clearSelection()" title="Clear">&times;</button>
      <button class="zoom-btn" id="layout-toggle" onclick="toggleLayout()" title="Play/Pause Layout">&#9654;</button>
      <button class="zoom-btn" id="impact-btn" onclick="toggleImpact()" title="Impact/Blast Radius">&#128165;</button>
    </div>
  </div>
  <div id="sidebar-right">
    <div id="node-detail" class="detail-panel">
      <h3 id="detail-name"></h3>
      <div id="detail-type" style="margin:4px 0;"></div>
      <div id="detail-summary" style="margin:8px 0;font-size:13px;color:#aaa;"></div>
      <div id="detail-meta" style="font-size:12px;color:#888;"></div>
      <div id="detail-edges" style="margin-top:12px;"></div>
    </div>
    <div id="edge-detail" class="detail-panel">
      <h3 id="edge-detail-title"></h3>
      <div id="edge-detail-content"></div>
    </div>
    <div id="no-selection" style="color:#888;font-style:italic;padding:20px 0;">Click a node or edge to see details</div>
  </div>
</div>

<script>
(function() {
var rawNodes = ${nodesJson};
var rawEdges = ${edgesJson};
var rawCommunities = ${communitiesJson};

// === TYPE COLORS ===
var TYPE_COLORS = {
    FileNode: '#4fc3f7', PackageNode: '#81c784', Community: '#ba68c8',
    CodeEntity: '#ffb74d', Decision: '#ef5350', Convention: '#26a69a',
    Bug: '#f44336', Solution: '#66bb6a', Concept: '#ab47bc',
    Pattern: '#7e57c2', ContentChunk: '#ff8a65', Dependency: '#90a4ae'
};
var EDGE_COLORS = {
    imports: '#4fc3f7', calls: '#ffb74d', contains: '#81c784',
    implements: '#ba68c8', extends: '#7e57c2', relates_to: '#90a4ae',
    solves: '#66bb6a', solved_by: '#66bb6a', overrides: '#ef5350',
    depends_on: '#ff8a65', implemented_in: '#26a69a'
};
var DEFAULT_TYPE_COLOR = '#90a4ae';
var DEFAULT_EDGE_COLOR = '#666';

// === COMMUNITY COLORS (12-color palette) ===
var COMMUNITY_PALETTE = [
    '#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231', '#911eb4',
    '#42d4f4', '#f032e6', '#bfef45', '#fabed4', '#469990', '#dcbeff'
];
var communityColorMap = {};
var communityIdSet = {};
rawCommunities.forEach(function(c) { communityIdSet[c.communityId] = true; });
var communityIds = Object.keys(communityIdSet);
communityIds.forEach(function(id, i) { communityColorMap[id] = COMMUNITY_PALETTE[i % 12]; });

// === BUILD GRAPHOLOGY GRAPH ===
var graph = new graphology.Graph();
var nodeCount = rawNodes.length;

// Golden-angle pre-positioning (Fermat spiral)
var structuralTypes = { FileNode: true, PackageNode: true, Community: true };
var structIdx = 0;

rawNodes.forEach(function(n, i) {
    var x, y;
    if (structuralTypes[n.type]) {
        var angle = structIdx * 2.399963;
        var radius = Math.sqrt(structIdx) * 15;
        x = Math.cos(angle) * radius;
        y = Math.sin(angle) * radius;
        structIdx++;
    } else {
        var angle2 = i * 2.399963;
        var radius2 = Math.sqrt(i) * 10;
        x = Math.cos(angle2) * radius2 + (Math.random() - 0.5) * 5;
        y = Math.sin(angle2) * radius2 + (Math.random() - 0.5) * 5;
    }

    var importance = n.importance != null ? n.importance : 0.5;
    var size = 3 + importance * 12;

    // Get community color for symbol nodes
    var comm = null;
    for (var ci = 0; ci < rawCommunities.length; ci++) {
        if (rawCommunities[ci].nodeId === n.id) { comm = rawCommunities[ci]; break; }
    }
    var color = TYPE_COLORS[n.type] || DEFAULT_TYPE_COLOR;
    if (comm && !structuralTypes[n.type]) {
        color = communityColorMap[comm.communityId] || color;
    }

    var massMap = { Community: 30, PackageNode: 20, FileNode: 10, CodeEntity: 3, Decision: 2, Convention: 2, Bug: 2, Solution: 2 };

    graph.addNode(n.id, {
        label: n.name,
        x: x, y: y, size: size, color: color,
        mass: massMap[n.type] || 1,
        type: n.type,
        originalColor: color,
        originalSize: size,
        summary: n.summary || '',
        importance: importance,
        trust_tier: n.trustTier,
        file_paths: n.file_paths || ''
    });
});

rawEdges.forEach(function(e, i) {
    if (!graph.hasNode(e.from_id) || !graph.hasNode(e.to_id)) return;
    var edgeKey = 'e' + i;
    var color = EDGE_COLORS[e.type] || DEFAULT_EDGE_COLOR;
    graph.addEdge(e.from_id, e.to_id, {
        key: edgeKey, color: color, originalColor: color,
        size: (e.weight || 0.5) * 2,
        type: e.type, label: e.type,
        weight: e.weight
    });
});

// === FORCEATLAS2 LAYOUT ===
var layoutRunning = false;
var layoutIterations = 0;
var maxIterations = nodeCount < 500 ? 3000 : nodeCount < 2000 ? 5000 : 8000;

function getFA2Settings() {
    if (nodeCount < 500) return { gravity: 1, scalingRatio: 2, slowDown: 5, barnesHutOptimize: false };
    if (nodeCount < 2000) return { gravity: 1.5, scalingRatio: 5, slowDown: 8, barnesHutOptimize: true, barnesHutTheta: 0.5 };
    if (nodeCount < 10000) return { gravity: 2, scalingRatio: 10, slowDown: 10, barnesHutOptimize: true, barnesHutTheta: 0.8 };
    return { gravity: 3, scalingRatio: 20, slowDown: 15, barnesHutOptimize: true, barnesHutTheta: 1.2 };
}

var fa2Settings = Object.assign({}, getFA2Settings(), { adjustSizes: true, linLogMode: false });

function runLayoutFrame() {
    if (!layoutRunning) return;
    var iterPerFrame = 50;
    for (var li = 0; li < iterPerFrame && layoutIterations < maxIterations; li++) {
        graphologyLayoutForceAtlas2.assign(graph, { settings: fa2Settings, iterations: 1 });
        layoutIterations++;
    }
    if (layoutIterations >= maxIterations) {
        layoutRunning = false;
        document.getElementById('layout-toggle').textContent = '\\u25B6';
    } else {
        requestAnimationFrame(runLayoutFrame);
    }
}

window.toggleLayout = function() {
    layoutRunning = !layoutRunning;
    document.getElementById('layout-toggle').textContent = layoutRunning ? '\\u23F8' : '\\u25B6';
    if (layoutRunning) {
        if (layoutIterations >= maxIterations) layoutIterations = 0;
        requestAnimationFrame(runLayoutFrame);
    }
};

// === SIGMA INITIALIZATION ===
var container = document.getElementById('sigma-container');
var selectedNode = null;
var selectedEdge = null;
var impactMode = false;
var impactNodes = {};
var depthFilter = 'all';
var hiddenNodeTypes = {};
var hiddenEdgeTypes = {};
var animatedNodes = {};

var renderer = new Sigma(graph, container, {
    renderLabels: true,
    labelRenderedSizeThreshold: 8,
    labelDensity: 0.1,
    hideEdgesOnMove: true,
    zIndex: true,
    nodeReducer: function(node, data) {
        var res = Object.assign({}, data);

        // Type filter
        if (hiddenNodeTypes[data.type]) {
            res.hidden = true;
            return res;
        }

        // Depth filter
        if (depthFilter !== 'all' && selectedNode && !isWithinHops(node, selectedNode, depthFilter)) {
            if (node !== selectedNode) {
                res.hidden = true;
                return res;
            }
        }

        // Impact mode
        if (impactMode && Object.keys(impactNodes).length > 0) {
            if (impactNodes[node]) {
                res.color = '#ff4444';
                res.size = data.originalSize * 1.5;
            } else {
                res.color = adjustAlpha(data.originalColor, 0.15);
                res.size = data.originalSize * 0.5;
            }
            return res;
        }

        // Selection highlighting
        if (selectedNode) {
            if (node === selectedNode) {
                res.size = data.originalSize * 1.8;
                res.zIndex = 10;
                res.highlighted = true;
            } else if (graph.hasEdge(selectedNode, node) || graph.hasEdge(node, selectedNode)) {
                res.size = data.originalSize * 1.3;
                res.zIndex = 5;
            } else {
                res.color = adjustAlpha(data.originalColor, 0.25);
                res.size = data.originalSize * 0.6;
                res.label = '';
            }
        }

        // Animated effects
        if (animatedNodes[node]) {
            var anim = animatedNodes[node];
            var elapsed = (Date.now() - anim.startTime) / 1000;
            var phase = (Math.sin(elapsed * Math.PI * 4) + 1) / 2;
            if (anim.type === 'pulse') {
                res.color = blendColor('#00ffff', data.originalColor, phase);
                res.size = data.originalSize * (1 + phase * 0.5);
            } else if (anim.type === 'ripple') {
                res.color = blendColor('#ff4444', data.originalColor, phase);
                res.size = data.originalSize * (1 + phase * 0.3);
            }
        }

        return res;
    },
    edgeReducer: function(edge, data) {
        var res = Object.assign({}, data);

        if (hiddenEdgeTypes[data.type]) {
            res.hidden = true;
            return res;
        }

        if (selectedNode) {
            var source = graph.source(edge);
            var target = graph.target(edge);
            if (source === selectedNode || target === selectedNode) {
                res.size = (data.size || 1) * 4;
                res.zIndex = 10;
            } else {
                res.color = adjustAlpha(data.originalColor, 0.1);
            }
        }
        return res;
    }
});

// === CLICK HANDLERS ===
renderer.on('clickNode', function(e) {
    var node = e.node;
    selectedNode = node;
    selectedEdge = null;
    showNodeDetail(node);
    renderer.refresh();

    var pos = renderer.getNodeDisplayData(node);
    if (pos) renderer.getCamera().animate({ x: pos.x, y: pos.y, ratio: 0.3 }, { duration: 500 });
});

renderer.on('clickEdge', function(e) {
    selectedEdge = e.edge;
    showEdgeDetail(e.edge);
});

renderer.on('clickStage', function() {
    clearSelection();
});

// === DETAIL PANELS ===
function showNodeDetail(nodeId) {
    var data = graph.getNodeAttributes(nodeId);
    document.getElementById('detail-name').textContent = data.label || '';
    var typeEl = document.getElementById('detail-type');
    typeEl.textContent = '';
    var badge = document.createElement('span');
    badge.className = 'type-badge';
    badge.style.background = TYPE_COLORS[data.type] || DEFAULT_TYPE_COLOR;
    badge.textContent = data.type || '';
    typeEl.appendChild(badge);

    document.getElementById('detail-summary').textContent = data.summary || '';

    var metaEl = document.getElementById('detail-meta');
    metaEl.textContent = '';
    var lines = [];
    if (data.importance != null) lines.push('Importance: ' + (data.importance * 100).toFixed(0) + '%');
    if (data.trust_tier != null) lines.push('Trust: Tier ' + data.trust_tier);
    if (data.file_paths) lines.push('Files: ' + data.file_paths);
    lines.push('Connections: ' + graph.degree(nodeId));
    lines.forEach(function(line) {
        var div = document.createElement('div');
        div.textContent = line;
        metaEl.appendChild(div);
    });

    // Show connected edges using DOM methods
    var edgesEl = document.getElementById('detail-edges');
    edgesEl.textContent = '';
    var heading = document.createElement('h4');
    heading.className = 'section-title';
    heading.textContent = 'Connections';
    edgesEl.appendChild(heading);
    graph.forEachEdge(nodeId, function(edge, attrs, source, target) {
        var otherNode = source === nodeId ? target : source;
        var otherData = graph.getNodeAttributes(otherNode);
        var dir = source === nodeId ? '\\u2192' : '\\u2190';
        var row = document.createElement('div');
        row.textContent = dir + ' ' + (otherData.label || '') + ' (' + attrs.type + ')';
        row.addEventListener('click', function() { focusNode(otherNode); });
        edgesEl.appendChild(row);
    });

    document.getElementById('node-detail').classList.add('active');
    document.getElementById('edge-detail').classList.remove('active');
    document.getElementById('no-selection').style.display = 'none';
}

function showEdgeDetail(edgeId) {
    var data = graph.getEdgeAttributes(edgeId);
    var source = graph.source(edgeId);
    var target = graph.target(edgeId);
    var srcData = graph.getNodeAttributes(source);
    var tgtData = graph.getNodeAttributes(target);

    document.getElementById('edge-detail-title').textContent = data.type || '';
    var contentEl = document.getElementById('edge-detail-content');
    contentEl.textContent = '';

    var badgeWrap = document.createElement('div');
    badgeWrap.style.margin = '8px 0';
    var badge = document.createElement('span');
    badge.className = 'type-badge';
    badge.style.background = EDGE_COLORS[data.type] || DEFAULT_EDGE_COLOR;
    badge.textContent = data.type || '';
    badgeWrap.appendChild(badge);
    contentEl.appendChild(badgeWrap);

    var fromDiv = document.createElement('div');
    fromDiv.style.fontSize = '13px';
    fromDiv.textContent = 'From: ' + (srcData.label || '');
    contentEl.appendChild(fromDiv);

    var toDiv = document.createElement('div');
    toDiv.style.fontSize = '13px';
    toDiv.textContent = 'To: ' + (tgtData.label || '');
    contentEl.appendChild(toDiv);

    if (data.weight != null) {
        var weightDiv = document.createElement('div');
        weightDiv.style.fontSize = '12px';
        weightDiv.style.color = '#888';
        weightDiv.textContent = 'Weight: ' + data.weight.toFixed(2);
        contentEl.appendChild(weightDiv);
    }

    document.getElementById('edge-detail').classList.add('active');
    document.getElementById('node-detail').classList.remove('active');
    document.getElementById('no-selection').style.display = 'none';
}

// === SEARCH (Cmd+K) ===
var searchInput = document.getElementById('search-input');
var searchResultsEl = document.getElementById('search-results');
var searchResultItems = [];
var searchSelectedIndex = -1;

document.addEventListener('keydown', function(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchInput.focus();
        searchInput.select();
    }
    if (e.key === 'Escape') {
        searchResultsEl.style.display = 'none';
        searchInput.blur();
    }
});

searchInput.addEventListener('input', function() {
    var query = searchInput.value.toLowerCase().trim();
    if (query.length < 2) { searchResultsEl.style.display = 'none'; return; }

    searchResultItems = [];
    graph.forEachNode(function(node, attrs) {
        if ((attrs.label || '').toLowerCase().indexOf(query) !== -1) {
            searchResultItems.push({ id: node, name: attrs.label || '', type: attrs.type });
        }
    });
    searchResultItems = searchResultItems.slice(0, 10);
    searchSelectedIndex = -1;

    if (searchResultItems.length === 0) { searchResultsEl.style.display = 'none'; return; }

    // Build search results using DOM methods
    searchResultsEl.textContent = '';
    searchResultItems.forEach(function(r, i) {
        var item = document.createElement('div');
        item.className = 'search-result-item';
        item.setAttribute('data-index', i);
        var typeSpan = document.createElement('span');
        typeSpan.style.color = TYPE_COLORS[r.type] || '#888';
        typeSpan.textContent = r.type;
        item.appendChild(typeSpan);
        item.appendChild(document.createTextNode(' ' + r.name));
        item.addEventListener('click', function() { selectSearchResult(i); });
        searchResultsEl.appendChild(item);
    });
    searchResultsEl.style.display = 'block';
});

searchInput.addEventListener('keydown', function(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); searchSelectedIndex = Math.min(searchSelectedIndex + 1, searchResultItems.length - 1); updateSearchHighlight(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); searchSelectedIndex = Math.max(searchSelectedIndex - 1, 0); updateSearchHighlight(); }
    else if (e.key === 'Enter' && searchSelectedIndex >= 0) { e.preventDefault(); selectSearchResult(searchSelectedIndex); }
});

function updateSearchHighlight() {
    var items = document.querySelectorAll('.search-result-item');
    for (var si = 0; si < items.length; si++) {
        if (si === searchSelectedIndex) items[si].classList.add('selected');
        else items[si].classList.remove('selected');
    }
}

window.selectSearchResult = function(index) {
    var item = searchResultItems[index];
    if (!item) return;
    searchResultsEl.style.display = 'none';
    searchInput.value = item.name;
    focusNode(item.id);
    // Pulse animation
    animatedNodes[item.id] = { type: 'pulse', startTime: Date.now() };
    setTimeout(function() { delete animatedNodes[item.id]; renderer.refresh(); }, 3000);
    renderer.refresh();
};

// === FILTER SIDEBAR ===
function buildFilters() {
    var nodeTypes = {};
    var edgeTypes = {};
    graph.forEachNode(function(n, attrs) { nodeTypes[attrs.type] = true; });
    graph.forEachEdge(function(e, attrs) { edgeTypes[attrs.type] = true; });

    var ntContainer = document.getElementById('node-type-filters');
    ntContainer.textContent = '';
    Object.keys(nodeTypes).sort().forEach(function(t) {
        var label = document.createElement('label');
        label.className = 'filter-item';
        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = true;
        cb.addEventListener('change', function() { toggleNodeType(t); });
        var dot = document.createElement('span');
        dot.className = 'color-dot';
        dot.style.background = TYPE_COLORS[t] || DEFAULT_TYPE_COLOR;
        label.appendChild(cb);
        label.appendChild(dot);
        label.appendChild(document.createTextNode(t));
        ntContainer.appendChild(label);
    });

    var etContainer = document.getElementById('edge-type-filters');
    etContainer.textContent = '';
    Object.keys(edgeTypes).sort().forEach(function(t) {
        var label = document.createElement('label');
        label.className = 'filter-item';
        var cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = true;
        cb.addEventListener('change', function() { toggleEdgeType(t); });
        var dot = document.createElement('span');
        dot.className = 'color-dot';
        dot.style.background = EDGE_COLORS[t] || DEFAULT_EDGE_COLOR;
        label.appendChild(cb);
        label.appendChild(dot);
        label.appendChild(document.createTextNode(t));
        etContainer.appendChild(label);
    });
}

window.toggleNodeType = function(type) {
    if (hiddenNodeTypes[type]) delete hiddenNodeTypes[type];
    else hiddenNodeTypes[type] = true;
    renderer.refresh();
};
window.toggleEdgeType = function(type) {
    if (hiddenEdgeTypes[type]) delete hiddenEdgeTypes[type];
    else hiddenEdgeTypes[type] = true;
    renderer.refresh();
};

// === FILE TREE ===
function buildFileTree() {
    var tree = {};
    graph.forEachNode(function(node, attrs) {
        if (attrs.type !== 'FileNode' || !attrs.file_paths) return;
        var paths = [];
        var fp = attrs.file_paths;
        if (typeof fp === 'string') {
            if (fp.charAt(0) === '[') {
                try { paths = JSON.parse(fp); } catch(e) { paths = [fp]; }
            } else {
                paths = [fp];
            }
        }
        paths.forEach(function(p) {
            var parts = p.split('/');
            var current = tree;
            parts.forEach(function(part, idx) {
                if (!current[part]) current[part] = idx === parts.length - 1 ? { __nodeId: node } : {};
                current = current[part];
            });
        });
    });

    function renderTreeDom(obj, depth, parentEl) {
        var entries = Object.keys(obj).filter(function(k) { return k !== '__nodeId'; }).sort();
        for (var ei = 0; ei < entries.length; ei++) {
            var name = entries[ei];
            var val = obj[name];
            var isFile = !!val.__nodeId;
            var item = document.createElement('div');
            item.className = 'file-tree-item';
            item.style.paddingLeft = (depth * 16) + 'px';
            item.textContent = (isFile ? '\\uD83D\\uDCC4 ' : '\\uD83D\\uDCC1 ') + name;
            if (isFile) {
                (function(nid) {
                    item.addEventListener('click', function() { focusNode(nid); });
                })(val.__nodeId);
            }
            parentEl.appendChild(item);
            if (!isFile) renderTreeDom(val, depth + 1, parentEl);
        }
    }
    var treeEl = document.getElementById('file-tree');
    treeEl.textContent = '';
    renderTreeDom(tree, 0, treeEl);
}

// Tree search filter
document.getElementById('tree-search').addEventListener('input', function() {
    var q = this.value.toLowerCase();
    var items = document.querySelectorAll('#file-tree .file-tree-item');
    for (var ti = 0; ti < items.length; ti++) {
        items[ti].style.display = (items[ti].textContent.toLowerCase().indexOf(q) !== -1 || q === '') ? '' : 'none';
    }
});

// === N-HOP BFS ===
function getNodesWithinHops(startNode, maxHops) {
    var visited = {};
    visited[startNode] = true;
    var frontier = [startNode];
    for (var hop = 0; hop < maxHops; hop++) {
        var nextFrontier = [];
        for (var fi = 0; fi < frontier.length; fi++) {
            graph.forEachNeighbor(frontier[fi], function(neighbor) {
                if (!visited[neighbor]) {
                    visited[neighbor] = true;
                    nextFrontier.push(neighbor);
                }
            });
        }
        frontier = nextFrontier;
    }
    return visited;
}

function isWithinHops(node, center, maxHops) {
    return !!getNodesWithinHops(center, maxHops)[node];
}

window.setDepthFilter = function(depth) {
    depthFilter = depth;
    renderer.refresh();
};

// === IMPACT / BLAST RADIUS ===
window.toggleImpact = function() {
    if (!selectedNode) return;
    impactMode = !impactMode;
    if (impactMode) {
        impactNodes = getNodesWithinHops(selectedNode, 3);
        // Ripple animation
        var keys = Object.keys(impactNodes);
        for (var ii = 0; ii < keys.length; ii++) {
            if (keys[ii] !== selectedNode) {
                animatedNodes[keys[ii]] = { type: 'ripple', startTime: Date.now() + Math.random() * 500 };
            }
        }
        setTimeout(function() {
            var akeys = Object.keys(impactNodes);
            for (var ai = 0; ai < akeys.length; ai++) delete animatedNodes[akeys[ai]];
            renderer.refresh();
        }, 4000);
    } else {
        impactNodes = {};
        animatedNodes = {};
    }
    document.getElementById('impact-btn').style.background = impactMode ? '#ff4444' : '';
    renderer.refresh();
};

// === ZOOM CONTROLS ===
window.zoomIn = function() { renderer.getCamera().animatedZoom({ duration: 300 }); };
window.zoomOut = function() { renderer.getCamera().animatedUnzoom({ duration: 300 }); };
window.zoomFit = function() { renderer.getCamera().animatedReset({ duration: 500 }); };
window.focusNode = function(nodeId) {
    selectedNode = nodeId;
    showNodeDetail(nodeId);
    var pos = renderer.getNodeDisplayData(nodeId);
    if (pos) renderer.getCamera().animate({ x: pos.x, y: pos.y, ratio: 0.3 }, { duration: 500 });
    renderer.refresh();
};
window.focusSelected = function() { if (selectedNode) focusNode(selectedNode); };
window.clearSelection = function() {
    selectedNode = null;
    selectedEdge = null;
    impactMode = false;
    impactNodes = {};
    animatedNodes = {};
    depthFilter = 'all';
    document.getElementById('impact-btn').style.background = '';
    document.getElementById('node-detail').classList.remove('active');
    document.getElementById('edge-detail').classList.remove('active');
    document.getElementById('no-selection').style.display = '';
    renderer.refresh();
};

// === UTILITY ===
function adjustAlpha(hex, alpha) {
    if (!hex || hex.charAt(0) !== '#') return hex;
    var r = parseInt(hex.slice(1,3), 16);
    var g = parseInt(hex.slice(3,5), 16);
    var b = parseInt(hex.slice(5,7), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}

function blendColor(hexA, hexB, t) {
    if (!hexA || hexA.charAt(0) !== '#') return hexB;
    if (!hexB || hexB.charAt(0) !== '#') return hexA;
    var rA = parseInt(hexA.slice(1,3), 16), gA = parseInt(hexA.slice(3,5), 16), bA = parseInt(hexA.slice(5,7), 16);
    var rB = parseInt(hexB.slice(1,3), 16), gB = parseInt(hexB.slice(3,5), 16), bB = parseInt(hexB.slice(5,7), 16);
    var r = Math.round(rA * t + rB * (1-t));
    var g = Math.round(gA * t + gB * (1-t));
    var b = Math.round(bA * t + bB * (1-t));
    return '#' + [r,g,b].map(function(c) { return c.toString(16).padStart(2,'0'); }).join('');
}

window.switchTab = function(tab) {
    var tabs = document.querySelectorAll('.tab');
    for (var sti = 0; sti < tabs.length; sti++) {
        if (tabs[sti].getAttribute('data-tab') === tab) tabs[sti].classList.add('active');
        else tabs[sti].classList.remove('active');
    }
    document.getElementById('tab-explorer').style.display = tab === 'explorer' ? '' : 'none';
    document.getElementById('tab-filters').style.display = tab === 'filters' ? '' : 'none';
};

// === ANIMATION LOOP ===
function animationLoop() {
    if (Object.keys(animatedNodes).length > 0) renderer.refresh();
    requestAnimationFrame(animationLoop);
}

// === INIT ===
buildFilters();
buildFileTree();
layoutRunning = true;
document.getElementById('layout-toggle').textContent = '\\u23F8';
requestAnimationFrame(runLayoutFrame);
requestAnimationFrame(animationLoop);
})();
</script>
</body>
</html>`;
}
