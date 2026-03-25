// Module: file-graph-extract — File-centric hierarchical graph extraction for the G6 visualizer

import type { SiaDb } from "@/graph/db-interface";
import {
	KNOWLEDGE_COLORS,
	type EntitiesResponse,
	type ExpandResponse,
	type G6Combo,
	type G6Edge,
	type G6Node,
	type GraphResponse,
	type SearchResult,
	folderColor,
} from "@/visualization/types";

/** Options for extractInitialGraph. */
export interface ExtractInitialGraphOpts {
	/** Only include entities whose file_paths start with this prefix. */
	scope?: string;
}

/** Knowledge entity types that are shown as standalone nodes. */
const KNOWLEDGE_TYPES = new Set(["Decision", "Bug", "Convention", "Solution"]);

/**
 * Build a safe SQL IN clause from an array of hex-UUID strings.
 * UUIDs contain only [0-9a-f-] so they are safe to inline without parameterisation,
 * which avoids SQLite's host-parameter limit (SQLITE_MAX_VARIABLE_NUMBER = 999).
 */
function inClause(ids: string[]): string {
	return ids.map((id) => `'${id}'`).join(",");
}

/**
 * Parse file_paths JSON string to an array of strings.
 * Returns [] on parse failure.
 */
function parseFilePaths(raw: unknown): string[] {
	if (typeof raw !== "string") return [];
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === "string") : [];
	} catch {
		return [];
	}
}

/**
 * Derive the direct parent folder path from a file path.
 * E.g. "src/ast/indexer.ts" -> "src/ast"
 * Returns "" if the file is at the root.
 */
function parentFolder(filePath: string): string {
	const parts = filePath.split("/");
	parts.pop(); // remove filename
	return parts.join("/");
}

/**
 * Derive the nodeType for a G6Node from a DB entity's type and summary.
 */
function deriveNodeType(type: string, summary: string): G6Node["nodeType"] {
	const t = type.toLowerCase();
	if (t === "decision") return "decision";
	if (t === "bug") return "bug";
	if (t === "convention") return "convention";
	if (t === "solution") return "solution";
	// CodeEntity: derive from summary prefix
	const s = (summary ?? "").toLowerCase();
	if (s.startsWith("class ")) return "class";
	if (s.startsWith("interface ")) return "interface";
	// default to function for CodeEntity and others
	return "function";
}

/**
 * Build all folder combos needed to contain the given set of file paths.
 * Each unique parent directory becomes a combo with id "combo:<path>".
 * Nested combos chain parentId references.
 */
function buildCombos(filePaths: string[]): G6Combo[] {
	// Collect all folder paths (including ancestors)
	const folderSet = new Set<string>();
	for (const fp of filePaths) {
		const parts = fp.split("/");
		// build paths for each ancestor directory
		for (let i = 1; i < parts.length; i++) {
			folderSet.add(parts.slice(0, i).join("/"));
		}
	}

	// Count direct children (files or sub-combos) per folder for childCount
	// We'll set a placeholder — actual counts depend on what's rendered
	const folders = Array.from(folderSet).sort();

	return folders.map((folder) => {
		// Find the direct parent folder
		const parentParts = folder.split("/");
		parentParts.pop();
		const parentPath = parentParts.join("/");

		const combo: G6Combo = {
			id: `combo:${folder}`,
			label: folder.split("/").pop() ?? folder,
			parentId: parentPath ? `combo:${parentPath}` : undefined,
			childCount: 0, // filled later if needed
			folderPath: folder,
			color: folderColor(folder),
		};
		return combo;
	});
}

/**
 * Extract the initial file-centric graph from the database.
 *
 * - CodeEntity rows become file nodes (one per unique file path).
 * - Knowledge entity types (Decision, Bug, Convention, Solution) become standalone nodes.
 * - Folder combos are derived from file paths.
 * - File-to-file edges are aggregated from entity-level import/call edges.
 * - Knowledge-to-file edges pass through as-is.
 */
export async function extractInitialGraph(
	db: SiaDb,
	opts?: ExtractInitialGraphOpts,
): Promise<GraphResponse> {
	// Query all active entities — scope filtering is applied in code below
	// (file_paths is a JSON array string, so SQL LIKE would be imprecise)
	const { rows } = await db.execute(
		`SELECT id, type, name, summary, importance, trust_tier, file_paths
		 FROM graph_nodes
		 WHERE t_valid_until IS NULL AND archived_at IS NULL`,
	);

	// Separate code entities from knowledge entities
	type EntityRow = {
		id: string;
		type: string;
		name: string;
		summary: string;
		importance: number;
		trust_tier: number;
		file_paths: string;
	};

	const entityRows = rows as unknown as EntityRow[];

	// Map: filePath -> representative entity (for file nodes)
	const fileMap = new Map<string, EntityRow>();
	// Map: entityId -> filePath[] (for edge aggregation)
	const entityToFiles = new Map<string, string[]>();
	// Knowledge nodes
	const knowledgeRows: EntityRow[] = [];

	for (const row of entityRows) {
		if (KNOWLEDGE_TYPES.has(row.type)) {
			knowledgeRows.push(row);
			continue;
		}

		const paths = parseFilePaths(row.file_paths);
		entityToFiles.set(row.id, paths);

		for (const fp of paths) {
			// Apply scope filter at file level
			if (opts?.scope && !fp.startsWith(opts.scope)) continue;
			if (!fileMap.has(fp)) {
				fileMap.set(fp, row);
			}
		}
	}

	// Build file nodes
	const fileNodes: G6Node[] = [];
	for (const [filePath, row] of fileMap) {
		const folder = parentFolder(filePath);
		fileNodes.push({
			id: `file:${filePath}`,
			label: filePath.split("/").pop() ?? filePath,
			parentId: folder ? `combo:${folder}` : "",
			nodeType: "file",
			filePath,
			importance: row.importance ?? 0.5,
			trustTier: row.trust_tier ?? 3,
			color: folderColor(folder || filePath),
			entityId: row.id,
		});
	}

	// Build knowledge nodes
	const knowledgeNodes: G6Node[] = knowledgeRows.map((row) => ({
		id: `knowledge:${row.id}`,
		label: row.name,
		parentId: "",
		nodeType: deriveNodeType(row.type, row.summary),
		importance: row.importance ?? 0.5,
		trustTier: row.trust_tier ?? 3,
		color: KNOWLEDGE_COLORS[row.type] ?? "#9e9e9e",
		entityId: row.id,
	}));

	// Build combos from all file paths (before scope filtering for combo hierarchy correctness,
	// but only include combos that have actual file nodes under them)
	const activeFolders = new Set<string>();
	for (const filePath of fileMap.keys()) {
		const parts = filePath.split("/");
		for (let i = 1; i < parts.length; i++) {
			activeFolders.add(parts.slice(0, i).join("/"));
		}
	}
	const allCombos = buildCombos(Array.from(fileMap.keys()));
	// Only include combos whose folder is reachable from active files
	const combos = allCombos.filter((c) => activeFolders.has(c.folderPath));

	// Build file-to-file edges by aggregating entity-level edges
	const entityIds = Array.from(entityToFiles.keys());
	const fileEdges: G6Edge[] = [];
	const seenFileEdges = new Set<string>();

	if (entityIds.length > 0) {
		const list = inClause(entityIds);
		const { rows: edgeRows } = await db.execute(
			`SELECT id, from_id, to_id, type, weight
			 FROM graph_edges
			 WHERE from_id IN (${list}) AND to_id IN (${list})
			   AND t_valid_until IS NULL
			   AND type IN ('imports', 'calls', 'relates_to')`,
		);

		for (const edge of edgeRows as unknown as {
			id: string;
			from_id: string;
			to_id: string;
			type: string;
			weight: number;
		}[]) {
			const fromFiles = entityToFiles.get(edge.from_id) ?? [];
			const toFiles = entityToFiles.get(edge.to_id) ?? [];

			for (const fromFile of fromFiles) {
				if (opts?.scope && !fromFile.startsWith(opts.scope)) continue;
				if (!fileMap.has(fromFile)) continue;
				for (const toFile of toFiles) {
					if (!fileMap.has(toFile)) continue;
					if (fromFile === toFile) continue;
					const edgeKey = `${fromFile}->${toFile}`;
					if (seenFileEdges.has(edgeKey)) continue;
					seenFileEdges.add(edgeKey);
					fileEdges.push({
						id: `edge:${edgeKey}`,
						source: `file:${fromFile}`,
						target: `file:${toFile}`,
						edgeType: edge.type as G6Edge["edgeType"],
						weight: edge.weight ?? 1.0,
					});
				}
			}
		}
	}

	// Knowledge-to-file edges: find edges from knowledge entities to code entities
	const knowledgeIds = knowledgeRows.map((r) => r.id);
	const knowledgeEdges: G6Edge[] = [];

	if (knowledgeIds.length > 0 && entityIds.length > 0) {
		const kList = inClause(knowledgeIds);
		const eList = inClause(entityIds);
		const { rows: kedgeRows } = await db.execute(
			`SELECT id, from_id, to_id, type, weight
			 FROM graph_edges
			 WHERE (from_id IN (${kList}) AND to_id IN (${eList}))
			    OR (from_id IN (${eList}) AND to_id IN (${kList}))
			   AND t_valid_until IS NULL`,
		);

		for (const ke of kedgeRows as unknown as {
			id: string;
			from_id: string;
			to_id: string;
			type: string;
			weight: number;
		}[]) {
			// Determine which is knowledge and which is code
			const isFromKnowledge = knowledgeIds.includes(ke.from_id);
			const sourceId = isFromKnowledge ? `knowledge:${ke.from_id}` : `knowledge:${ke.to_id}`;
			const targetEntity = isFromKnowledge ? ke.to_id : ke.from_id;
			const targetFiles = entityToFiles.get(targetEntity) ?? [];
			for (const tf of targetFiles) {
				if (!fileMap.has(tf)) continue;
				knowledgeEdges.push({
					id: `kedge:${ke.id}`,
					source: sourceId,
					target: `file:${tf}`,
					edgeType: "relates_to",
					weight: ke.weight ?? 1.0,
				});
			}
		}
	}

	return {
		nodes: [...fileNodes, ...knowledgeNodes],
		edges: [...fileEdges, ...knowledgeEdges],
		combos,
	};
}

/**
 * Expand a folder combo: return its direct children (file nodes + sub-folder combos).
 * comboId format: "combo:<path>"
 */
export async function expandFolder(db: SiaDb, comboId: string): Promise<ExpandResponse> {
	if (!comboId.startsWith("combo:")) {
		return { nodes: [], edges: [], combos: [] };
	}
	const folderPath = comboId.slice("combo:".length);

	// Find all active CodeEntities whose file paths are direct children of this folder
	const { rows } = await db.execute(
		`SELECT id, type, name, summary, importance, trust_tier, file_paths
		 FROM graph_nodes
		 WHERE t_valid_until IS NULL AND archived_at IS NULL
		   AND type = 'CodeEntity'
		   AND file_paths LIKE ?`,
		[`%${folderPath}/%`],
	);

	type EntityRow = {
		id: string;
		type: string;
		name: string;
		summary: string;
		importance: number;
		trust_tier: number;
		file_paths: string;
	};

	// Collect unique file paths that are direct children of this folder
	const directFiles = new Map<string, EntityRow>();
	const subFolders = new Set<string>();

	for (const row of rows as unknown as EntityRow[]) {
		const paths = parseFilePaths(row.file_paths);
		for (const fp of paths) {
			if (!fp.startsWith(`${folderPath}/`)) continue;

			// Check if it's a direct child (no more "/" after the folder prefix)
			const remainder = fp.slice(folderPath.length + 1); // e.g. "indexer.ts" or "sub/indexer.ts"
			if (remainder.includes("/")) {
				// sub-folder
				const subFolder = `${folderPath}/${remainder.split("/")[0]}`;
				subFolders.add(subFolder);
			} else {
				// direct file child
				if (!directFiles.has(fp)) {
					directFiles.set(fp, row as EntityRow);
				}
			}
		}
	}

	// Build file nodes for direct children
	const fileNodes: G6Node[] = [];
	for (const [filePath, row] of directFiles) {
		fileNodes.push({
			id: `file:${filePath}`,
			label: filePath.split("/").pop() ?? filePath,
			parentId: comboId,
			nodeType: "file",
			filePath,
			importance: row.importance ?? 0.5,
			trustTier: row.trust_tier ?? 3,
			color: folderColor(folderPath),
			entityId: row.id,
		});
	}

	// Build sub-folder combos
	const subCombos: G6Combo[] = Array.from(subFolders).map((sf) => ({
		id: `combo:${sf}`,
		label: sf.split("/").pop() ?? sf,
		parentId: comboId,
		childCount: 0,
		folderPath: sf,
		color: folderColor(sf),
	}));

	return {
		nodes: fileNodes,
		edges: [],
		combos: subCombos,
	};
}

/**
 * Get the function/class/interface entities within a specific file.
 * Returns entity-level nodes (not file nodes).
 */
export async function getFileEntities(db: SiaDb, filePath: string): Promise<EntitiesResponse> {
	const { rows } = await db.execute(
		`SELECT id, type, name, summary, importance, trust_tier, file_paths
		 FROM graph_nodes
		 WHERE t_valid_until IS NULL AND archived_at IS NULL
		   AND type = 'CodeEntity'
		   AND file_paths LIKE ?`,
		[`%${filePath}%`],
	);

	type EntityRow = {
		id: string;
		type: string;
		name: string;
		summary: string;
		importance: number;
		trust_tier: number;
		file_paths: string;
	};

	const nodes: G6Node[] = [];
	for (const row of rows as unknown as EntityRow[]) {
		const paths = parseFilePaths(row.file_paths);
		if (!paths.includes(filePath)) continue;

		const nodeType = deriveNodeType(row.type, row.summary);
		// Only include meaningful types
		if (nodeType === "file") continue;

		nodes.push({
			id: `entity:${row.id}`,
			label: row.name,
			parentId: `file:${filePath}`,
			nodeType,
			filePath,
			importance: row.importance ?? 0.5,
			trustTier: row.trust_tier ?? 3,
			color: folderColor(parentFolder(filePath) || filePath),
			entityId: row.id,
		});
	}

	// Get edges between these entities
	const entityIds = nodes.map((n) => n.entityId);
	const edges: G6Edge[] = [];

	if (entityIds.length > 1) {
		const list = inClause(entityIds);
		const { rows: edgeRows } = await db.execute(
			`SELECT id, from_id, to_id, type, weight
			 FROM graph_edges
			 WHERE from_id IN (${list}) AND to_id IN (${list})
			   AND t_valid_until IS NULL`,
		);
		for (const e of edgeRows as unknown as {
			id: string;
			from_id: string;
			to_id: string;
			type: string;
			weight: number;
		}[]) {
			edges.push({
				id: `entity-edge:${e.id}`,
				source: `entity:${e.from_id}`,
				target: `entity:${e.to_id}`,
				edgeType: e.type as G6Edge["edgeType"],
				weight: e.weight ?? 1.0,
			});
		}
	}

	return { nodes, edges };
}

/**
 * Search for nodes by name substring.
 * Returns matches with combo ancestry for navigation.
 */
export async function searchNodes(
	db: SiaDb,
	query: string,
	limit = 20,
): Promise<SearchResult[]> {
	const { rows } = await db.execute(
		`SELECT id, type, name, summary, file_paths
		 FROM graph_nodes
		 WHERE t_valid_until IS NULL AND archived_at IS NULL
		   AND name LIKE ?
		 LIMIT ?`,
		[`%${query}%`, limit],
	);

	type EntityRow = {
		id: string;
		type: string;
		name: string;
		summary: string;
		file_paths: string;
	};

	const results: SearchResult[] = [];

	for (const row of rows as unknown as EntityRow[]) {
		const paths = parseFilePaths(row.file_paths);
		const isKnowledge = KNOWLEDGE_TYPES.has(row.type);

		if (isKnowledge) {
			results.push({
				id: `knowledge:${row.id}`,
				name: row.name,
				type: row.type.toLowerCase(),
				path: "",
				comboAncestry: [],
			});
			continue;
		}

		// For code entities, produce one result per file path
		const primaryPath = paths[0] ?? "";
		const comboAncestry: string[] = [];

		// Build combo ancestry from the file path
		if (primaryPath) {
			const parts = primaryPath.split("/");
			for (let i = 1; i < parts.length; i++) {
				comboAncestry.push(`combo:${parts.slice(0, i).join("/")}`);
			}
		}

		results.push({
			id: `entity:${row.id}`,
			name: row.name,
			type: row.type.toLowerCase(),
			path: primaryPath,
			comboAncestry,
		});
	}

	return results;
}
