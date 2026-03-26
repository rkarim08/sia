import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import Graph from 'graphology';
import type { GraphResponse, GraphNode } from '../lib/api';
import type { SigmaNodeAttributes, SigmaEdgeAttributes, ViewBookmark, LayoutMode } from '../types';
import {
  graphResponseToGraphology,
  filterGraphByTypes,
  filterGraphByFolder,
  getNodeDistances,
  findShortestPath,
  getNodesWithinHops,
  computeTreeLayout,
  computeRadialLayout,
} from '../lib/graph-adapter';
import { useSigma } from '../hooks/useSigma';
import { BG_PRIMARY, DEFAULT_VISIBLE_TYPES, NODE_COLORS, COMMUNITY_COLORS } from '../lib/constants';
import type { SiaNodeType } from '../lib/constants';
import ContextMenu from './ContextMenu';
import type { ContextMenuItem } from './ContextMenu';

interface Props {
  data: GraphResponse | null;
  onNodeClick: (node: GraphNode) => void;
  onStageClick: () => void;
  selectedNodeId: string | null;
  hiddenTypes: Set<string>;
  activeFolder: string | null;
  blastRadiusMode: boolean;
  colorByFolder: boolean;
  pathSource: string | null;
  pathTarget: string | null;
  onClearPath: () => void;
  showHulls: boolean;
  layoutMode: LayoutMode;
  onLayoutModeChange: (mode: LayoutMode) => void;
  maxTrustTier: number;
  onMaxTrustTierChange: (tier: number) => void;
}

export interface GraphCanvasHandle {
  focusNode: (nodeId: string) => void;
  exportPNG: () => void;
  getCameraState: () => { x: number; y: number; ratio: number; angle: number } | null;
  setCameraState: (state: { x: number; y: number; ratio: number; angle: number }) => void;
}

// Subtle dot grid SVG as data URI for background texture
const DOT_GRID = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32'%3E%3Ccircle cx='1' cy='1' r='0.6' fill='rgba(255,255,255,0.04)'/%3E%3C/svg%3E")`;

const BOOKMARKS_KEY = 'sia.viewBookmarks';

const GraphCanvas = forwardRef<GraphCanvasHandle, Props>(
  ({ data, onNodeClick, onStageClick, selectedNodeId, hiddenTypes, activeFolder, blastRadiusMode, colorByFolder, pathSource, pathTarget, onClearPath, showHulls, layoutMode, onLayoutModeChange, maxTrustTier, onMaxTrustTierChange }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);

    // Context menu state
    const [contextMenu, setContextMenu] = useState<{
      x: number;
      y: number;
      nodeId: string;
      attrs: SigmaNodeAttributes;
    } | null>(null);

    // Bookmarks
    const [bookmarks, setBookmarks] = useState<ViewBookmark[]>(() => {
      try {
        const saved = localStorage.getItem(BOOKMARKS_KEY);
        return saved ? JSON.parse(saved) : [];
      } catch { return []; }
    });
    const [showBookmarks, setShowBookmarks] = useState(false);

    const graph = useMemo<Graph<SigmaNodeAttributes, SigmaEdgeAttributes> | null>(() => {
      if (!data) return null;
      return graphResponseToGraphology(data);
    }, [data]);

    // Apply type + folder filtering
    useEffect(() => {
      if (!graph) return;
      const visibleTypes = DEFAULT_VISIBLE_TYPES.filter(
        (t) => !hiddenTypes.has(t),
      );
      if (activeFolder) {
        filterGraphByFolder(graph, activeFolder, visibleTypes);
      } else {
        filterGraphByTypes(graph, visibleTypes);
      }
    }, [graph, hiddenTypes, activeFolder]);

    // Blast radius distances
    const blastDistances = useMemo(() => {
      if (!blastRadiusMode || !selectedNodeId || !graph || !graph.hasNode(selectedNodeId)) return null;
      return getNodeDistances(graph, selectedNodeId, 6);
    }, [blastRadiusMode, selectedNodeId, graph]);

    // Cluster color map for color-by-folder mode
    const clusterColorMap = useMemo(() => {
      if (!colorByFolder || !graph) return undefined;
      const clusters = new Set<string>();
      graph.forEachNode((_id, attrs) => {
        if (attrs.cluster) clusters.add(attrs.cluster);
      });
      const map = new Map<string, string>();
      const clusterArr = Array.from(clusters).sort();
      clusterArr.forEach((c, i) => {
        map.set(c, COMMUNITY_COLORS[i % COMMUNITY_COLORS.length]);
      });
      return map;
    }, [colorByFolder, graph]);

    // Path finding
    const { pathNodes, pathEdgeKeys } = useMemo(() => {
      if (!pathSource || !pathTarget || !graph) return { pathNodes: null, pathEdgeKeys: null };
      const path = findShortestPath(graph, pathSource, pathTarget);
      if (path.length === 0) return { pathNodes: null, pathEdgeKeys: null };
      const nodes = new Set(path);
      const edges = new Set<string>();
      for (let i = 0; i < path.length - 1; i++) {
        edges.add(`${path[i]}->${path[i + 1]}`);
      }
      return { pathNodes: nodes, pathEdgeKeys: edges };
    }, [pathSource, pathTarget, graph]);

    const handleNodeClick = (nodeId: string, attrs: SigmaNodeAttributes) => {
      setContextMenu(null);
      onNodeClick({
        id: nodeId,
        label: attrs.label,
        parentId: attrs.parentId,
        nodeType: attrs.nodeType as GraphNode['nodeType'],
        filePath: attrs.filePath || undefined,
        importance: attrs.importance,
        trustTier: attrs.trustTier,
        color: attrs.color,
        entityId: attrs.entityId,
      });
    };

    const handleRightClick = useCallback((nodeId: string, attrs: SigmaNodeAttributes, event: { x: number; y: number }) => {
      setContextMenu({ x: event.x, y: event.y, nodeId, attrs });
    }, []);

    const handleStageClick = useCallback(() => {
      setContextMenu(null);
      onStageClick();
    }, [onStageClick]);

    const minimapRef = useRef<HTMLCanvasElement>(null);
    const localGraphRef = useRef<HTMLCanvasElement>(null);

    const { zoomIn, zoomOut, resetZoom, focusNode, exportPNG, getCameraState, setCameraState, sigmaRef } = useSigma(
      containerRef as React.RefObject<HTMLDivElement>,
      graph,
      {
        onNodeClick: handleNodeClick,
        onStageClick: handleStageClick,
        onRightClickNode: handleRightClick,
        selectedNodeId,
        blastRadiusMode,
        blastDistances,
        colorByFolder,
        clusterColorMap,
        pathNodes,
        pathEdgeKeys,
        showHulls,
      },
    );

    useImperativeHandle(ref, () => ({ focusNode, exportPNG, getCameraState, setCameraState }), [focusNode, exportPNG, getCameraState, setCameraState]);

    // Keyboard navigation
    useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
        // Don't handle if typing in an input
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
        if (!graph) return;

        if (e.key === 'Escape') {
          onStageClick(); // deselect
          onClearPath();
          return;
        }

        if (e.key === 'Enter' && selectedNodeId && graph.hasNode(selectedNodeId)) {
          // Open inspector (trigger click on selected node)
          const attrs = graph.getNodeAttributes(selectedNodeId);
          onNodeClick({
            id: selectedNodeId,
            label: attrs.label,
            parentId: attrs.parentId,
            nodeType: attrs.nodeType as GraphNode['nodeType'],
            filePath: attrs.filePath || undefined,
            importance: attrs.importance,
            trustTier: attrs.trustTier,
            color: attrs.color,
            entityId: attrs.entityId,
          });
          return;
        }

        // Arrow keys: navigate between connected nodes
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
          e.preventDefault();
          if (!selectedNodeId || !graph.hasNode(selectedNodeId)) {
            // Select first visible node
            const firstNode = graph.nodes().find(n => !graph.getNodeAttributes(n).hidden);
            if (firstNode) {
              const attrs = graph.getNodeAttributes(firstNode);
              handleNodeClick(firstNode, attrs);
              focusNode(firstNode);
            }
            return;
          }

          const neighbors = graph.neighbors(selectedNodeId).filter(
            n => !graph.getNodeAttributes(n).hidden,
          );
          if (neighbors.length === 0) return;

          // Pick neighbor based on direction
          let bestNeighbor = neighbors[0];
          if (neighbors.length > 1) {
            const selAttrs = graph.getNodeAttributes(selectedNodeId);
            const selX = selAttrs.x;
            const selY = selAttrs.y;

            type ScoredNeighbor = { id: string; score: number };
            const scored: ScoredNeighbor[] = neighbors.map(n => {
              const a = graph.getNodeAttributes(n);
              const dx = a.x - selX;
              const dy = a.y - selY;
              let score = 0;
              switch (e.key) {
                case 'ArrowRight': score = dx; break;
                case 'ArrowLeft': score = -dx; break;
                case 'ArrowDown': score = dy; break;
                case 'ArrowUp': score = -dy; break;
              }
              return { id: n, score };
            });
            scored.sort((a, b) => b.score - a.score);
            bestNeighbor = scored[0].id;
          }

          const attrs = graph.getNodeAttributes(bestNeighbor);
          handleNodeClick(bestNeighbor, attrs);
          focusNode(bestNeighbor);
          return;
        }

        // Tab: cycle through all visible nodes
        if (e.key === 'Tab') {
          e.preventDefault();
          const visibleNodes = graph.nodes().filter(n => !graph.getNodeAttributes(n).hidden);
          if (visibleNodes.length === 0) return;
          const currentIndex = selectedNodeId ? visibleNodes.indexOf(selectedNodeId) : -1;
          const nextIndex = e.shiftKey
            ? (currentIndex - 1 + visibleNodes.length) % visibleNodes.length
            : (currentIndex + 1) % visibleNodes.length;
          const nextNode = visibleNodes[nextIndex];
          const attrs = graph.getNodeAttributes(nextNode);
          handleNodeClick(nextNode, attrs);
          focusNode(nextNode);
          return;
        }
      };

      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }, [graph, selectedNodeId, onStageClick, onNodeClick, focusNode, onClearPath]);

    // Trust tier filtering
    useEffect(() => {
      if (!graph) return;
      if (maxTrustTier >= 4) {
        // Show all — don't override hidden state from type/folder filters
        return;
      }
      graph.forEachNode((nodeId, attrs) => {
        if (attrs.hidden) return; // Already hidden by type/folder filter
        if (attrs.trustTier > maxTrustTier && attrs.trustTier > 0) {
          graph.setNodeAttribute(nodeId, 'hidden', true);
        }
      });
      sigmaRef.current?.refresh();
    }, [graph, maxTrustTier, hiddenTypes, activeFolder]);

    // Layout mode switching
    useEffect(() => {
      if (!graph || !sigmaRef.current) return;
      if (layoutMode === 'tree') {
        computeTreeLayout(graph);
        sigmaRef.current.refresh();
      } else if (layoutMode === 'radial') {
        computeRadialLayout(graph, selectedNodeId);
        sigmaRef.current.refresh();
      }
      // 'force' is the default FA2 layout, applied at init
    }, [layoutMode, graph, selectedNodeId]);

    // Minimap rendering
    useEffect(() => {
      const sigma = sigmaRef.current;
      if (!sigma || !graph || !minimapRef.current) return;

      const canvas = minimapRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const draw = () => {
        const w = canvas.width;
        const h = canvas.height;
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = 'rgba(8,8,18,0.85)';
        ctx.fillRect(0, 0, w, h);

        // Collect all visible node positions
        const positions: { x: number; y: number; color: string }[] = [];
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

        graph.forEachNode((nodeId, attrs) => {
          if (attrs.hidden) return;
          const display = sigma.getNodeDisplayData(nodeId);
          if (!display) return;
          positions.push({ x: display.x, y: display.y, color: display.color || attrs.color });
          if (display.x < minX) minX = display.x;
          if (display.x > maxX) maxX = display.x;
          if (display.y < minY) minY = display.y;
          if (display.y > maxY) maxY = display.y;
        });

        if (positions.length === 0) return;

        const rangeX = maxX - minX || 1;
        const rangeY = maxY - minY || 1;
        const padding = 10;
        const scaleX = (w - padding * 2) / rangeX;
        const scaleY = (h - padding * 2) / rangeY;
        const scale = Math.min(scaleX, scaleY);

        const offsetX = padding + ((w - padding * 2) - rangeX * scale) / 2;
        const offsetY = padding + ((h - padding * 2) - rangeY * scale) / 2;

        // Draw nodes
        positions.forEach(({ x, y, color }) => {
          const px = offsetX + (x - minX) * scale;
          const py = offsetY + (y - minY) * scale;
          ctx.fillStyle = color;
          ctx.globalAlpha = 0.7;
          ctx.beginPath();
          ctx.arc(px, py, 1.5, 0, Math.PI * 2);
          ctx.fill();
        });
        ctx.globalAlpha = 1;

        // Draw viewport rectangle
        const camera = sigma.getCamera();
        const container = sigma.getContainer();
        const cw = container.offsetWidth;
        const ch = container.offsetHeight;

        // Viewport bounds in graph coords: approximate from camera state
        const vpHalfW = (cw / 2) * camera.ratio;
        const vpHalfH = (ch / 2) * camera.ratio;

        // Camera x,y are in normalized [0,1] coordinates — convert to viewport display coords
        const camDisplayX = camera.x * cw;
        const camDisplayY = camera.y * ch;

        const vpLeft = camDisplayX - vpHalfW;
        const vpRight = camDisplayX + vpHalfW;
        const vpTop = camDisplayY - vpHalfH;
        const vpBottom = camDisplayY + vpHalfH;

        // Map to minimap coords
        const rectX = offsetX + (vpLeft - minX) * scale;
        const rectY = offsetY + (vpTop - minY) * scale;
        const rectW = (vpRight - vpLeft) * scale;
        const rectH = (vpBottom - vpTop) * scale;

        ctx.strokeStyle = 'rgba(99,102,241,0.6)';
        ctx.lineWidth = 1;
        ctx.strokeRect(rectX, rectY, rectW, rectH);
      };

      // Draw after render events
      sigma.on('afterRender', draw);
      draw(); // Initial draw

      return () => {
        sigma.off('afterRender', draw);
      };
    }, [graph, sigmaRef.current]);

    // Minimap click handler
    const handleMinimapClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
      const sigma = sigmaRef.current;
      if (!sigma || !graph || !minimapRef.current) return;

      const canvas = minimapRef.current;
      const rect = canvas.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;

      // Collect bounds from display data
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      graph.forEachNode((nodeId, attrs) => {
        if (attrs.hidden) return;
        const display = sigma.getNodeDisplayData(nodeId);
        if (!display) return;
        if (display.x < minX) minX = display.x;
        if (display.x > maxX) maxX = display.x;
        if (display.y < minY) minY = display.y;
        if (display.y > maxY) maxY = display.y;
      });

      const w = canvas.width;
      const h = canvas.height;
      const rangeX = maxX - minX || 1;
      const rangeY = maxY - minY || 1;
      const padding = 10;
      const scaleX = (w - padding * 2) / rangeX;
      const scaleY = (h - padding * 2) / rangeY;
      const scale = Math.min(scaleX, scaleY);
      const offsetX = padding + ((w - padding * 2) - rangeX * scale) / 2;
      const offsetY = padding + ((h - padding * 2) - rangeY * scale) / 2;

      // Convert click to display coords
      const displayX = (clickX - offsetX) / scale + minX;
      const displayY = (clickY - offsetY) / scale + minY;

      // Convert display coords to graph coords (normalized)
      const container = sigma.getContainer();
      const normX = displayX / container.offsetWidth;
      const normY = displayY / container.offsetHeight;

      sigma.getCamera().animate({ x: normX, y: normY }, { duration: 300 });
    }, [graph]);

    // Local graph rendering (2-hop neighborhood)
    useEffect(() => {
      if (!graph || !localGraphRef.current || !selectedNodeId || !graph.hasNode(selectedNodeId)) {
        if (localGraphRef.current) {
          const ctx = localGraphRef.current.getContext('2d');
          if (ctx) ctx.clearRect(0, 0, localGraphRef.current.width, localGraphRef.current.height);
        }
        return;
      }

      const canvas = localGraphRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(8,8,18,0.85)';
      ctx.fillRect(0, 0, w, h);

      // Get 2-hop neighborhood
      const neighborhood = getNodesWithinHops(graph, selectedNodeId, 2);
      const nodes = Array.from(neighborhood);
      if (nodes.length === 0) return;

      // Circular layout
      const centerX = w / 2;
      const centerY = h / 2;
      const radius = Math.min(w, h) / 2 - 20;
      const positions = new Map<string, { x: number; y: number }>();

      // Center node at center
      positions.set(selectedNodeId, { x: centerX, y: centerY });

      // Others in a circle
      const otherNodes = nodes.filter(n => n !== selectedNodeId);
      otherNodes.forEach((nodeId, i) => {
        const angle = (2 * Math.PI * i) / otherNodes.length;
        const r = otherNodes.length <= 6 ? radius * 0.6 : radius;
        positions.set(nodeId, {
          x: centerX + r * Math.cos(angle),
          y: centerY + r * Math.sin(angle),
        });
      });

      // Draw edges
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 0.5;
      graph.forEachEdge((edge, _attrs, source, target) => {
        const sp = positions.get(source);
        const tp = positions.get(target);
        if (!sp || !tp) return;
        ctx.beginPath();
        ctx.moveTo(sp.x, sp.y);
        ctx.lineTo(tp.x, tp.y);
        ctx.stroke();
      });

      // Draw nodes
      nodes.forEach(nodeId => {
        const pos = positions.get(nodeId);
        if (!pos) return;
        const attrs = graph.getNodeAttributes(nodeId);
        const isCenter = nodeId === selectedNodeId;
        const dotSize = isCenter ? 5 : 3;

        ctx.fillStyle = attrs.color;
        ctx.globalAlpha = isCenter ? 1 : 0.7;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, dotSize, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;

        // Label for center node
        if (isCenter) {
          ctx.fillStyle = '#e0e0e0';
          ctx.font = '9px "DM Sans", sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(attrs.label.slice(0, 20), pos.x, pos.y + dotSize + 12);
        }
      });

      // Border
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 1;
      ctx.strokeRect(0, 0, w, h);
    }, [graph, selectedNodeId]);

    // Local graph click handler
    const handleLocalGraphClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!graph || !selectedNodeId || !graph.hasNode(selectedNodeId) || !localGraphRef.current) return;

      const canvas = localGraphRef.current;
      const rect = canvas.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickY = e.clientY - rect.top;

      const w = canvas.width;
      const h = canvas.height;
      const centerX = w / 2;
      const centerY = h / 2;
      const radius = Math.min(w, h) / 2 - 20;

      const neighborhood = getNodesWithinHops(graph, selectedNodeId, 2);
      const nodes = Array.from(neighborhood);
      const otherNodes = nodes.filter(n => n !== selectedNodeId);

      // Check if click is near center node
      const distToCenter = Math.sqrt((clickX - centerX) ** 2 + (clickY - centerY) ** 2);
      if (distToCenter < 10) {
        focusNode(selectedNodeId);
        return;
      }

      // Check other nodes
      otherNodes.forEach((nodeId, i) => {
        const angle = (2 * Math.PI * i) / otherNodes.length;
        const r = otherNodes.length <= 6 ? radius * 0.6 : radius;
        const nx = centerX + r * Math.cos(angle);
        const ny = centerY + r * Math.sin(angle);
        const dist = Math.sqrt((clickX - nx) ** 2 + (clickY - ny) ** 2);
        if (dist < 8) {
          focusNode(nodeId);
          const attrs = graph.getNodeAttributes(nodeId);
          handleNodeClick(nodeId, attrs);
        }
      });
    }, [graph, selectedNodeId, focusNode]);

    // Context menu items
    const contextMenuItems: ContextMenuItem[] = useMemo(() => {
      if (!contextMenu || !graph) return [];
      const { nodeId, attrs } = contextMenu;
      const items: ContextMenuItem[] = [
        {
          label: 'Focus on this (2-hop)',
          icon: '\u25CE',
          onClick: () => {
            focusNode(nodeId);
            const a = graph.getNodeAttributes(nodeId);
            handleNodeClick(nodeId, a);
          },
        },
        {
          label: `Hide "${attrs.nodeType}" type`,
          icon: '\u2298',
          separator: true,
          onClick: () => {
            // This needs to toggle the type via parent - we'll fire onNodeClick to select then the user can toggle
            // For now, we'll just copy info
          },
        },
        {
          label: 'Copy label',
          icon: '\u2398',
          shortcut: '\u2318C',
          onClick: () => {
            navigator.clipboard.writeText(attrs.label).catch(() => {});
          },
        },
      ];
      if (attrs.filePath) {
        items.push({
          label: 'Copy file path',
          icon: '\u2386',
          onClick: () => {
            navigator.clipboard.writeText(attrs.filePath).catch(() => {});
          },
        });
      }
      return items;
    }, [contextMenu, graph, focusNode]);

    // Save bookmark
    const saveBookmark = useCallback(() => {
      const camera = getCameraState();
      if (!camera) return;
      const name = prompt('Bookmark name:');
      if (!name) return;
      const bookmark: ViewBookmark = {
        id: crypto.randomUUID(),
        name,
        cameraState: camera,
        hiddenTypes: Array.from(hiddenTypes),
        activeFolder,
        timestamp: Date.now(),
      };
      const newBookmarks = [...bookmarks, bookmark];
      setBookmarks(newBookmarks);
      try { localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(newBookmarks)); } catch {}
    }, [getCameraState, hiddenTypes, activeFolder, bookmarks]);

    const deleteBookmark = useCallback((id: string) => {
      const newBookmarks = bookmarks.filter(b => b.id !== id);
      setBookmarks(newBookmarks);
      try { localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(newBookmarks)); } catch {}
    }, [bookmarks]);

    const nodeCount = graph ? graph.order : 0;
    const edgeCount = graph ? graph.size : 0;

    const selectedNodeInfo = useMemo(() => {
      if (!selectedNodeId || !graph || !graph.hasNode(selectedNodeId)) return null;
      const attrs = graph.getNodeAttributes(selectedNodeId);
      return {
        label: attrs.label,
        nodeType: attrs.nodeType,
        color: attrs.color,
      };
    }, [selectedNodeId, graph]);

    return (
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        {/* Background with dot grid texture */}
        <div style={{
          position: 'absolute',
          inset: 0,
          background: BG_PRIMARY,
          backgroundImage: DOT_GRID,
          backgroundSize: '32px 32px',
          zIndex: 0,
        }} />

        {/* Subtle radial vignette */}
        <div style={{
          position: 'absolute',
          inset: 0,
          background: 'radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.4) 100%)',
          pointerEvents: 'none',
          zIndex: 1,
        }} />

        {/* Sigma container */}
        <div
          ref={containerRef}
          style={{
            width: '100%',
            height: '100%',
            position: 'relative',
            zIndex: 2,
            background: 'transparent',
          }}
        />

        {/* Zoom controls + action buttons */}
        <div style={{
          position: 'absolute',
          top: 16,
          right: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          zIndex: 10,
        }}>
          <ZoomBtn label="+" onClick={zoomIn} title="Zoom in" />
          <ZoomBtn label="−" onClick={zoomOut} title="Zoom out" />
          <ZoomBtn label="⌂" onClick={resetZoom} title="Fit to view" />
          <div style={{ height: 6 }} />
          <ZoomBtn label="↓" onClick={exportPNG} title="Export PNG" />
          <ZoomBtn label="★" onClick={saveBookmark} title="Save bookmark" />
          <ZoomBtn
            label="☰"
            onClick={() => setShowBookmarks(!showBookmarks)}
            title="Saved views"
            active={showBookmarks}
          />
        </div>

        {/* Bookmarks dropdown */}
        {showBookmarks && (
          <div style={{
            position: 'absolute',
            top: 16 + 7 * 32 + 12,
            right: 16,
            width: 200,
            maxHeight: 240,
            overflow: 'auto',
            background: 'rgba(14,14,28,0.95)',
            backdropFilter: 'blur(16px)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 8,
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
            zIndex: 11,
            padding: '4px 0',
          }}>
            {bookmarks.length === 0 && (
              <div style={{ padding: '10px 14px', color: '#4d5a73', fontSize: 12 }}>
                No saved views
              </div>
            )}
            {bookmarks.map(b => (
              <div
                key={b.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '6px 10px',
                  cursor: 'pointer',
                  fontSize: 12,
                  color: '#c8d0e0',
                  gap: 6,
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(59,130,246,0.12)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                onClick={() => {
                  setCameraState(b.cameraState);
                  setShowBookmarks(false);
                }}
              >
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {b.name}
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); deleteBookmark(b.id); }}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#4d5a73',
                    cursor: 'pointer',
                    fontSize: 11,
                    padding: '2px 4px',
                    borderRadius: 3,
                    flexShrink: 0,
                  }}
                  onMouseEnter={e => (e.currentTarget.style.color = '#ef4444')}
                  onMouseLeave={e => (e.currentTarget.style.color = '#4d5a73')}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Path found indicator */}
        {pathNodes && pathNodes.size > 0 && (
          <div style={{
            position: 'absolute',
            top: 16,
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 16px',
            borderRadius: 8,
            background: 'rgba(249,115,22,0.15)',
            border: '1px solid rgba(249,115,22,0.3)',
            fontSize: 12,
            color: '#f97316',
            zIndex: 10,
          }}>
            <span>Path: {pathNodes.size} nodes</span>
            <button
              onClick={onClearPath}
              style={{
                background: 'rgba(249,115,22,0.2)',
                border: '1px solid rgba(249,115,22,0.3)',
                color: '#f97316',
                padding: '2px 8px',
                borderRadius: 4,
                cursor: 'pointer',
                fontSize: 11,
              }}
            >
              Clear
            </button>
          </div>
        )}

        {/* Layout mode buttons */}
        <div style={{
          position: 'absolute',
          top: 16,
          left: 16,
          display: 'flex',
          gap: 2,
          zIndex: 10,
        }}>
          {(['force', 'tree', 'radial'] as LayoutMode[]).map(mode => (
            <button
              key={mode}
              onClick={() => onLayoutModeChange(mode)}
              style={{
                width: 28,
                height: 28,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: layoutMode === mode ? '1px solid rgba(99,102,241,0.5)' : '1px solid rgba(255,255,255,0.06)',
                borderRadius: 6,
                background: layoutMode === mode ? 'rgba(99,102,241,0.2)' : 'rgba(8,8,18,0.6)',
                backdropFilter: 'blur(8px)',
                color: layoutMode === mode ? '#a5b4fc' : 'rgba(255,255,255,0.35)',
                fontSize: 11,
                fontWeight: 600,
                fontFamily: '"JetBrains Mono", monospace',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                padding: 0,
              }}
              title={mode === 'force' ? 'Force layout' : mode === 'tree' ? 'Tree layout' : 'Radial layout'}
            >
              {mode === 'force' ? 'F' : mode === 'tree' ? 'T' : 'R'}
            </button>
          ))}
        </div>

        {/* Minimap — bottom-right */}
        <canvas
          ref={minimapRef}
          width={150}
          height={100}
          onClick={handleMinimapClick}
          style={{
            position: 'absolute',
            bottom: 46,
            right: 16,
            width: 150,
            height: 100,
            borderRadius: 6,
            border: '1px solid rgba(255,255,255,0.06)',
            cursor: 'crosshair',
            zIndex: 10,
          }}
        />

        {/* Local graph panel — bottom-left */}
        {selectedNodeId && (
          <canvas
            ref={localGraphRef}
            width={200}
            height={150}
            onClick={handleLocalGraphClick}
            style={{
              position: 'absolute',
              bottom: 36,
              left: 14,
              width: 200,
              height: 150,
              borderRadius: 6,
              border: '1px solid rgba(255,255,255,0.06)',
              cursor: 'pointer',
              zIndex: 10,
            }}
          />
        )}

        {/* Timeline slider — trust tier filter */}
        <div style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: 32,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '0 16px',
          background: 'rgba(8,8,18,0.7)',
          backdropFilter: 'blur(8px)',
          borderTop: '1px solid rgba(255,255,255,0.04)',
          zIndex: 10,
          fontSize: 9,
          fontFamily: '"JetBrains Mono", monospace',
          color: 'rgba(255,255,255,0.3)',
        }}>
          <span style={{ flexShrink: 0, width: 75 }}>
            {maxTrustTier === 1 ? 'Tier 1 (User)' :
             maxTrustTier === 2 ? 'Tier 2 (Code)' :
             maxTrustTier === 3 ? 'Tier 3 (Inferred)' :
             'Tier 4 (External)'}
          </span>
          <input
            type="range"
            min={1}
            max={4}
            step={1}
            value={maxTrustTier}
            onChange={(e) => onMaxTrustTierChange(Number(e.target.value))}
            style={{
              flex: 1,
              height: 4,
              appearance: 'none',
              WebkitAppearance: 'none',
              background: 'rgba(255,255,255,0.08)',
              borderRadius: 2,
              outline: 'none',
              cursor: 'pointer',
              accentColor: '#6366f1',
            }}
          />
          <span style={{ flexShrink: 0 }}>Show all</span>
        </div>

        {/* Stats -- bottom-left */}
        <div style={{
          position: 'absolute',
          bottom: 46,
          left: 14,
          display: 'flex',
          gap: 10,
          fontSize: 10,
          fontFamily: '"JetBrains Mono", monospace',
          color: 'rgba(255,255,255,0.18)',
          pointerEvents: 'none',
          userSelect: 'none',
          zIndex: 10,
          letterSpacing: '0.02em',
        }}>
          <span>{nodeCount} nodes</span>
          <span>{edgeCount} edges</span>
        </div>

        {/* Keyboard shortcuts hint -- bottom-right */}
        <div style={{
          position: 'absolute',
          bottom: 46,
          right: 180,
          fontSize: 9,
          fontFamily: '"JetBrains Mono", monospace',
          color: 'rgba(255,255,255,0.12)',
          pointerEvents: 'none',
          userSelect: 'none',
          zIndex: 10,
        }}>
          Arrows: navigate | Tab: cycle | Esc: deselect | Shift+click: path
        </div>

        {/* Selection info -- bottom-center */}
        {selectedNodeInfo && (
          <div style={{
            position: 'absolute',
            bottom: 46,
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '5px 14px',
            borderRadius: 8,
            background: 'rgba(8,8,18,0.8)',
            backdropFilter: 'blur(12px)',
            border: `1px solid ${selectedNodeInfo.color}22`,
            fontSize: 12,
            color: '#cdd6e4',
            pointerEvents: 'none',
            userSelect: 'none',
            zIndex: 10,
          }}>
            <span style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: selectedNodeInfo.color,
              boxShadow: `0 0 8px ${selectedNodeInfo.color}60`,
              flexShrink: 0,
            }} />
            <span style={{
              fontSize: 9,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: selectedNodeInfo.color,
              fontWeight: 600,
            }}>
              {selectedNodeInfo.nodeType}
            </span>
            <span style={{ fontWeight: 500 }}>{selectedNodeInfo.label}</span>
          </div>
        )}

        {/* Context menu */}
        {contextMenu && (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            items={contextMenuItems}
            onClose={() => setContextMenu(null)}
          />
        )}
      </div>
    );
  },
);

GraphCanvas.displayName = 'GraphCanvas';
export default GraphCanvas;

function ZoomBtn({ label, onClick, title, active }: { label: string; onClick: () => void; title: string; active?: boolean }) {
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);

  return (
    <button
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setPressed(false); }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      style={{
        width: 30,
        height: 30,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: active ? '1px solid rgba(59,130,246,0.4)' : '1px solid rgba(255,255,255,0.06)',
        borderRadius: 8,
        background: active ? 'rgba(59,130,246,0.15)' : hovered ? 'rgba(255,255,255,0.08)' : 'rgba(8,8,18,0.6)',
        backdropFilter: 'blur(8px)',
        color: active ? '#60a5fa' : hovered ? '#cdd6e4' : 'rgba(255,255,255,0.35)',
        fontSize: 15,
        fontFamily: '"DM Sans", sans-serif',
        cursor: 'pointer',
        transition: 'all 0.15s ease',
        transform: pressed ? 'scale(0.9)' : 'scale(1)',
        lineHeight: 1,
        padding: 0,
      }}
    >
      {label}
    </button>
  );
}
