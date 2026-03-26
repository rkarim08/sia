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
}

export interface SigmaEdgeAttributes {
  size: number;
  color: string;
  edgeType: string;
  hidden?: boolean;
}
