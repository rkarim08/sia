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
import { BG_PRIMARY, DEFAULT_VISIBLE_TYPES } from '../lib/constants';

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

const GraphCanvas = forwardRef<GraphCanvasHandle, Props>(
  ({ data, onNodeClick, onStageClick, selectedNodeId, hiddenTypes }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);

    // ----- Build graphology graph from response data -----
    const graph = useMemo<Graph<SigmaNodeAttributes, SigmaEdgeAttributes> | null>(() => {
      if (!data) return null;
      return graphResponseToGraphology(data);
    }, [data]);

    // ----- Apply hidden-types filter whenever it changes -----
    useEffect(() => {
      if (!graph) return;
      const visibleTypes = DEFAULT_VISIBLE_TYPES.filter(
        (t) => !hiddenTypes.has(t),
      );
      filterGraphByTypes(graph, visibleTypes);
    }, [graph, hiddenTypes]);

    // ----- Wire click events: translate sigma attrs back to GraphNode -----
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

    // ----- Hook into Sigma -----
    const { zoomIn, zoomOut, resetZoom, focusNode } = useSigma(
      containerRef as React.RefObject<HTMLDivElement>,
      graph,
      {
        onNodeClick: handleNodeClick,
        onStageClick,
        selectedNodeId,
      },
    );

    // ----- Expose focusNode to parent via ref -----
    useImperativeHandle(ref, () => ({ focusNode }), [focusNode]);

    // ----- Stats -----
    const nodeCount = graph ? graph.order : 0;
    const edgeCount = graph ? graph.size : 0;

    // ----- Selected node info -----
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
        {/* Sigma container */}
        <div
          ref={containerRef}
          style={{
            width: '100%',
            height: '100%',
            background: BG_PRIMARY,
          }}
        />

        {/* Zoom controls — top-right */}
        <div
          style={{
            position: 'absolute',
            top: 12,
            right: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
          }}
        >
          <ZoomButton label="+" onClick={zoomIn} title="Zoom in" />
          <ZoomButton label="\u2013" onClick={zoomOut} title="Zoom out" />
          <ZoomButton label="\u2302" onClick={resetZoom} title="Fit to view" />
        </div>

        {/* Node / Edge count — bottom-left */}
        <div
          style={{
            position: 'absolute',
            bottom: 12,
            left: 12,
            display: 'flex',
            gap: 12,
            fontSize: 11,
            fontFamily: 'JetBrains Mono, monospace',
            color: 'rgba(255,255,255,0.45)',
            pointerEvents: 'none',
            userSelect: 'none',
          }}
        >
          <span>{nodeCount} nodes</span>
          <span>{edgeCount} edges</span>
        </div>

        {/* Selection info bar — bottom-center */}
        {selectedNodeInfo && (
          <div
            style={{
              position: 'absolute',
              bottom: 12,
              left: '50%',
              transform: 'translateX(-50%)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 14px',
              borderRadius: 6,
              background: 'rgba(18, 18, 28, 0.85)',
              backdropFilter: 'blur(6px)',
              border: '1px solid rgba(255,255,255,0.08)',
              fontSize: 12,
              fontFamily: 'JetBrains Mono, monospace',
              color: '#e4e4ed',
              pointerEvents: 'none',
              userSelect: 'none',
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: selectedNodeInfo.color,
                flexShrink: 0,
              }}
            />
            <span style={{ opacity: 0.5, textTransform: 'uppercase', fontSize: 10 }}>
              {selectedNodeInfo.nodeType}
            </span>
            <span>{selectedNodeInfo.label}</span>
          </div>
        )}
      </div>
    );
  },
);

GraphCanvas.displayName = 'GraphCanvas';
export default GraphCanvas;

// ---------------------------------------------------------------------------
// Zoom button sub-component
// ---------------------------------------------------------------------------

function ZoomButton({
  label,
  onClick,
  title,
}: {
  label: string;
  onClick: () => void;
  title: string;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: 32,
        height: 32,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 8,
        background: hovered
          ? 'rgba(255,255,255,0.12)'
          : 'rgba(18, 18, 28, 0.75)',
        backdropFilter: 'blur(6px)',
        color: '#e4e4ed',
        fontSize: 16,
        fontFamily: 'JetBrains Mono, monospace',
        cursor: 'pointer',
        transition: 'background 0.15s',
        lineHeight: 1,
        padding: 0,
      }}
    >
      {label}
    </button>
  );
}
