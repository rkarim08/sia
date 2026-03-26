// src/visualization/g6-renderer.ts
// Full G6 v5 renderer — returns a self-contained HTML string for the visualizer.

export function renderG6Html(): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SIA Knowledge Graph</title>
<script src="https://cdn.jsdelivr.net/npm/@antv/g6@5/dist/g6.min.js"><\/script>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    background: #1a1a2e;
    color: #e0e0e0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 13px;
    height: 100vh;
    overflow: hidden;
  }

  #app {
    display: grid;
    grid-template-columns: 240px 1fr 0px;
    grid-template-rows: 100vh;
    height: 100vh;
    transition: grid-template-columns 0.25s ease;
  }

  #app.inspector-open {
    grid-template-columns: 240px 1fr 320px;
  }

  /* ── Left sidebar ── */
  #sidebar-left {
    background: #16213e;
    border-right: 1px solid #2a2a4a;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .sidebar-section {
    padding: 12px;
    border-bottom: 1px solid #2a2a4a;
  }

  .sidebar-section h3 {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #7986cb;
    margin-bottom: 8px;
  }

  #tree-search {
    width: 100%;
    background: #0f3460;
    border: 1px solid #2a2a4a;
    border-radius: 4px;
    color: #e0e0e0;
    font-size: 12px;
    padding: 5px 8px;
    outline: none;
  }

  #tree-search:focus {
    border-color: #7986cb;
  }

  #file-tree {
    overflow-y: auto;
    flex: 1;
    padding: 4px 0;
  }

  .tree-folder {
    padding: 4px 12px;
    cursor: pointer;
    color: #90caf9;
    font-size: 12px;
    user-select: none;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tree-folder:hover {
    background: #0f3460;
  }

  .filter-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 0;
    font-size: 12px;
    cursor: pointer;
  }

  .filter-row input[type=checkbox] {
    accent-color: #7986cb;
  }

  .filter-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .legend-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 3px 0;
    font-size: 12px;
  }

  .legend-shape {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
  }

  /* ── Center panel ── */
  #center {
    position: relative;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  #graph-canvas {
    flex: 1;
    width: 100%;
    height: 100%;
  }

  /* Zoom controls */
  #zoom-controls {
    position: absolute;
    bottom: 16px;
    right: 16px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .zoom-btn {
    width: 32px;
    height: 32px;
    background: #16213e;
    border: 1px solid #2a2a4a;
    border-radius: 6px;
    color: #e0e0e0;
    font-size: 16px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
    transition: background 0.15s;
  }

  .zoom-btn:hover {
    background: #0f3460;
  }

  /* Search overlay (Cmd+K) */
  #search-overlay {
    display: none;
    position: absolute;
    inset: 0;
    background: rgba(10, 10, 30, 0.6);
    backdrop-filter: blur(2px);
    z-index: 100;
    align-items: flex-start;
    justify-content: center;
    padding-top: 80px;
  }

  #search-overlay.visible {
    display: flex;
  }

  #search-box {
    background: #16213e;
    border: 1px solid #7986cb;
    border-radius: 8px;
    width: 480px;
    max-width: 90vw;
    overflow: hidden;
    box-shadow: 0 8px 32px rgba(0,0,0,0.5);
  }

  #search-box-input {
    width: 100%;
    background: transparent;
    border: none;
    color: #e0e0e0;
    font-size: 15px;
    padding: 14px 16px;
    outline: none;
  }

  #search-results {
    border-top: 1px solid #2a2a4a;
    max-height: 320px;
    overflow-y: auto;
  }

  .search-result-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 16px;
    cursor: pointer;
    transition: background 0.1s;
  }

  .search-result-item:hover {
    background: #0f3460;
  }

  .result-badge {
    font-size: 10px;
    font-weight: 600;
    padding: 2px 5px;
    border-radius: 3px;
    text-transform: uppercase;
    background: #2a2a4a;
    color: #90caf9;
    flex-shrink: 0;
    min-width: 52px;
    text-align: center;
  }

  .result-name {
    font-size: 13px;
    font-weight: 500;
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .result-path {
    font-size: 11px;
    color: #888;
    flex-shrink: 0;
    max-width: 160px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* ── Right sidebar (inspector) ── */
  #sidebar-right {
    background: #16213e;
    border-left: 1px solid #2a2a4a;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    width: 320px;
  }

  #inspector-placeholder {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #555;
    font-size: 13px;
    text-align: center;
    padding: 24px;
  }

  #inspector-content {
    display: none;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  #inspector-content.visible {
    display: flex;
  }

  #inspector-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    border-bottom: 1px solid #2a2a4a;
    flex-shrink: 0;
  }

  #inspector-path {
    flex: 1;
    font-size: 11px;
    color: #90caf9;
    word-break: break-all;
    overflow: hidden;
  }

  #inspector-close {
    background: none;
    border: none;
    color: #888;
    font-size: 18px;
    cursor: pointer;
    padding: 0 4px;
    line-height: 1;
    flex-shrink: 0;
  }

  #inspector-close:hover { color: #e0e0e0; }

  #inspector-tabs {
    display: flex;
    border-bottom: 1px solid #2a2a4a;
    flex-shrink: 0;
  }

  .inspector-tab {
    flex: 1;
    padding: 7px;
    font-size: 11px;
    text-align: center;
    cursor: pointer;
    color: #888;
    border-bottom: 2px solid transparent;
    transition: color 0.15s;
  }

  .inspector-tab.active {
    color: #7986cb;
    border-bottom-color: #7986cb;
  }

  #inspector-body {
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  #code-viewer {
    flex: 1;
    overflow: auto;
    font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace;
    font-size: 11px;
    line-height: 1.5;
    background: #0f0f1e;
    padding: 8px 0;
  }

  .code-line {
    display: flex;
    padding: 0 8px;
  }

  .code-line.highlighted {
    background: rgba(121, 134, 203, 0.15);
  }

  .line-num {
    color: #444;
    width: 32px;
    text-align: right;
    padding-right: 12px;
    user-select: none;
    flex-shrink: 0;
  }

  .line-code { white-space: pre; }

  #entity-list {
    display: none;
    flex: 1;
    overflow-y: auto;
    padding: 4px 0;
  }

  #entity-list.visible { display: block; }

  .entity-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    cursor: pointer;
    transition: background 0.1s;
    font-size: 12px;
  }

  .entity-item:hover { background: #0f3460; }
  .entity-item.selected { background: rgba(121, 134, 203, 0.2); }

  .entity-type-badge {
    font-size: 10px;
    font-weight: 600;
    padding: 1px 5px;
    border-radius: 3px;
    background: #2a2a4a;
    color: #90caf9;
    flex-shrink: 0;
    text-transform: uppercase;
  }

  .entity-name {
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .entity-line {
    color: #555;
    font-size: 11px;
    flex-shrink: 0;
  }

  /* Loading indicator */
  #loading {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    color: #7986cb;
    font-size: 14px;
    pointer-events: none;
  }
<\/style>
<\/head>
<body>
<div id="app">

  <!-- Left Sidebar -->
  <div id="sidebar-left">
    <div class="sidebar-section">
      <h3>Explorer<\/h3>
      <input id="tree-search" type="text" placeholder="Filter files\u2026" autocomplete="off">
    <\/div>
    <div id="file-tree"><\/div>

    <div class="sidebar-section">
      <h3>Filters<\/h3>
      <label class="filter-row">
        <input type="checkbox" data-type="file" checked>
        <span class="filter-dot" style="background:#4fc3f7"><\/span> File
      <\/label>
      <label class="filter-row">
        <input type="checkbox" data-type="function" checked>
        <span class="filter-dot" style="background:#a5d6a7"><\/span> Function
      <\/label>
      <label class="filter-row">
        <input type="checkbox" data-type="class" checked>
        <span class="filter-dot" style="background:#ce93d8"><\/span> Class
      <\/label>
      <label class="filter-row">
        <input type="checkbox" data-type="decision" checked>
        <span class="filter-dot" style="background:#ffcc02"><\/span> Decision
      <\/label>
      <label class="filter-row">
        <input type="checkbox" data-type="bug" checked>
        <span class="filter-dot" style="background:#ef9a9a"><\/span> Bug
      <\/label>
      <label class="filter-row">
        <input type="checkbox" data-type="convention" checked>
        <span class="filter-dot" style="background:#ffb74d"><\/span> Convention
      <\/label>
    <\/div>

    <div class="sidebar-section">
      <h3>Legend<\/h3>
      <div class="legend-row"><div class="legend-shape">\u25a3<\/div> File node<\/div>
      <div class="legend-row"><div class="legend-shape">\u25c6<\/div> Function / Class<\/div>
      <div class="legend-row"><div class="legend-shape">\u2b1f<\/div> Decision / Bug<\/div>
      <div class="legend-row">
        <div class="legend-shape" style="background:#4fc3f7;width:18px;height:2px;border-radius:1px"><\/div>
        Imports
      <\/div>
      <div class="legend-row">
        <div class="legend-shape" style="background:#ffb74d;width:18px;height:2px;border-radius:1px"><\/div>
        Calls
      <\/div>
    <\/div>
  <\/div>

  <!-- Center Panel -->
  <div id="center">
    <div id="loading">Loading graph\u2026<\/div>
    <div id="graph-canvas"><\/div>

    <!-- Zoom controls -->
    <div id="zoom-controls">
      <button class="zoom-btn" id="zoom-in" title="Zoom in">+<\/button>
      <button class="zoom-btn" id="zoom-out" title="Zoom out">\u2212<\/button>
      <button class="zoom-btn" id="zoom-fit" title="Fit to view" style="font-size:12px">\u229f<\/button>
    <\/div>

    <!-- Search overlay (Cmd+K) -->
    <div id="search-overlay">
      <div id="search-box">
        <input id="search-box-input" type="text" placeholder="Search nodes\u2026 (Esc to close)" autocomplete="off">
        <div id="search-results"><\/div>
      <\/div>
    <\/div>
  <\/div>

  <!-- Right Sidebar (Inspector) -->
  <div id="sidebar-right">
    <div id="inspector-placeholder">Click a file node to inspect<\/div>
    <div id="inspector-content">
      <div id="inspector-header">
        <div id="inspector-path"><\/div>
        <button id="inspector-close">\u00d7<\/button>
      <\/div>
      <div id="inspector-tabs">
        <div class="inspector-tab active" data-tab="code">Code<\/div>
        <div class="inspector-tab" data-tab="entities">Entities<\/div>
      <\/div>
      <div id="inspector-body">
        <div id="code-viewer"><\/div>
        <div id="entity-list"><\/div>
      <\/div>
    <\/div>
  <\/div>

<\/div>

<script>
// ── Utilities ────────────────────────────────────────────────────────────────

function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Simple cache with optional TTL
function makeCache(ttlMs) {
  const store = new Map();
  return {
    get(key) {
      const entry = store.get(key);
      if (!entry) return undefined;
      if (ttlMs && Date.now() - entry.ts > ttlMs) { store.delete(key); return undefined; }
      return entry.val;
    },
    set(key, val) { store.set(key, { val, ts: Date.now() }); },
  };
}

const expandCache = makeCache(5 * 60 * 1000);
const entityCache = makeCache(5 * 60 * 1000);
const searchCache = makeCache(5 * 60 * 1000);
const fileCache   = makeCache(0);

// ── Color / style helpers ────────────────────────────────────────────────────

const NODE_COLORS = {
  file:       '#4fc3f7',
  function:   '#a5d6a7',
  class:      '#ce93d8',
  decision:   '#ffcc02',
  bug:        '#ef9a9a',
  convention: '#ffb74d',
};

const EDGE_COLORS = {
  imports: '#4fc3f7',
  calls:   '#ffb74d',
};

function nodeColor(type) { return NODE_COLORS[type] || '#7986cb'; }
function edgeColor(type) { return EDGE_COLORS[type] || '#555'; }

function nodeSize(importance) {
  const imp = typeof importance === 'number' ? importance : 0.5;
  return Math.max(12, Math.min(40, 12 + imp * 28));
}

function adjustBrightness(hex, factor) {
  try {
    const n = parseInt(hex.replace('#',''), 16);
    const r = Math.min(255, Math.round(((n >> 16) & 0xff) * factor));
    const g = Math.min(255, Math.round(((n >> 8) & 0xff) * factor));
    const b = Math.min(255, Math.round((n & 0xff) * factor));
    return '#' + [r,g,b].map(v => v.toString(16).padStart(2,'0')).join('');
  } catch { return hex; }
}

// ── Convert API graph to G6 format ───────────────────────────────────────────

function convertToG6Data(apiData) {
  const nodes = (apiData.nodes || []).map(n => ({
    id: String(n.id),
    data: {
      label:     n.label || n.id,
      nodeType:  n.nodeType || n.type || 'file',
      filePath:  n.filePath || n.path || '',
      importance: n.importance || 0.5,
      fill:      nodeColor(n.nodeType || n.type || 'file'),
      size:      nodeSize(n.importance),
    },
    combo: n.comboId ? String(n.comboId) : undefined,
  }));

  const edges = (apiData.edges || []).map((e, i) => ({
    id: e.id ? String(e.id) : 'e' + i,
    source: String(e.source),
    target: String(e.target),
    data: {
      edgeType: e.edgeType || e.type || 'default',
      stroke:   edgeColor(e.edgeType || e.type || 'default'),
    },
  }));

  const combos = (apiData.combos || []).map(c => ({
    id: String(c.id),
    data: {
      label:      c.label || c.id,
      childCount: c.childCount || 0,
    },
  }));

  return { nodes, edges, combos };
}

// ── Graph initialization ──────────────────────────────────────────────────────

let graph = null;
let activeTab = 'code';

async function initGraph() {
  const loadingEl = document.getElementById('loading');
  const res = await fetch('/api/graph');
  if (!res.ok) { loadingEl.textContent = 'Failed to load graph.'; return; }
  const apiData = await res.json();
  const g6Data = convertToG6Data(apiData);

  loadingEl.style.display = 'none';
  buildFileTree(apiData.combos || [], apiData.nodes || []);

  const G6 = window.G6;
  if (!G6) { loadingEl.textContent = 'G6 library failed to load.'; loadingEl.style.display = 'block'; return; }

  try {
    graph = new G6.Graph({
      container: 'graph-canvas',
      renderer: 'canvas',
      autoFit: 'view',
      layout: {
        type: 'combo-combined',
        spacing: 20,
        comboPadding: 10,
      },
      node: {
        style: {
          size:         d => d.data.size || 18,
          fill:         d => d.data.fill || '#7986cb',
          stroke:       d => adjustBrightness(d.data.fill || '#7986cb', 0.7),
          lineWidth:    1.5,
          labelText:    d => d.data.label || d.id,
          labelFill:    '#ccc',
          labelFontSize: 10,
          labelOffsetY: 14,
          cursor:       'pointer',
        },
      },
      edge: {
        style: {
          stroke:       d => d.data.stroke || '#555',
          lineWidth:    1,
          endArrow:     true,
          endArrowSize: 6,
          opacity:      0.7,
        },
      },
      combo: {
        style: {
          fill:         'rgba(121,134,203,0.06)',
          stroke:       '#3f4a8a',
          lineWidth:    1,
          labelText:    d => d.data.label || d.id,
          labelFill:    '#aaa',
          labelFontSize: 10,
          padding:      10,
          cursor:       'pointer',
        },
      },
      behaviors: ['drag-canvas', 'zoom-canvas', 'drag-element', 'collapse-expand'],
      data: g6Data,
    });

    await graph.render();
    bindGraphEvents();
  } catch (err) {
    console.error('G6 init error:', err);
    loadingEl.textContent = 'Graph render error: ' + String(err);
    loadingEl.style.display = 'block';
  }
}

// ── File tree ─────────────────────────────────────────────────────────────────

function buildFileTree(combos, nodes) {
  const treeEl = document.getElementById('file-tree');
  // Clear using textContent to remove all children safely
  treeEl.textContent = '';

  const folderIds = new Set(combos.map(c => String(c.id || '')));

  for (const combo of combos) {
    const el = document.createElement('div');
    el.className = 'tree-folder';
    const label = combo.label || combo.id || '';
    el.title = label;
    // Use textContent — no user content inserted as HTML
    el.textContent = '\uD83D\uDCC1 ' + label;
    el.dataset.comboId = String(combo.id || '');
    el.addEventListener('click', () => {
      if (graph) { try { graph.focusItem(String(combo.id), { animate: true, padding: 40 }); } catch {} }
    });
    treeEl.appendChild(el);
  }

  const fileNodes = nodes.filter(n => (n.nodeType || n.type) === 'file');
  for (const node of fileNodes) {
    if (node.comboId && folderIds.has(String(node.comboId))) continue;
    const el = document.createElement('div');
    el.className = 'tree-folder';
    const label = node.label || node.filePath || node.id || '';
    el.title = label;
    el.textContent = '\uD83D\uDCC4 ' + label;
    el.addEventListener('click', () => {
      if (graph) { try { graph.focusItem(String(node.id), { animate: true, padding: 40 }); } catch {} }
    });
    treeEl.appendChild(el);
  }
}

document.getElementById('tree-search').addEventListener('input', function() {
  const q = this.value.toLowerCase();
  document.querySelectorAll('#file-tree .tree-folder').forEach(el => {
    el.style.display = el.title.toLowerCase().includes(q) ? '' : 'none';
  });
});

// ── Graph events ──────────────────────────────────────────────────────────────

function bindGraphEvents() {
  if (!graph) return;

  graph.on('node:click', async evt => {
    const model = evt.itemModel || (evt.item && evt.item.getModel && evt.item.getModel()) || {};
    const data = model.data || model;
    const nodeType = data.nodeType || data.type || '';
    const nodeId = String(model.id || (evt.item && evt.item.getID && evt.item.getID()) || '');
    const filePath = data.filePath || data.path || '';

    if (nodeType === 'file' && filePath) {
      await openInspector(nodeId, filePath);
    }
  });

  graph.on('canvas:click', () => { closeInspector(); });
}

// ── Inspector ─────────────────────────────────────────────────────────────────

async function openInspector(nodeId, filePath) {
  // Use textContent to safely set path — no HTML injection
  document.getElementById('inspector-path').textContent = filePath;
  document.getElementById('inspector-placeholder').style.display = 'none';
  document.getElementById('inspector-content').classList.add('visible');
  document.getElementById('app').classList.add('inspector-open');

  if (graph) { try { graph.fitView({ animate: false }); } catch {} }

  const [fileData, entityData] = await Promise.all([
    fetchFile(filePath),
    fetchEntities(nodeId, filePath),
  ]);

  if (fileData) renderCodeViewer(fileData.content);
  renderEntityList(entityData ? (entityData.entities || entityData) : []);
  showTab(activeTab);
}

function closeInspector() {
  document.getElementById('inspector-content').classList.remove('visible');
  document.getElementById('inspector-placeholder').style.display = 'flex';
  document.getElementById('app').classList.remove('inspector-open');
  if (graph) { try { graph.fitView({ animate: false }); } catch {} }
}

async function fetchFile(filePath) {
  const cached = fileCache.get(filePath);
  if (cached) return cached;
  try {
    const res = await fetch('/api/file?path=' + encodeURIComponent(filePath));
    if (!res.ok) return null;
    const data = await res.json();
    fileCache.set(filePath, data);
    return data;
  } catch { return null; }
}

async function fetchEntities(nodeId, filePath) {
  const key = nodeId || filePath;
  const cached = entityCache.get(key);
  if (cached) return cached;
  try {
    const id = nodeId.startsWith('file:') ? nodeId : 'file:' + filePath;
    const res = await fetch('/api/entities/' + encodeURIComponent(id));
    if (!res.ok) return null;
    const data = await res.json();
    entityCache.set(key, data);
    return data;
  } catch { return null; }
}

// Render code viewer using DOM methods — source code escaped via esc()
function renderCodeViewer(content) {
  const viewer = document.getElementById('code-viewer');
  viewer.textContent = '';

  if (!content) {
    const msg = document.createElement('div');
    msg.style.cssText = 'padding:12px;color:#555';
    msg.textContent = 'No source available.';
    viewer.appendChild(msg);
    return;
  }

  const lines = content.split('\\n');
  const frag = document.createDocumentFragment();
  lines.forEach((line, i) => {
    const lineNum = i + 1;
    const row = document.createElement('div');
    row.className = 'code-line';
    row.dataset.line = String(lineNum);

    const numSpan = document.createElement('span');
    numSpan.className = 'line-num';
    numSpan.textContent = String(lineNum);

    const codeSpan = document.createElement('span');
    codeSpan.className = 'line-code';
    // textContent safely handles all special chars in source code
    codeSpan.textContent = line;

    row.appendChild(numSpan);
    row.appendChild(codeSpan);
    frag.appendChild(row);
  });
  viewer.appendChild(frag);
}

// Render entity list using DOM methods — all user data via textContent
function renderEntityList(entities) {
  const list = document.getElementById('entity-list');
  list.textContent = '';

  if (!entities || !entities.length) {
    const msg = document.createElement('div');
    msg.style.cssText = 'padding:12px;color:#555';
    msg.textContent = 'No entities found.';
    list.appendChild(msg);
    return;
  }

  const frag = document.createDocumentFragment();
  entities.forEach((e, i) => {
    const item = document.createElement('div');
    item.className = 'entity-item';
    item.dataset.index = String(i);
    item.dataset.line = String(e.line || '');

    const badge = document.createElement('span');
    badge.className = 'entity-type-badge';
    badge.textContent = e.type || e.entityType || '';

    const name = document.createElement('span');
    name.className = 'entity-name';
    name.textContent = e.name || '';

    const lineEl = document.createElement('span');
    lineEl.className = 'entity-line';
    lineEl.textContent = e.line ? 'L' + e.line : '';

    item.appendChild(badge);
    item.appendChild(name);
    item.appendChild(lineEl);
    item.addEventListener('click', () => selectEntity(item));
    frag.appendChild(item);
  });
  list.appendChild(frag);
}

function selectEntity(el) {
  document.querySelectorAll('.entity-item').forEach(e => e.classList.remove('selected'));
  el.classList.add('selected');
  const line = parseInt(el.dataset.line, 10);
  if (line) highlightLine(line);
  showTab('code');
}

function highlightLine(lineNum) {
  document.querySelectorAll('.code-line').forEach(el => el.classList.remove('highlighted'));
  const target = document.querySelector('.code-line[data-line="' + lineNum + '"]');
  if (target) {
    target.classList.add('highlighted');
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

// ── Inspector tabs ────────────────────────────────────────────────────────────

function showTab(tabName) {
  activeTab = tabName;
  document.querySelectorAll('.inspector-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tabName);
  });
  const codeViewer = document.getElementById('code-viewer');
  const entityList = document.getElementById('entity-list');
  if (tabName === 'code') {
    codeViewer.style.display = 'block';
    entityList.classList.remove('visible');
  } else {
    codeViewer.style.display = 'none';
    entityList.classList.add('visible');
  }
}

document.querySelectorAll('.inspector-tab').forEach(tab => {
  tab.addEventListener('click', () => showTab(tab.dataset.tab));
});

document.getElementById('inspector-close').addEventListener('click', closeInspector);

// ── Zoom controls ─────────────────────────────────────────────────────────────

document.getElementById('zoom-in').addEventListener('click', () => {
  if (graph) { try { graph.zoom(1.2); } catch {} }
});
document.getElementById('zoom-out').addEventListener('click', () => {
  if (graph) { try { graph.zoom(0.8); } catch {} }
});
document.getElementById('zoom-fit').addEventListener('click', () => {
  if (graph) { try { graph.fitView({ animate: true }); } catch {} }
});

// ── Search overlay (Cmd+K) ────────────────────────────────────────────────────

let searchDebounceTimer = null;

document.addEventListener('keydown', evt => {
  if ((evt.metaKey || evt.ctrlKey) && evt.key === 'k') {
    evt.preventDefault();
    toggleSearchOverlay();
  }
  if (evt.key === 'Escape') { closeSearchOverlay(); }
});

function toggleSearchOverlay() {
  const overlay = document.getElementById('search-overlay');
  if (overlay.classList.contains('visible')) {
    closeSearchOverlay();
  } else {
    overlay.classList.add('visible');
    document.getElementById('search-box-input').focus();
  }
}

function closeSearchOverlay() {
  document.getElementById('search-overlay').classList.remove('visible');
  document.getElementById('search-box-input').value = '';
  document.getElementById('search-results').textContent = '';
}

document.getElementById('search-overlay').addEventListener('click', evt => {
  if (evt.target === document.getElementById('search-overlay')) closeSearchOverlay();
});

document.getElementById('search-box-input').addEventListener('input', function() {
  clearTimeout(searchDebounceTimer);
  const q = this.value.trim();
  if (!q) { document.getElementById('search-results').textContent = ''; return; }
  searchDebounceTimer = setTimeout(() => doSearch(q), 200);
});

async function doSearch(q) {
  const cached = searchCache.get(q);
  if (cached) { renderSearchResults(cached); return; }
  try {
    const res = await fetch('/api/search?q=' + encodeURIComponent(q) + '&limit=20');
    if (!res.ok) return;
    const data = await res.json();
    const results = data.results || [];
    searchCache.set(q, results);
    renderSearchResults(results);
  } catch {}
}

// Render search results using DOM methods — all user data via textContent
function renderSearchResults(results) {
  const container = document.getElementById('search-results');
  container.textContent = '';

  if (!results.length) {
    const msg = document.createElement('div');
    msg.style.cssText = 'padding:12px 16px;color:#555;font-size:12px';
    msg.textContent = 'No results';
    container.appendChild(msg);
    return;
  }

  const frag = document.createDocumentFragment();
  results.forEach(r => {
    const item = document.createElement('div');
    item.className = 'search-result-item';

    const badge = document.createElement('span');
    badge.className = 'result-badge';
    badge.textContent = r.nodeType || r.type || '';

    const nameEl = document.createElement('span');
    nameEl.className = 'result-name';
    nameEl.textContent = r.name || r.label || '';

    const pathEl = document.createElement('span');
    pathEl.className = 'result-path';
    pathEl.textContent = r.filePath || r.path || '';

    item.appendChild(badge);
    item.appendChild(nameEl);
    item.appendChild(pathEl);

    const nodeId = String(r.id || '');
    item.addEventListener('click', () => {
      if (nodeId && graph) {
        try { graph.focusItem(nodeId, { animate: true, padding: 60 }); } catch {}
      }
      closeSearchOverlay();
    });

    frag.appendChild(item);
  });
  container.appendChild(frag);
}

// ── Filter checkboxes ─────────────────────────────────────────────────────────

document.querySelectorAll('.filter-row input[type=checkbox]').forEach(cb => {
  cb.addEventListener('change', applyFilters);
});

function applyFilters() {
  if (!graph) return;
  const activeTypes = new Set(
    [...document.querySelectorAll('.filter-row input[type=checkbox]')]
      .filter(cb => cb.checked)
      .map(cb => cb.dataset.type)
  );
  try {
    graph.getNodeData().forEach(node => {
      const nodeType = (node.data && node.data.nodeType) || 'file';
      graph.updateNodeData([{ id: node.id, data: { visible: activeTypes.has(nodeType) } }]);
    });
    graph.draw();
  } catch {}
}

// ── Resize handler ────────────────────────────────────────────────────────────

window.addEventListener('resize', () => {
  if (!graph) return;
  const canvas = document.getElementById('graph-canvas');
  try { graph.changeSize(canvas.clientWidth, canvas.clientHeight); } catch {}
});

// ── Boot ──────────────────────────────────────────────────────────────────────

initGraph().catch(err => {
  const loadingEl = document.getElementById('loading');
  loadingEl.textContent = 'Error: ' + String(err);
  loadingEl.style.display = 'block';
});
<\/script>
<\/body>
<\/html>`;
}
