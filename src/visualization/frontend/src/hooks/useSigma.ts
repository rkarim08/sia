import { useRef, useEffect, useCallback } from 'react';
import Sigma from 'sigma';
import Graph from 'graphology';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import noverlap from 'graphology-layout-noverlap';
import type { SigmaNodeAttributes, SigmaEdgeAttributes } from '../types';
import { EDGE_DEFAULT_COLOR, EDGE_HOVER_COLOR } from '../lib/constants';

// ---------------------------------------------------------------------------
// Color helpers (ported from GitNexus)
// ---------------------------------------------------------------------------

const hexToRgb = (hex: string): { r: number; g: number; b: number } => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : { r: 100, g: 100, b: 100 };
};

const rgbToHex = (r: number, g: number, b: number): string => {
  return (
    '#' +
    [r, g, b]
      .map((x) => {
        const hex = Math.max(0, Math.min(255, Math.round(x))).toString(16);
        return hex.length === 1 ? '0' + hex : hex;
      })
      .join('')
  );
};

/** Dim a color by mixing towards a dark background. `amount` 0 = fully dark, 1 = original. */
const dimColor = (hex: string, amount: number): string => {
  const rgb = hexToRgb(hex);
  const darkBg = { r: 26, g: 26, b: 46 }; // matches BG_PRIMARY #1a1a2e
  return rgbToHex(
    darkBg.r + (rgb.r - darkBg.r) * amount,
    darkBg.g + (rgb.g - darkBg.g) * amount,
    darkBg.b + (rgb.b - darkBg.b) * amount,
  );
};

/** Brighten a color towards white. */
const brightenColor = (hex: string, factor: number): string => {
  const rgb = hexToRgb(hex);
  return rgbToHex(
    rgb.r + ((255 - rgb.r) * (factor - 1)) / factor,
    rgb.g + ((255 - rgb.g) * (factor - 1)) / factor,
    rgb.b + ((255 - rgb.b) * (factor - 1)) / factor,
  );
};

// ---------------------------------------------------------------------------
// ForceAtlas2 iteration count — scales with node count
// ---------------------------------------------------------------------------

const getFA2Iterations = (nodeCount: number): number => {
  if (nodeCount > 5000) return 100;
  if (nodeCount > 2000) return 150;
  if (nodeCount > 500) return 200;
  return 300;
};

// ---------------------------------------------------------------------------
// Hook interface
// ---------------------------------------------------------------------------

export interface UseSigmaOptions {
  onNodeClick?: (nodeId: string, attrs: SigmaNodeAttributes) => void;
  onStageClick?: () => void;
  selectedNodeId?: string | null;
}

export interface UseSigmaReturn {
  sigmaRef: React.MutableRefObject<Sigma | null>;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  focusNode: (nodeId: string) => void;
}

// ---------------------------------------------------------------------------
// useSigma hook
// ---------------------------------------------------------------------------

export function useSigma(
  containerRef: React.RefObject<HTMLDivElement>,
  graph: Graph<SigmaNodeAttributes, SigmaEdgeAttributes> | null,
  options: UseSigmaOptions,
): UseSigmaReturn {
  const sigmaRef = useRef<Sigma | null>(null);
  const hoveredNodeRef = useRef<string | null>(null);
  const hoveredNeighborsRef = useRef<Set<string>>(new Set());

  // Keep options in a ref so the reducers always see the latest values
  // without causing Sigma to be recreated.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // -------------------------------------------------------------------
  // Create / destroy Sigma when container or graph changes
  // -------------------------------------------------------------------
  useEffect(() => {
    if (!containerRef.current || !graph || graph.order === 0) {
      // Tear down if graph is null/empty but renderer exists
      if (sigmaRef.current) {
        sigmaRef.current.kill();
        sigmaRef.current = null;
      }
      return;
    }

    // ------- Layout: synchronous ForceAtlas2 + noverlap -------
    const nodeCount = graph.order;

    forceAtlas2.assign(graph, {
      iterations: getFA2Iterations(nodeCount),
      settings: {
        barnesHutOptimize: true,
        gravity: 1,
        scalingRatio: 10,
      },
    });

    noverlap.assign(graph, {
      maxIterations: 100,
      settings: {
        margin: 2,
      },
    });

    // ------- Sigma renderer -------
    const renderer = new Sigma(graph, containerRef.current, {
      renderLabels: true,
      labelFont: 'JetBrains Mono, monospace',
      labelSize: 11,
      labelWeight: '500',
      labelColor: { color: '#e4e4ed' },
      labelRenderedSizeThreshold: 8,
      labelDensity: 0.1,
      labelGridCellSize: 70,

      defaultNodeColor: '#6b7280',
      defaultEdgeColor: EDGE_DEFAULT_COLOR,

      minCameraRatio: 0.002,
      maxCameraRatio: 50,
      hideEdgesOnMove: true,
      zIndex: true,

      // ------ Custom hover renderer (dark pill with colored border) ------
      defaultDrawNodeHover: (context, data, settings) => {
        const label = data.label;
        if (!label) return;

        const size = settings.labelSize || 11;
        const font = settings.labelFont || 'JetBrains Mono, monospace';
        const weight = settings.labelWeight || '500';

        context.font = `${weight} ${size}px ${font}`;
        const textWidth = context.measureText(label).width;

        const nodeSize = data.size || 8;
        const x = data.x;
        const y = data.y - nodeSize - 10;
        const paddingX = 8;
        const paddingY = 5;
        const height = size + paddingY * 2;
        const width = textWidth + paddingX * 2;
        const radius = 4;

        // Dark background pill
        context.fillStyle = '#12121c';
        context.beginPath();
        context.roundRect(x - width / 2, y - height / 2, width, height, radius);
        context.fill();

        // Border matching node color
        context.strokeStyle = data.color || '#6366f1';
        context.lineWidth = 2;
        context.stroke();

        // Label text
        context.fillStyle = '#f5f5f7';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(label, x, y);

        // Subtle glow ring around the node
        context.beginPath();
        context.arc(data.x, data.y, nodeSize + 4, 0, Math.PI * 2);
        context.strokeStyle = data.color || '#6366f1';
        context.lineWidth = 2;
        context.globalAlpha = 0.5;
        context.stroke();
        context.globalAlpha = 1;
      },

      // ------ Node reducer: hover + selection highlighting ------
      nodeReducer: (node, data) => {
        const res = { ...data };
        if (data.hidden) {
          res.hidden = true;
          return res;
        }

        const hovered = hoveredNodeRef.current;
        const neighbors = hoveredNeighborsRef.current;
        const selected = optionsRef.current.selectedNodeId;

        // Hover highlighting
        if (hovered) {
          if (node === hovered) {
            // Hovered node keeps its color
            res.highlighted = true;
            res.zIndex = 2;
          } else if (neighbors.has(node)) {
            // Neighbors slightly dimmed
            res.color = dimColor(data.color, 0.7);
            res.highlighted = true;
            res.zIndex = 1;
          } else {
            // All others heavily dimmed
            res.color = dimColor(data.color, 0.15);
            res.label = '';
            res.zIndex = -1;
          }
        }

        // Selection highlighting (applied on top of / instead of hover)
        if (selected) {
          if (node === selected) {
            res.color = data.color;
            res.size = (data.size || 8) * 1.6;
            res.highlighted = true;
            res.zIndex = 2;
          } else if (!hovered) {
            // When there's a selection but no hover, dim non-selected nodes
            const isNeighbor =
              graph.hasEdge(node, selected) || graph.hasEdge(selected, node);
            if (isNeighbor) {
              res.color = data.color;
              res.size = (data.size || 8) * 1.2;
              res.zIndex = 1;
            } else {
              res.color = dimColor(data.color, 0.25);
              res.size = (data.size || 8) * 0.6;
              res.zIndex = 0;
            }
          }
        }

        return res;
      },

      // ------ Edge reducer: hover + selection highlighting ------
      edgeReducer: (edge, data) => {
        const res = { ...data };
        const hovered = hoveredNodeRef.current;
        const selected = optionsRef.current.selectedNodeId;

        if (hovered) {
          const src = graph.source(edge);
          const tgt = graph.target(edge);
          if (src === hovered || tgt === hovered) {
            res.color = EDGE_HOVER_COLOR;
            res.size = Math.max(2, (data.size || 1) * 3);
            res.zIndex = 2;
          } else {
            res.color = dimColor(EDGE_DEFAULT_COLOR, 0.08);
            res.size = 0.2;
            res.zIndex = 0;
          }
          return res;
        }

        if (selected) {
          const src = graph.source(edge);
          const tgt = graph.target(edge);
          const isConnected = src === selected || tgt === selected;
          if (isConnected) {
            res.color = brightenColor(data.color, 1.5);
            res.size = Math.max(3, (data.size || 1) * 4);
            res.zIndex = 2;
          } else {
            res.color = dimColor(data.color, 0.1);
            res.size = 0.3;
            res.zIndex = 0;
          }
        }

        return res;
      },
    });

    sigmaRef.current = renderer;

    // ------- Events -------

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

    renderer.on('clickNode', ({ node }) => {
      const attrs = graph.getNodeAttributes(node) as SigmaNodeAttributes;
      optionsRef.current.onNodeClick?.(node, attrs);
    });

    renderer.on('clickStage', () => {
      optionsRef.current.onStageClick?.();
    });

    return () => {
      renderer.kill();
      sigmaRef.current = null;
      hoveredNodeRef.current = null;
      hoveredNeighborsRef.current = new Set();
    };
  }, [containerRef, graph]);

  // -------------------------------------------------------------------
  // Refresh when selectedNodeId changes (no full rebuild needed)
  // -------------------------------------------------------------------
  useEffect(() => {
    sigmaRef.current?.refresh();
  }, [options.selectedNodeId]);

  // -------------------------------------------------------------------
  // Camera controls
  // -------------------------------------------------------------------

  const zoomIn = useCallback(() => {
    sigmaRef.current?.getCamera().animatedZoom({ duration: 200 });
  }, []);

  const zoomOut = useCallback(() => {
    sigmaRef.current?.getCamera().animatedUnzoom({ duration: 200 });
  }, []);

  const resetZoom = useCallback(() => {
    sigmaRef.current?.getCamera().animatedReset({ duration: 300 });
  }, []);

  const focusNode = useCallback(
    (nodeId: string) => {
      const sigma = sigmaRef.current;
      if (!sigma || !graph || !graph.hasNode(nodeId)) return;

      const nodePosition = sigma.getNodeDisplayData(nodeId);
      if (!nodePosition) return;

      sigma.getCamera().animate(
        { x: nodePosition.x, y: nodePosition.y, ratio: 0.15 },
        { duration: 400 },
      );
    },
    [graph],
  );

  return {
    sigmaRef,
    zoomIn,
    zoomOut,
    resetZoom,
    focusNode,
  };
}
