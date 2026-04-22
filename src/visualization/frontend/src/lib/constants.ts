// SIA node type union — matches GraphNode['nodeType'] from api.ts
export type SiaNodeType =
	| "file"
	| "function"
	| "class"
	| "interface"
	| "decision"
	| "bug"
	| "convention"
	| "solution";

// Node colors by type — slightly muted for less visual noise
// Slightly muted for less visual noise
export const DEFAULT_NODE_COLORS: Record<SiaNodeType, string> = {
	file: "#60a5fa", // Sky blue — structural, prominent
	function: "#34d399", // Mint — common code element
	class: "#fbbf24", // Gold — stands out
	interface: "#f472b6", // Rose pink — type definition
	decision: "#a78bfa", // Lavender — architectural weight
	bug: "#f87171", // Coral red — distinct from file blue
	convention: "#2dd4bf", // Cyan-teal — established pattern
	solution: "#facc15", // Yellow — clearly distinct from convention
};

const NODE_COLORS_KEY = "sia.nodeColors";

export function loadNodeColors(): Record<SiaNodeType, string> {
	try {
		const saved = localStorage.getItem(NODE_COLORS_KEY);
		if (saved) {
			const parsed = JSON.parse(saved);
			return { ...DEFAULT_NODE_COLORS, ...parsed };
		}
	} catch {}
	return { ...DEFAULT_NODE_COLORS };
}

export function saveNodeColors(colors: Record<SiaNodeType, string>): void {
	try {
		localStorage.setItem(NODE_COLORS_KEY, JSON.stringify(colors));
	} catch {}
}

// Mutable reference used by graph-adapter and useSigma — updated from App state
export let NODE_COLORS: Record<SiaNodeType, string> = loadNodeColors();

export function setNodeColors(colors: Record<SiaNodeType, string>): void {
	NODE_COLORS = colors;
}

// Node sizes by type — clear visual hierarchy with dramatic size differences
// Structural nodes are larger to make hierarchy obvious
// Dramatic size hierarchy — structural nodes are larger
export const NODE_SIZES: Record<SiaNodeType, number> = {
	file: 6, // Common structural element
	function: 4, // Common code element — small
	class: 8, // Important code structure
	interface: 7, // Important type definition
	decision: 10, // Architectural decisions — largest, most important
	bug: 8, // Prominent — needs attention
	convention: 6, // Team patterns — mid-level
	solution: 5, // Resolutions — moderate
};

// Community color palette for cluster-based coloring
// 12-color palette for cluster-based coloring
export const COMMUNITY_COLORS = [
	"#ef4444", // red
	"#f97316", // orange
	"#eab308", // yellow
	"#22c55e", // green
	"#06b6d4", // cyan
	"#3b82f6", // blue
	"#8b5cf6", // violet
	"#d946ef", // fuchsia
	"#ec4899", // pink
	"#f43f5e", // rose
	"#14b8a6", // teal
	"#84cc16", // lime
];

export const getCommunityColor = (communityIndex: number): string => {
	return COMMUNITY_COLORS[communityIndex % COMMUNITY_COLORS.length];
};

// SIA edge types — matches GraphEdge['edgeType'] from api.ts
export type SiaEdgeType = "imports" | "calls" | "relates_to";

export const ALL_EDGE_TYPES: SiaEdgeType[] = ["imports", "calls", "relates_to"];

// Default visible edges
export const DEFAULT_VISIBLE_EDGES: SiaEdgeType[] = ["imports", "calls", "relates_to"];

// Edge display info for UI
// Per-type edge styling for UI
export const EDGE_INFO: Record<SiaEdgeType, { color: string; label: string }> = {
	imports: { color: "rgba(59,130,246,0.12)", label: "Imports" },
	calls: { color: "rgba(139,92,246,0.12)", label: "Calls" },
	relates_to: { color: "rgba(99,102,241,0.08)", label: "Relates To" },
};

// Default visible node types
export const DEFAULT_VISIBLE_TYPES: SiaNodeType[] = [
	"file",
	"function",
	"class",
	"interface",
	"decision",
	"bug",
	"convention",
	"solution",
];

// All filterable node types
export const FILTERABLE_TYPES: SiaNodeType[] = [
	"file",
	"function",
	"class",
	"interface",
	"decision",
	"bug",
	"convention",
	"solution",
];

// Edge styling defaults — very low opacity so the graph isn't a hairball
export const EDGE_DEFAULT_COLOR = "rgba(255,255,255,0.018)";
export const EDGE_HOVER_COLOR = "rgba(255,255,255,0.55)";

// Background colors
export const BG_PRIMARY = "#0c0c1a";
export const BG_SIDEBAR = "rgba(14,17,32,0.72)";
export const BG_PANEL = "rgba(14,17,32,0.85)";

// Font tokens
export const FONT_UI = "'Outfit', -apple-system, sans-serif";
export const FONT_MONO = "'GeistMono', 'Geist Mono', 'JetBrains Mono', monospace";
