import Graph from 'graphology';
import type { GraphResponse, GraphCombo, GraphNode } from './api';
import { NODE_COLORS, NODE_SIZES, EDGE_INFO, SiaNodeType } from './constants';
import { SigmaNodeAttributes, SigmaEdgeAttributes } from '../types';

/**
 * Get node size scaled for graph density.
 * Preserves relative hierarchy even in large graphs.
 * Scales node size based on graph density.
 */
const getScaledNodeSize = (baseSize: number, nodeCount: number): number => {
  if (nodeCount > 50000) return Math.max(1, baseSize * 0.4);
  if (nodeCount > 20000) return Math.max(1.5, baseSize * 0.5);
  if (nodeCount > 5000) return Math.max(2, baseSize * 0.65);
  if (nodeCount > 1000) return Math.max(2.5, baseSize * 0.8);
  return baseSize;
};

/**
 * Get ForceAtlas2 mass for a node.
 * Folders get highest mass so they spread out and anchor their children.
 * Files get medium mass; knowledge nodes (decision, bug, etc.) get low mass.
 * Assigns ForceAtlas2 mass by node type.
 */
const getNodeMass = (
  nodeType: SiaNodeType,
  isFolder: boolean,
  nodeCount: number,
): number => {
  const baseMassMultiplier = nodeCount > 5000 ? 2 : nodeCount > 1000 ? 1.5 : 1;

  if (isFolder) return 15 * baseMassMultiplier;

  switch (nodeType) {
    case 'file':
      return 6 * baseMassMultiplier;
    case 'class':
    case 'interface':
      return 5 * baseMassMultiplier;
    case 'function':
      return 3 * baseMassMultiplier;
    // Knowledge nodes — lightweight, orbit around structural nodes
    case 'decision':
    case 'bug':
    case 'convention':
    case 'solution':
      return 3 * baseMassMultiplier;
    default:
      return 1;
  }
};

/**
 * Derive a cluster label from a combo's folder path.
 * Uses the top-level folder so nodes can be grouped visually.
 */
const getCluster = (comboId: string, comboMap: Map<string, GraphCombo>): string => {
  let current = comboMap.get(comboId);
  if (!current) return '';
  // Walk up to the top-level combo (no parentId)
  while (current.parentId) {
    const parent = comboMap.get(current.parentId);
    if (!parent) break;
    current = parent;
  }
  return current.label;
};

/**
 * Converts a SIA GraphResponse into a Graphology graph for Sigma.js rendering.
 *
 * Converts a SIA GraphResponse into a Graphology graph:
 * - Combos (folders) are added as structural nodes on a golden-angle spiral
 * - File nodes are positioned near their parent combo
 * - Knowledge nodes (decision, bug, etc.) are positioned near their linked files
 * - Edge colors come from EDGE_INFO constants
 */
export const graphResponseToGraphology = (
  response: GraphResponse,
): Graph<SigmaNodeAttributes, SigmaEdgeAttributes> => {
  const graph = new Graph<SigmaNodeAttributes, SigmaEdgeAttributes>();

  const { nodes, edges, combos } = response;
  const totalElements = nodes.length + combos.length;

  // Build lookup maps
  const comboMap = new Map<string, GraphCombo>(combos.map((c) => [c.id, c]));

  // --- Positioning constants ---
  const structuralSpread = Math.sqrt(totalElements) * 40;
  const childJitter = Math.sqrt(totalElements) * 3;
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));

  // Store positions for parent lookup
  const positions = new Map<string, { x: number; y: number }>();

  // === Phase 1: Position combo (folder) nodes on outer golden-angle spiral ===
  combos.forEach((combo, index) => {
    const angle = index * goldenAngle;
    const radius =
      structuralSpread * Math.sqrt((index + 1) / Math.max(combos.length, 1));
    const jitter = structuralSpread * 0.15;

    const x = radius * Math.cos(angle) + (Math.random() - 0.5) * jitter;
    const y = radius * Math.sin(angle) + (Math.random() - 0.5) * jitter;
    positions.set(combo.id, { x, y });

    const cluster = getCluster(combo.id, comboMap);

    graph.addNode(combo.id, {
      x,
      y,
      size: getScaledNodeSize(12, totalElements), // Folders are largest
      color: combo.color || '#6b7280',
      label: combo.label,
      nodeType: 'folder',
      filePath: combo.folderPath,
      entityId: combo.id,
      importance: combo.childCount,
      trustTier: 0,
      parentId: combo.parentId || '',
      cluster,
      mass: getNodeMass('file', true, totalElements),
      hidden: false,
    });
  });

  // === Phase 2: Position content nodes near their parent combo ===
  // Process nodes in hierarchy order: files first (they have parentId pointing to combos),
  // then knowledge nodes (they have parentId pointing to files or combos).
  const fileNodes = nodes.filter((n) => n.nodeType === 'file');
  const nonFileNodes = nodes.filter((n) => n.nodeType !== 'file');

  const addNode = (node: GraphNode) => {
    if (graph.hasNode(node.id)) return;

    let x: number;
    let y: number;

    const parentPos = node.parentId ? positions.get(node.parentId) : null;
    if (parentPos) {
      // Position near parent with jitter
      x = parentPos.x + (Math.random() - 0.5) * childJitter;
      y = parentPos.y + (Math.random() - 0.5) * childJitter;
    } else {
      // Orphan — random position in reduced space
      x = (Math.random() - 0.5) * structuralSpread * 0.5;
      y = (Math.random() - 0.5) * structuralSpread * 0.5;
    }

    positions.set(node.id, { x, y });

    const nodeType = node.nodeType as SiaNodeType;
    const baseSize = NODE_SIZES[nodeType] ?? 5;
    const cluster = node.parentId
      ? getCluster(node.parentId, comboMap)
      : '';

    graph.addNode(node.id, {
      x,
      y,
      size: getScaledNodeSize(baseSize, totalElements),
      color: node.color || NODE_COLORS[nodeType] || '#9ca3af',
      label: node.label,
      nodeType: node.nodeType,
      filePath: node.filePath || '',
      entityId: node.entityId,
      importance: node.importance,
      trustTier: node.trustTier,
      parentId: node.parentId,
      cluster,
      mass: getNodeMass(nodeType, false, totalElements),
      hidden: false,
    });
  };

  // Files first so their positions are available for knowledge nodes
  fileNodes.forEach(addNode);
  nonFileNodes.forEach(addNode);

  // === Phase 3: Add edges with per-type styling (from EDGE_INFO) ===
  const edgeBaseSize =
    totalElements > 20000 ? 0.4 : totalElements > 5000 ? 0.6 : 1.0;

  edges.forEach((edge) => {
    if (!graph.hasNode(edge.source) || !graph.hasNode(edge.target)) return;
    if (graph.hasEdge(edge.source, edge.target)) return;

    const info = EDGE_INFO[edge.edgeType] || { color: '#4a4a5a' };

    graph.addEdge(edge.source, edge.target, {
      size: edgeBaseSize * (edge.weight || 1),
      color: info.color,
      edgeType: edge.edgeType,
      hidden: false,
    });
  });

  return graph;
};

/**
 * Filter graph nodes by visible node types.
 * Hides nodes whose nodeType is not in the provided list.
 * Also hides edges connected to hidden nodes.
 */
export const filterGraphByTypes = (
  graph: Graph<SigmaNodeAttributes, SigmaEdgeAttributes>,
  visibleTypes: string[],
): void => {
  const typeSet = new Set(visibleTypes);
  graph.forEachNode((nodeId, attrs) => {
    graph.setNodeAttribute(nodeId, 'hidden', !typeSet.has(attrs.nodeType));
  });
};

/**
 * Get all nodes within N hops of a starting node via BFS.
 * BFS traversal to find all nodes within N hops.
 */
export const getNodesWithinHops = (
  graph: Graph<SigmaNodeAttributes, SigmaEdgeAttributes>,
  startNodeId: string,
  maxHops: number,
): Set<string> => {
  const visited = new Set<string>();
  const queue: { nodeId: string; depth: number }[] = [
    { nodeId: startNodeId, depth: 0 },
  ];

  while (queue.length > 0) {
    const { nodeId, depth } = queue.shift()!;
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);

    if (depth < maxHops) {
      graph.forEachNeighbor(nodeId, (neighborId) => {
        if (!visited.has(neighborId)) {
          queue.push({ nodeId: neighborId, depth: depth + 1 });
        }
      });
    }
  }

  return visited;
};

/**
 * Filter graph by depth from a selected node, intersected with visible types.
 * Filter graph by depth from a selected node, intersected with visible types.
 */
export const filterGraphByDepth = (
  graph: Graph<SigmaNodeAttributes, SigmaEdgeAttributes>,
  selectedNodeId: string | null,
  maxHops: number | null,
  visibleTypes: string[],
): void => {
  if (maxHops === null || selectedNodeId === null || !graph.hasNode(selectedNodeId)) {
    filterGraphByTypes(graph, visibleTypes);
    return;
  }

  const nodesInRange = getNodesWithinHops(graph, selectedNodeId, maxHops);
  const typeSet = new Set(visibleTypes);

  graph.forEachNode((nodeId, attrs) => {
    const isVisible = typeSet.has(attrs.nodeType) && nodesInRange.has(nodeId);
    graph.setNodeAttribute(nodeId, 'hidden', !isVisible);
  });
};
