// SIA node type union — matches GraphNode['nodeType'] from api.ts
export type SiaNodeType =
  | 'file'
  | 'function'
  | 'class'
  | 'interface'
  | 'decision'
  | 'bug'
  | 'convention'
  | 'solution';

// Node colors by type — slightly muted for less visual noise
// Ported from GitNexus, adapted for SIA entity types
export const NODE_COLORS: Record<SiaNodeType, string> = {
  file: '#3b82f6',       // Blue — structural, prominent
  function: '#10b981',   // Emerald — common code element
  class: '#f59e0b',      // Amber — stands out
  interface: '#ec4899',  // Pink — type definition
  decision: '#8b5cf6',   // Violet — architectural weight
  bug: '#ef4444',        // Red — danger, attention
  convention: '#14b8a6', // Teal — established pattern
  solution: '#22c55e',   // Green — resolution
};

// Node sizes by type — clear visual hierarchy with dramatic size differences
// Structural nodes are larger to make hierarchy obvious
// Ported from GitNexus's dramatic size hierarchy
export const NODE_SIZES: Record<SiaNodeType, number> = {
  file: 6,         // Common structural element
  function: 4,     // Common code element — small
  class: 8,        // Important code structure
  interface: 7,    // Important type definition
  decision: 10,    // Architectural decisions — largest, most important
  bug: 8,          // Prominent — needs attention
  convention: 6,   // Team patterns — mid-level
  solution: 5,     // Resolutions — moderate
};

// Community color palette for cluster-based coloring
// Copied directly from GitNexus
export const COMMUNITY_COLORS = [
  '#ef4444', // red
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#06b6d4', // cyan
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#d946ef', // fuchsia
  '#ec4899', // pink
  '#f43f5e', // rose
  '#14b8a6', // teal
  '#84cc16', // lime
];

export const getCommunityColor = (communityIndex: number): string => {
  return COMMUNITY_COLORS[communityIndex % COMMUNITY_COLORS.length];
};

// SIA edge types — matches GraphEdge['edgeType'] from api.ts
export type SiaEdgeType = 'imports' | 'calls' | 'relates_to';

export const ALL_EDGE_TYPES: SiaEdgeType[] = [
  'imports',
  'calls',
  'relates_to',
];

// Default visible edges
export const DEFAULT_VISIBLE_EDGES: SiaEdgeType[] = [
  'imports',
  'calls',
  'relates_to',
];

// Edge display info for UI
// Ported from GitNexus's EDGE_INFO pattern
export const EDGE_INFO: Record<SiaEdgeType, { color: string; label: string }> = {
  imports: { color: '#1d4ed8', label: 'Imports' },
  calls: { color: '#7c3aed', label: 'Calls' },
  relates_to: { color: '#0e7490', label: 'Relates To' },
};

// Default visible node types
export const DEFAULT_VISIBLE_TYPES: SiaNodeType[] = [
  'file',
  'function',
  'class',
  'interface',
  'decision',
  'bug',
  'convention',
  'solution',
];

// All filterable node types
export const FILTERABLE_TYPES: SiaNodeType[] = [
  'file',
  'function',
  'class',
  'interface',
  'decision',
  'bug',
  'convention',
  'solution',
];

// Edge styling defaults
export const EDGE_DEFAULT_COLOR = 'rgba(255,255,255,0.15)';
export const EDGE_HOVER_COLOR = 'rgba(255,255,255,0.6)';

// Background colors
export const BG_PRIMARY = '#1a1a2e';
export const BG_SIDEBAR = '#16213e';
