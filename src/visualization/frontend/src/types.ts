export interface SigmaNodeAttributes {
  x: number;
  y: number;
  size: number;
  color: string;
  label: string;
  nodeType: string;
  filePath: string;
  entityId: string;
  importance: number;
  trustTier: number;
  parentId: string;
  cluster: string; // top-level folder for grouping
  mass: number;    // ForceAtlas2 mass
  hidden?: boolean;
  // Sigma display properties (set by reducers, not stored in graph)
  highlighted?: boolean;
  zIndex?: number;
}

export interface SigmaEdgeAttributes {
  size: number;
  color: string;
  edgeType: string;
  hidden?: boolean;
  // Sigma display properties (set by reducers, not stored in graph)
  zIndex?: number;
}
