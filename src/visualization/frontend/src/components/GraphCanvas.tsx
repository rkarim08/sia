import { useEffect, useRef, useCallback } from 'react';
import Graph from 'graphology';
import Sigma from 'sigma';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import noverlap from 'graphology-layout-noverlap';
import type { GraphResponse, GraphNode } from '../lib/api';
import { NODE_COLORS, NODE_SIZES, EDGE_DEFAULT_COLOR, EDGE_HOVER_COLOR } from '../lib/constants';

interface Props {
  data: GraphResponse | null;
  onNodeClick: (node: GraphNode) => void;
  onStageClick: () => void;
  selectedNodeId: string | null;
  hiddenTypes: Set<string>;
}

export default function GraphCanvas({ data, onNodeClick, onStageClick, selectedNodeId, hiddenTypes }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const graphRef = useRef<Graph | null>(null);
  const hoveredNodeRef = useRef<string | null>(null);
  const hoveredNeighborsRef = useRef<Set<string>>(new Set());

  const buildGraph = useCallback(() => {
    if (!data || !containerRef.current) return;

    // Clean up previous instance
    if (sigmaRef.current) {
      sigmaRef.current.kill();
      sigmaRef.current = null;
    }

    const graph = new Graph();
    graphRef.current = graph;

    // Add nodes
    for (const node of data.nodes) {
      if (hiddenTypes.has(node.nodeType)) continue;
      const color = node.color || NODE_COLORS[node.nodeType] || '#888888';
      const baseSize = NODE_SIZES[node.nodeType] || 4;
      const size = baseSize + node.importance * 12;

      graph.addNode(node.id, {
        x: Math.random() * 1000,
        y: Math.random() * 1000,
        size,
        color,
        label: node.label,
        // Store metadata for later use
        nodeType: node.nodeType,
        filePath: node.filePath,
        entityId: node.entityId,
        importance: node.importance,
        trustTier: node.trustTier,
        parentId: node.parentId,
      });
    }

    // Add edges (only if both source and target exist)
    for (const edge of data.edges) {
      if (graph.hasNode(edge.source) && graph.hasNode(edge.target)) {
        // Avoid duplicate edges
        if (!graph.hasEdge(edge.id)) {
          graph.addEdgeWithKey(edge.id, edge.source, edge.target, {
            color: EDGE_DEFAULT_COLOR,
            size: Math.max(0.5, edge.weight),
            edgeType: edge.edgeType,
            label: edge.label,
          });
        }
      }
    }

    if (graph.order === 0) return;

    // Run ForceAtlas2 synchronous layout
    forceAtlas2.assign(graph, {
      iterations: 300,
      settings: {
        barnesHutOptimize: true,
        gravity: 1,
        scalingRatio: 10,
      },
    });

    // Run noverlap to prevent node overlap
    noverlap.assign(graph, {
      maxIterations: 100,
      settings: {
        margin: 2,
      },
    });

    // Create Sigma renderer
    const renderer = new Sigma(graph, containerRef.current, {
      labelRenderedSizeThreshold: 6,
      labelColor: { color: '#e0e0e0' },
      defaultEdgeColor: EDGE_DEFAULT_COLOR,
      defaultNodeColor: '#888888',
      // Node reducer for hover/selection highlighting
      nodeReducer: (node, attrs) => {
        const res = { ...attrs };
        const hovered = hoveredNodeRef.current;
        const neighbors = hoveredNeighborsRef.current;

        if (hovered) {
          if (node === hovered) {
            res.highlighted = true;
            res.zIndex = 1;
          } else if (neighbors.has(node)) {
            res.highlighted = true;
          } else {
            res.color = '#333';
            res.label = '';
            res.zIndex = -1;
          }
        }

        if (selectedNodeId && node === selectedNodeId) {
          res.highlighted = true;
          res.zIndex = 1;
        }

        return res;
      },
      // Edge reducer for hover highlighting
      edgeReducer: (edge, attrs) => {
        const res = { ...attrs };
        const hovered = hoveredNodeRef.current;

        if (hovered) {
          const src = graph.source(edge);
          const tgt = graph.target(edge);
          if (src === hovered || tgt === hovered) {
            res.color = EDGE_HOVER_COLOR;
            res.size = 2;
            res.zIndex = 1;
          } else {
            res.color = 'rgba(255,255,255,0.03)';
            res.hidden = true;
          }
        }

        return res;
      },
    });

    sigmaRef.current = renderer;

    // Event: hover node
    renderer.on('enterNode', ({ node }) => {
      hoveredNodeRef.current = node;
      hoveredNeighborsRef.current = new Set(graph.neighbors(node));
      renderer.refresh();
    });

    renderer.on('leaveNode', () => {
      hoveredNodeRef.current = null;
      hoveredNeighborsRef.current = new Set();
      renderer.refresh();
    });

    // Event: click node
    renderer.on('clickNode', ({ node }) => {
      const attrs = graph.getNodeAttributes(node);
      onNodeClick({
        id: node,
        label: attrs.label,
        parentId: attrs.parentId,
        nodeType: attrs.nodeType,
        filePath: attrs.filePath,
        importance: attrs.importance,
        trustTier: attrs.trustTier,
        color: attrs.color,
        entityId: attrs.entityId,
      });
    });

    // Event: click stage (background)
    renderer.on('clickStage', () => {
      onStageClick();
    });

    // Expose for debugging
    (window as any)._sigma = renderer;
    (window as any)._graph = graph;
  }, [data, hiddenTypes, onNodeClick, onStageClick, selectedNodeId]);

  useEffect(() => {
    buildGraph();
    return () => {
      if (sigmaRef.current) {
        sigmaRef.current.kill();
        sigmaRef.current = null;
      }
    };
  }, [buildGraph]);

  // Refresh sigma when selectedNodeId changes without rebuilding
  useEffect(() => {
    if (sigmaRef.current) {
      sigmaRef.current.refresh();
    }
  }, [selectedNodeId]);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        background: '#1a1a2e',
      }}
    />
  );
}
