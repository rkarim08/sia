export interface GraphNode {
	id: string;
	label: string;
	parentId: string;
	nodeType:
		| "file"
		| "function"
		| "class"
		| "interface"
		| "decision"
		| "bug"
		| "convention"
		| "solution";
	filePath?: string;
	importance: number;
	trustTier: number;
	color: string;
	entityId: string;
}

export interface GraphEdge {
	id: string;
	source: string;
	target: string;
	edgeType: "imports" | "calls" | "relates_to";
	weight: number;
	label?: string;
}

export interface GraphCombo {
	id: string;
	label: string;
	parentId?: string;
	childCount: number;
	folderPath: string;
	color: string;
}

export interface GraphResponse {
	nodes: GraphNode[];
	edges: GraphEdge[];
	combos: GraphCombo[];
}

export interface FileResponse {
	content: string;
	language: string;
	lineCount: number;
}

export interface EntitiesResponse {
	nodes: GraphNode[];
	edges: GraphEdge[];
}

export interface SearchResult {
	id: string;
	name: string;
	type: string;
	path: string;
	comboAncestry: string[];
}

export async function fetchGraph(scope?: string): Promise<GraphResponse> {
	const url = scope ? `/api/graph?scope=${encodeURIComponent(scope)}` : "/api/graph";
	const res = await fetch(url);
	if (!res.ok) throw new Error(`Failed to fetch graph: ${res.status}`);
	return res.json();
}

export async function fetchFile(path: string): Promise<FileResponse> {
	const res = await fetch(`/api/file?path=${encodeURIComponent(path)}`);
	if (!res.ok) throw new Error(`Failed to fetch file: ${res.status}`);
	return res.json();
}

export async function fetchEntities(fileNodeId: string): Promise<EntitiesResponse> {
	const res = await fetch(`/api/entities/${encodeURIComponent(fileNodeId)}`);
	if (!res.ok) throw new Error(`Failed to fetch entities: ${res.status}`);
	return res.json();
}

export async function searchNodes(query: string, limit = 20): Promise<SearchResult[]> {
	const res = await fetch(`/api/search?q=${encodeURIComponent(query)}&limit=${limit}`);
	if (!res.ok) throw new Error(`Failed to search: ${res.status}`);
	const data = await res.json();
	return data.results;
}

export async function expandCombo(comboId: string): Promise<GraphResponse> {
	const res = await fetch(`/api/expand/${encodeURIComponent(comboId)}`);
	if (!res.ok) throw new Error(`Failed to expand: ${res.status}`);
	return res.json();
}
