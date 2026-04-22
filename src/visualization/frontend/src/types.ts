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
	mass: number; // ForceAtlas2 mass
	hidden?: boolean;
	// Sigma display properties (set by reducers, not stored in graph)
	highlighted?: boolean;
	zIndex?: number;
	// Original color preserved for color-mode switching
	originalColor?: string;
	// Folder path chain for folder filtering
	folderPath?: string;
}

export interface SigmaEdgeAttributes {
	size: number;
	color: string;
	edgeType: string;
	label?: string;
	hidden?: boolean;
	// Sigma display properties (set by reducers, not stored in graph)
	forceLabel?: boolean;
	zIndex?: number;
}

/** Bookmark: saved view state */
export interface ViewBookmark {
	id: string;
	name: string;
	cameraState: { x: number; y: number; ratio: number; angle: number };
	hiddenTypes: string[];
	activeFolder: string | null;
	timestamp: number;
}

/** Layout modes for the graph */
export type LayoutMode = "force" | "tree" | "radial";
