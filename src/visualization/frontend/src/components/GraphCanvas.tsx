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
import type { SigmaNodeAttributes, SigmaEdgeAttributes, ViewBookmark } from '../types';
import {
  graphResponseToGraphology,
  filterGraphByTypes,
  filterGraphByFolder,
  getNodeDistances,
  findShortestPath,
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
  ({ data, onNodeClick, onStageClick, selectedNodeId, hiddenTypes, activeFolder, blastRadiusMode, colorByFolder, pathSource, pathTarget, onClearPath }, ref) => {
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

    const { zoomIn, zoomOut, resetZoom, focusNode, exportPNG, getCameraState, setCameraState } = useSigma(
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
          <ZoomBtn label="\u2212" onClick={zoomOut} title="Zoom out" />
          <ZoomBtn label="\u2302" onClick={resetZoom} title="Fit to view" />
          <div style={{ height: 6 }} />
          <ZoomBtn label="\u2B07" onClick={exportPNG} title="Export PNG" />
          <ZoomBtn label="\u2605" onClick={saveBookmark} title="Save bookmark" />
          <ZoomBtn
            label="\u2630"
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
                  \u2715
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

        {/* Stats -- bottom-left */}
        <div style={{
          position: 'absolute',
          bottom: 14,
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
          bottom: 14,
          right: 54,
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
            bottom: 14,
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
