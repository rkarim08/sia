// src/visualization/types.ts
// Shared types for the G6 v5 visualizer

/** A folder combo in G6 format. */
export interface G6Combo {
	id: string;
	label: string;
	parentId?: string;
	childCount: number;
	folderPath: string;
	color: string;
}

/** A node in G6 format. */
export interface G6Node {
	id: string;
	label: string;
	parentId: string;
	nodeType: 'file' | 'function' | 'class' | 'interface' | 'decision' | 'bug' | 'convention' | 'solution';
	filePath?: string;
	importance: number;
	trustTier: number;
	color: string;
	entityId: string;
}

/** An edge in G6 format. */
export interface G6Edge {
	id: string;
	source: string;
	target: string;
	edgeType: 'imports' | 'calls' | 'relates_to';
	weight: number;
	label?: string;
}

/** Response from GET /api/graph */
export interface GraphResponse {
	nodes: G6Node[];
	edges: G6Edge[];
	combos: G6Combo[];
}

/** Response from GET /api/expand/:comboId */
export interface ExpandResponse {
	nodes: G6Node[];
	edges: G6Edge[];
	combos: G6Combo[];
}

/** Response from GET /api/entities/:fileNodeId */
export interface EntitiesResponse {
	nodes: G6Node[];
	edges: G6Edge[];
}

/** Response from GET /api/file */
export interface FileResponse {
	content: string;
	language: string;
	lineCount: number;
}

/** A single search result. */
export interface SearchResult {
	id: string;
	name: string;
	type: string;
	path: string;
	comboAncestry: string[];
}

/** Response from GET /api/search */
export interface SearchResponse {
	results: SearchResult[];
}

/** 12-color palette for folder coloring on dark background. */
export const FOLDER_PALETTE = [
	'#4fc3f7',
	'#81c784',
	'#ba68c8',
	'#ef5350',
	'#ff8a65',
	'#7e57c2',
	'#26a69a',
	'#ffd54f',
	'#ec407a',
	'#42a5f5',
	'#66bb6a',
	'#ab47bc',
];

/** Fixed colors for non-code entity types. */
export const KNOWLEDGE_COLORS: Record<string, string> = {
	Decision: '#ef5350',
	Bug: '#f44336',
	Convention: '#26a69a',
	Solution: '#66bb6a',
};

/**
 * Deterministic folder color from path.
 * Hashes the top-level folder name to index into FOLDER_PALETTE.
 */
export function folderColor(folderPath: string): string {
	const topLevel = folderPath.split('/')[0] ?? folderPath;
	let hash = 0;
	for (let i = 0; i < topLevel.length; i++) {
		hash = ((hash << 5) - hash + topLevel.charCodeAt(i)) | 0;
	}
	return FOLDER_PALETTE[Math.abs(hash) % FOLDER_PALETTE.length];
}

/**
 * Lighten a hex color by a percentage (0-1) for child entities.
 */
export function lightenColor(hex: string, amount: number): string {
	const r = parseInt(hex.slice(1, 3), 16);
	const g = parseInt(hex.slice(3, 5), 16);
	const b = parseInt(hex.slice(5, 7), 16);
	const lr = Math.min(255, Math.round(r + (255 - r) * amount));
	const lg = Math.min(255, Math.round(g + (255 - g) * amount));
	const lb = Math.min(255, Math.round(b + (255 - b) * amount));
	return `#${lr.toString(16).padStart(2, '0')}${lg.toString(16).padStart(2, '0')}${lb.toString(16).padStart(2, '0')}`;
}

/** Map a file extension to a Shiki language identifier. */
export function extToLanguage(ext: string): string {
	const map: Record<string, string> = {
		'.ts': 'typescript', '.tsx': 'tsx', '.js': 'javascript', '.jsx': 'jsx',
		'.py': 'python', '.rs': 'rust', '.go': 'go', '.java': 'java',
		'.c': 'c', '.cpp': 'cpp', '.h': 'c', '.hpp': 'cpp',
		'.rb': 'ruby', '.php': 'php', '.swift': 'swift', '.kt': 'kotlin',
		'.cs': 'csharp', '.css': 'css', '.html': 'html', '.json': 'json',
		'.yaml': 'yaml', '.yml': 'yaml', '.md': 'markdown', '.sql': 'sql',
		'.sh': 'bash', '.bash': 'bash', '.zsh': 'bash',
	};
	return map[ext.toLowerCase()] ?? 'text';
}
