import { useRef, useEffect, useCallback } from 'react';
import Sigma from 'sigma';
import Graph from 'graphology';
import forceAtlas2, { inferSettings } from 'graphology-layout-forceatlas2';
import noverlap from 'graphology-layout-noverlap';
import type { SigmaNodeAttributes, SigmaEdgeAttributes } from '../types';
import { EDGE_DEFAULT_COLOR, EDGE_HOVER_COLOR, NODE_COLORS, COMMUNITY_COLORS } from '../lib/constants';
import type { SiaNodeType } from '../lib/constants';

// ---------------------------------------------------------------------------
// Color helpers
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
  const darkBg = { r: 12, g: 12, b: 26 }; // matches BG_PRIMARY #0c0c1a
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
// Convex hull helpers for cluster overlays
// ---------------------------------------------------------------------------

const hexToRgbHull = (hex: string): { r: number; g: number; b: number } => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) }
    : { r: 100, g: 100, b: 100 };
};

type Point = { x: number; y: number };

/** Cross product of vectors OA and OB where O is origin */
const cross = (O: Point, A: Point, B: Point): number =>
  (A.x - O.x) * (B.y - O.y) - (A.y - O.y) * (B.x - O.x);

/** Graham scan convex hull */
const convexHull = (points: Point[]): Point[] => {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length <= 2) return pts;

  const lower: Point[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }

  const upper: Point[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }

  // Remove last point of each half because it's repeated
  lower.pop();
  upper.pop();
  return lower.concat(upper);
};

/** Inflate a polygon outward by a given distance */
const inflatePolygon = (hull: Point[], distance: number): Point[] => {
  // Compute centroid
  let cx = 0, cy = 0;
  hull.forEach(p => { cx += p.x; cy += p.y; });
  cx /= hull.length;
  cy /= hull.length;

  // Push each point outward from centroid
  return hull.map(p => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    return {
      x: p.x + (dx / len) * distance,
      y: p.y + (dy / len) * distance,
    };
  });
};

// ---------------------------------------------------------------------------
// Blast radius color scheme
// ---------------------------------------------------------------------------

const BLAST_COLORS: Record<number, string> = {
  0: '#ffffff',   // selected node
  1: '#f97316',   // 1-hop: bright orange
  2: '#facc15',   // 2-hop: warm yellow
  3: '#a3e635',   // 3-hop: pale green
};

const getBlastColor = (distance: number): string => {
  if (distance <= 3) return BLAST_COLORS[distance];
  return dimColor('#9ca3af', 0.2); // 4+: very dim
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
  onRightClickNode?: (nodeId: string, attrs: SigmaNodeAttributes, event: { x: number; y: number }) => void;
  selectedNodeId?: string | null;
  blastRadiusMode?: boolean;
  blastDistances?: Map<string, number> | null;
  colorByFolder?: boolean;
  clusterColorMap?: Map<string, string>;
  pathNodes?: Set<string> | null;
  pathEdgeKeys?: Set<string> | null;
  showHulls?: boolean;
}

export interface UseSigmaReturn {
  sigmaRef: React.MutableRefObject<Sigma | null>;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  focusNode: (nodeId: string) => void;
  exportPNG: () => void;
  getCameraState: () => { x: number; y: number; ratio: number; angle: number } | null;
  setCameraState: (state: { x: number; y: number; ratio: number; angle: number }) => void;
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
  const pulsePhaseRef = useRef(0);

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

    // Use inferSettings for auto-tuned parameters, then override for better spread
    const inferred = inferSettings(graph);
    const fa2Settings = {
      ...inferred,
      barnesHutOptimize: nodeCount > 100,
      gravity: inferred.gravity ? inferred.gravity * 0.3 : 0.01,
      scalingRatio: (inferred.scalingRatio || 10) * 5,
      strongGravityMode: false,
      slowDown: inferred.slowDown || 2,
      adjustSizes: true,
    };

    // Initial batch to establish structure
    forceAtlas2.assign(graph, {
      iterations: getFA2Iterations(nodeCount),
      settings: fa2Settings,
    });

    noverlap.assign(graph, {
      maxIterations: 300,
      settings: {
        margin: 15,
        ratio: 2.5,
      },
    });

    // ------- Continuous "live" layout for floating physics effect -------
    let animationFrameId: number | null = null;
    let liveIterations = 0;
    const maxLiveIterations = 600; // Run for ~10 seconds then stop
    const liveSettings = {
      ...fa2Settings,
      gravity: (fa2Settings.gravity || 0.01) * 2,
      slowDown: (fa2Settings.slowDown || 2) * 3,
    };

    const runLiveLayout = () => {
      if (liveIterations >= maxLiveIterations) return;
      forceAtlas2.assign(graph, {
        iterations: 1,
        settings: liveSettings,
      });
      liveIterations++;
      animationFrameId = requestAnimationFrame(runLiveLayout);
    };
    animationFrameId = requestAnimationFrame(runLiveLayout);

    // ------- Sigma renderer -------
    const renderer = new Sigma(graph, containerRef.current, {
      renderLabels: true,
      renderEdgeLabels: true,
      labelFont: 'Outfit, -apple-system, sans-serif',
      labelSize: 13,
      labelWeight: '500',
      labelColor: { color: '#b0bcd0' },
      labelRenderedSizeThreshold: 14,
      labelDensity: 0.04,
      labelGridCellSize: 120,

      edgeLabelFont: 'GeistMono, "Geist Mono", monospace',
      edgeLabelSize: 12,
      edgeLabelColor: { color: '#c8d0e0' },

      defaultNodeColor: '#6b7280',
      defaultEdgeColor: EDGE_DEFAULT_COLOR,

      minCameraRatio: 0.002,
      maxCameraRatio: 50,
      hideEdgesOnMove: true,
      zIndex: true,

      // ------ Custom hover renderer with radial glow + enhanced info ------
      defaultDrawNodeHover: (context, data, settings) => {
        const label = data.label;
        const nodeSize = data.size || 8;
        const color = data.color || '#6366f1';

        // Radial glow behind node
        const glowRadius = nodeSize * 4;
        const glow = context.createRadialGradient(
          data.x, data.y, nodeSize * 0.5,
          data.x, data.y, glowRadius,
        );
        const rgb = hexToRgb(color);
        glow.addColorStop(0, `rgba(${rgb.r},${rgb.g},${rgb.b},0.25)`);
        glow.addColorStop(0.5, `rgba(${rgb.r},${rgb.g},${rgb.b},0.08)`);
        glow.addColorStop(1, `rgba(${rgb.r},${rgb.g},${rgb.b},0)`);
        context.fillStyle = glow;
        context.beginPath();
        context.arc(data.x, data.y, glowRadius, 0, Math.PI * 2);
        context.fill();

        // Subtle ring
        context.beginPath();
        context.arc(data.x, data.y, nodeSize + 3, 0, Math.PI * 2);
        context.strokeStyle = color;
        context.lineWidth = 1.5;
        context.globalAlpha = 0.4;
        context.stroke();
        context.globalAlpha = 1;

        if (!label) return;

        const size = Math.max(14, settings.labelSize || 13);
        const font = settings.labelFont || 'Outfit, sans-serif';
        const weight = settings.labelWeight || '500';
        const infoSize = 12; // info line font size — larger for readability
        const badgeSize = 11; // badge font size

        // --- Enhanced tooltip with type badge, connections, trust tier ---
        const nodeId = (data as Record<string, unknown>).key as string | undefined;
        const nodeAttrs = nodeId && graph.hasNode(nodeId)
          ? graph.getNodeAttributes(nodeId)
          : null;
        const nodeType = nodeAttrs?.nodeType || '';
        const trustTier = nodeAttrs?.trustTier ?? 0;
        const connectionCount = nodeId && graph.hasNode(nodeId) ? graph.degree(nodeId) : 0;

        context.font = `${weight} ${size}px ${font}`;
        const labelWidth = context.measureText(label).width;

        // Type badge text
        const badgeText = nodeType.toUpperCase();
        context.font = `700 ${badgeSize}px ${font}`;
        const badgeWidth = context.measureText(badgeText).width;

        // Info line
        const infoText = `${connectionCount} connections`;
        context.font = `400 ${infoSize}px ${font}`;
        const infoWidth = context.measureText(infoText).width;

        // Trust dots width
        const trustDotsWidth = trustTier > 0 ? trustTier * 10 + 8 : 0;

        const maxContentWidth = Math.max(
          labelWidth,
          badgeWidth + 14 + infoWidth + trustDotsWidth,
        );

        const x = data.x;
        const y = data.y - nodeSize - 36;
        const paddingX = 14;
        const paddingY = 8;
        const totalHeight = size + 24 + paddingY * 2; // label + info line
        const width = maxContentWidth + paddingX * 2;
        const radius = 10;

        // Frosted pill background
        context.fillStyle = 'rgba(8,8,18,0.92)';
        context.beginPath();
        context.roundRect(x - width / 2, y - totalHeight / 2, width, totalHeight, radius);
        context.fill();

        // Colored top border accent
        context.strokeStyle = color;
        context.lineWidth = 1.5;
        context.globalAlpha = 0.6;
        context.stroke();
        context.globalAlpha = 1;

        // Type badge
        const badgeY = y - totalHeight / 2 + paddingY + badgeSize;
        const typeColor = NODE_COLORS[nodeType as SiaNodeType] || color;
        context.font = `700 ${badgeSize}px ${font}`;
        context.fillStyle = typeColor;
        context.textAlign = 'left';
        context.textBaseline = 'middle';
        context.fillText(badgeText, x - maxContentWidth / 2, badgeY);

        // Connection count
        context.font = `400 ${infoSize}px ${font}`;
        context.fillStyle = '#8896b0';
        context.fillText(infoText, x - maxContentWidth / 2 + badgeWidth + 14, badgeY);

        // Trust tier dots — larger
        if (trustTier > 0) {
          const dotsStartX = x + maxContentWidth / 2 - trustTier * 10;
          for (let i = 0; i < trustTier; i++) {
            context.beginPath();
            context.arc(dotsStartX + i * 10, badgeY, 3.5, 0, Math.PI * 2);
            context.fillStyle = i < trustTier
              ? (trustTier <= 2 ? '#34d399' : trustTier === 3 ? '#fbbf24' : '#ef4444')
              : '#333';
            context.fill();
          }
        }

        // Label
        context.font = `${weight} ${size}px ${font}`;
        context.fillStyle = '#eef0f6';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(label, x, y + 4);
      },

      // ------ Node reducer: hover + selection + blast radius + path highlighting ------
      nodeReducer: (node, data) => {
        const res = { ...data };
        if (data.hidden) {
          res.hidden = true;
          return res;
        }

        const hovered = hoveredNodeRef.current;
        const neighbors = hoveredNeighborsRef.current;
        const selected = optionsRef.current.selectedNodeId;
        const blastMode = optionsRef.current.blastRadiusMode;
        const blastDistances = optionsRef.current.blastDistances;
        const colorByFolder = optionsRef.current.colorByFolder;
        const clusterColorMap = optionsRef.current.clusterColorMap;
        const pathNodes = optionsRef.current.pathNodes;

        // Color by folder mode
        if (colorByFolder && clusterColorMap) {
          const attrs = graph.getNodeAttributes(node);
          const clusterColor = clusterColorMap.get(attrs.cluster);
          if (clusterColor) {
            res.color = clusterColor;
          }
        }

        // Path highlighting
        if (pathNodes && pathNodes.size > 0) {
          if (pathNodes.has(node)) {
            res.color = '#f97316';
            res.size = (data.size || 8) * 1.8;
            res.highlighted = true;
            res.zIndex = 3;
          } else {
            res.color = dimColor(data.color, 0.12);
            res.label = '';
            res.zIndex = -1;
          }
          return res;
        }

        // Blast radius mode
        if (blastMode && blastDistances && selected) {
          const distance = blastDistances.get(node);
          if (distance !== undefined) {
            res.color = getBlastColor(distance);
            const sizeMultiplier = distance === 0 ? 2.0 : distance === 1 ? 1.4 : distance === 2 ? 1.1 : 0.8;
            res.size = (data.size || 8) * sizeMultiplier;
            res.highlighted = distance <= 2;
            res.zIndex = Math.max(0, 3 - distance);
          } else {
            res.color = dimColor(data.color, 0.08);
            res.size = (data.size || 8) * 0.4;
            res.label = '';
            res.zIndex = -1;
          }
          return res;
        }

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
            res.color = colorByFolder && clusterColorMap
              ? (clusterColorMap.get(graph.getNodeAttributes(node).cluster) || data.color)
              : data.color;
            const pulseFactor = 1 + Math.sin(pulsePhaseRef.current) * 0.15;
            res.size = (data.size || 8) * 1.6 * pulseFactor;
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

      // ------ Edge reducer: hover + selection + edge labels + path highlighting ------
      edgeReducer: (edge, data) => {
        const res = { ...data };
        const hovered = hoveredNodeRef.current;
        const selected = optionsRef.current.selectedNodeId;
        const pathEdgeKeys = optionsRef.current.pathEdgeKeys;

        // Path highlighting for edges
        if (pathEdgeKeys && pathEdgeKeys.size > 0) {
          const src = graph.source(edge);
          const tgt = graph.target(edge);
          const key = `${src}->${tgt}`;
          const keyRev = `${tgt}->${src}`;
          if (pathEdgeKeys.has(key) || pathEdgeKeys.has(keyRev)) {
            res.color = '#f97316';
            res.size = 4;
            res.zIndex = 3;
            res.label = graph.getEdgeAttribute(edge, 'edgeType') || '';
            res.forceLabel = true;
          } else {
            res.color = dimColor(EDGE_DEFAULT_COLOR, 0.05);
            res.size = 0.1;
            res.zIndex = 0;
          }
          return res;
        }

        if (hovered) {
          const src = graph.source(edge);
          const tgt = graph.target(edge);
          if (src === hovered || tgt === hovered) {
            res.color = EDGE_HOVER_COLOR;
            res.size = Math.max(2, (data.size || 1) * 3);
            res.zIndex = 2;
            res.label = graph.getEdgeAttribute(edge, 'edgeType') || '';
            res.forceLabel = true;
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
            res.label = graph.getEdgeAttribute(edge, 'edgeType') || '';
            res.forceLabel = true;
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
      containerRef.current!.style.cursor = 'pointer';
      renderer.refresh();
    });

    renderer.on('leaveNode', () => {
      hoveredNodeRef.current = null;
      hoveredNeighborsRef.current = new Set();
      containerRef.current!.style.cursor = 'crosshair';
      renderer.refresh();
    });

    renderer.on('clickNode', ({ node }) => {
      const attrs = graph.getNodeAttributes(node) as SigmaNodeAttributes;
      optionsRef.current.onNodeClick?.(node, attrs);
    });

    renderer.on('clickStage', () => {
      optionsRef.current.onStageClick?.();
    });

    // Hull overlay rendering
    renderer.on('beforeRender', () => {
      if (!optionsRef.current.showHulls) return;

      const canvases = renderer.getCanvases();
      const canvas = canvases.edges;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Group visible nodes by cluster
      const clusterNodes = new Map<string, { x: number; y: number }[]>();
      const clusterArr: string[] = [];

      graph.forEachNode((nodeId, attrs) => {
        if (attrs.hidden || !attrs.cluster) return;
        const display = renderer.getNodeDisplayData(nodeId);
        if (!display) return;
        if (!clusterNodes.has(attrs.cluster)) {
          clusterNodes.set(attrs.cluster, []);
          clusterArr.push(attrs.cluster);
        }
        clusterNodes.get(attrs.cluster)!.push({ x: display.x, y: display.y });
      });

      clusterArr.sort();

      clusterArr.forEach((cluster, idx) => {
        const points = clusterNodes.get(cluster)!;
        if (points.length < 3) return;

        // Convex hull via Graham scan
        const hull = convexHull(points);
        if (hull.length < 3) return;

        // Inflate hull by padding
        const padding = 20;
        const inflated = inflatePolygon(hull, padding);

        const color = COMMUNITY_COLORS[idx % COMMUNITY_COLORS.length];
        const rgb = hexToRgbHull(color);

        ctx.fillStyle = `rgba(${rgb.r},${rgb.g},${rgb.b},0.06)`;
        ctx.beginPath();
        ctx.moveTo(inflated[0].x, inflated[0].y);
        for (let i = 1; i < inflated.length; i++) {
          ctx.lineTo(inflated[i].x, inflated[i].y);
        }
        ctx.closePath();
        ctx.fill();
      });
    });

    renderer.on('rightClickNode', ({ node, event }) => {
      event.original.preventDefault();
      const attrs = graph.getNodeAttributes(node) as SigmaNodeAttributes;
      const original = event.original;
      const clientX = 'clientX' in original ? original.clientX : (original as TouchEvent).touches?.[0]?.clientX ?? 0;
      const clientY = 'clientY' in original ? original.clientY : (original as TouchEvent).touches?.[0]?.clientY ?? 0;
      optionsRef.current.onRightClickNode?.(node, attrs, {
        x: clientX,
        y: clientY,
      });
    });

    return () => {
      if (animationFrameId !== null) cancelAnimationFrame(animationFrameId);
      renderer.kill();
      sigmaRef.current = null;
      hoveredNodeRef.current = null;
      hoveredNeighborsRef.current = new Set();
    };
  }, [containerRef, graph]);

  // -------------------------------------------------------------------
  // Refresh when visual state changes (no full rebuild needed)
  // -------------------------------------------------------------------
  useEffect(() => {
    sigmaRef.current?.refresh();
  }, [
    options.selectedNodeId,
    options.blastRadiusMode,
    options.blastDistances,
    options.colorByFolder,
    options.clusterColorMap,
    options.pathNodes,
    options.pathEdgeKeys,
    options.showHulls,
  ]);

  // -------------------------------------------------------------------
  // Pulse animation for selected node
  // -------------------------------------------------------------------
  useEffect(() => {
    const renderer = sigmaRef.current;
    if (!renderer) return;

    let pulseFrame: number | null = null;

    if (options.selectedNodeId) {
      const animate = () => {
        pulsePhaseRef.current = (pulsePhaseRef.current + 0.04) % (Math.PI * 2);
        renderer.refresh();
        pulseFrame = requestAnimationFrame(animate);
      };
      pulseFrame = requestAnimationFrame(animate);
    }

    return () => {
      if (pulseFrame !== null) cancelAnimationFrame(pulseFrame);
    };
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

  const exportPNG = useCallback(() => {
    const sigma = sigmaRef.current;
    if (!sigma) return;
    try {
      const canvas = sigma.getCanvases().edges;
      if (!canvas) return;
      // Create a combined canvas from all sigma layers
      const container = sigma.getContainer();
      const allCanvases = container.querySelectorAll('canvas');
      const w = allCanvases[0]?.width || 1920;
      const h = allCanvases[0]?.height || 1080;
      const exportCanvas = document.createElement('canvas');
      exportCanvas.width = w;
      exportCanvas.height = h;
      const ctx = exportCanvas.getContext('2d');
      if (!ctx) return;
      // Fill background
      ctx.fillStyle = '#0c0c1a';
      ctx.fillRect(0, 0, w, h);
      // Layer all sigma canvases
      allCanvases.forEach((c) => {
        ctx.drawImage(c, 0, 0);
      });
      const url = exportCanvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url;
      a.download = `sia-graph-${Date.now()}.png`;
      a.click();
    } catch (err) {
      console.error('Export failed:', err);
    }
  }, []);

  const getCameraState = useCallback(() => {
    const sigma = sigmaRef.current;
    if (!sigma) return null;
    const camera = sigma.getCamera();
    return { x: camera.x, y: camera.y, ratio: camera.ratio, angle: camera.angle };
  }, []);

  const setCameraState = useCallback((state: { x: number; y: number; ratio: number; angle: number }) => {
    const sigma = sigmaRef.current;
    if (!sigma) return;
    sigma.getCamera().animate(state, { duration: 300 });
  }, []);

  return {
    sigmaRef,
    zoomIn,
    zoomOut,
    resetZoom,
    focusNode,
    exportPNG,
    getCameraState,
    setCameraState,
  };
}
