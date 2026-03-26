import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import Graph from 'graphology';
import type { GraphResponse, GraphNode } from '../lib/api';
import type { SigmaNodeAttributes, SigmaEdgeAttributes } from '../types';
import { graphResponseToGraphology, filterGraphByTypes } from '../lib/graph-adapter';
import { useSigma } from '../hooks/useSigma';
import { BG_PRIMARY, DEFAULT_VISIBLE_TYPES, NODE_COLORS } from '../lib/constants';
import type { SiaNodeType } from '../lib/constants';

interface Props {
  data: GraphResponse | null;
  onNodeClick: (node: GraphNode) => void;
  onStageClick: () => void;
  selectedNodeId: string | null;
  hiddenTypes: Set<string>;
}

export interface GraphCanvasHandle {
  focusNode: (nodeId: string) => void;
}

// Subtle dot grid SVG as data URI for background texture
const DOT_GRID = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32'%3E%3Ccircle cx='1' cy='1' r='0.6' fill='rgba(255,255,255,0.04)'/%3E%3C/svg%3E")`;

const GraphCanvas = forwardRef<GraphCanvasHandle, Props>(
  ({ data, onNodeClick, onStageClick, selectedNodeId, hiddenTypes }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);

    const graph = useMemo<Graph<SigmaNodeAttributes, SigmaEdgeAttributes> | null>(() => {
      if (!data) return null;
      return graphResponseToGraphology(data);
    }, [data]);

    useEffect(() => {
      if (!graph) return;
      const visibleTypes = DEFAULT_VISIBLE_TYPES.filter(
        (t) => !hiddenTypes.has(t),
      );
      filterGraphByTypes(graph, visibleTypes);
    }, [graph, hiddenTypes]);

    const handleNodeClick = (nodeId: string, attrs: SigmaNodeAttributes) => {
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

    const { zoomIn, zoomOut, resetZoom, focusNode } = useSigma(
      containerRef as React.RefObject<HTMLDivElement>,
      graph,
      {
        onNodeClick: handleNodeClick,
        onStageClick,
        selectedNodeId,
      },
    );

    useImperativeHandle(ref, () => ({ focusNode }), [focusNode]);

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

        {/* Zoom controls */}
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
        </div>

        {/* Stats — bottom-left */}
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

        {/* Selection info — bottom-center */}
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
      </div>
    );
  },
);

GraphCanvas.displayName = 'GraphCanvas';
export default GraphCanvas;

function ZoomBtn({ label, onClick, title }: { label: string; onClick: () => void; title: string }) {
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
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: 8,
        background: hovered ? 'rgba(255,255,255,0.08)' : 'rgba(8,8,18,0.6)',
        backdropFilter: 'blur(8px)',
        color: hovered ? '#cdd6e4' : 'rgba(255,255,255,0.35)',
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
