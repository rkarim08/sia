// Module: subgraph-extract — Extract relevant subgraph for visualization

import type { SiaDb } from "@/graph/db-interface";

export interface VisNode {
	id: string;
	type: string;
	name: string;
	summary: string;
	importance: number;
	trustTier: number;
}

export interface VisEdge {
	id: string;
	from_id: string;
	to_id: string;
	type: string;
	weight: number;
	confidence?: number;
	extraction_method?: string;
}

export interface CommunityMembership {
	nodeId: string;
	communityId: string;
	communityLevel: number;
	communitySummary: string;
}

export interface SubgraphData {
	nodes: VisNode[];
	edges: VisEdge[];
	communities?: CommunityMembership[];
}

export interface ExtractOpts {
	scope?: string;
	nodeType?: string;
	maxNodes?: number;
}

/**
 * Build a safe SQL IN clause from an array of hex-UUID strings.
 * UUIDs contain only [0-9a-f-] so they are safe to inline without parameterisation,
 * which avoids SQLite's host-parameter limit (SQLITE_MAX_VARIABLE_NUMBER = 999).
 */
function inClause(ids: string[]): string {
	return ids.map((id) => `'${id}'`).join(",");
}

/** Map a raw entity row to a VisNode. */
function toVisNode(row: Record<string, unknown>): VisNode {
	return {
		id: row.id as string,
		type: row.type as string,
		name: row.name as string,
		summary: (row.summary as string) ?? "",
		importance: (row.importance as number) ?? 0.5,
		trustTier: (row.trust_tier as number) ?? 3,
	};
}

/** Map a raw edge row to a VisEdge. */
function toVisEdge(row: Record<string, unknown>): VisEdge {
	return {
		id: row.id as string,
		from_id: row.from_id as string,
		to_id: row.to_id as string,
		type: row.type as string,
		weight: (row.weight as number) ?? 1.0,
		confidence: row.confidence as number | undefined,
		extraction_method: row.extraction_method as string | undefined,
	};
}

/**
 * Fetch all active edges where both endpoints are in the given id set.
 */
async function edgesBetween(db: SiaDb, ids: string[]): Promise<VisEdge[]> {
	if (ids.length === 0) return [];
	const list = inClause(ids);
	const { rows } = await db.execute(
		`SELECT id, from_id, to_id, type, weight, confidence, extraction_method FROM graph_edges
		 WHERE from_id IN (${list}) AND to_id IN (${list})
		   AND t_valid_until IS NULL`,
	);
	return rows.map(toVisEdge);
}

/**
 * Get 1-hop neighbor entity IDs for a set of seed IDs (via active edges).
 */
async function neighborIds(db: SiaDb, seedIds: string[]): Promise<string[]> {
	if (seedIds.length === 0) return [];
	const list = inClause(seedIds);
	const { rows } = await db.execute(
		`SELECT DISTINCT from_id AS nid FROM graph_edges
		 WHERE to_id IN (${list}) AND t_valid_until IS NULL
		 UNION
		 SELECT DISTINCT to_id AS nid FROM graph_edges
		 WHERE from_id IN (${list}) AND t_valid_until IS NULL`,
	);
	return rows.map((r) => r.nid as string);
}

/**
 * Fetch entity rows by a list of IDs (active only).
 */
async function fetchEntitiesById(db: SiaDb, ids: string[]): Promise<VisNode[]> {
	if (ids.length === 0) return [];
	const list = inClause(ids);
	const { rows } = await db.execute(
		`SELECT id, type, name, summary, importance, trust_tier FROM graph_nodes
		 WHERE id IN (${list})
		   AND t_valid_until IS NULL AND archived_at IS NULL`,
	);
	return rows.map(toVisNode);
}

/**
 * Fetch community memberships for a set of node IDs.
 */
async function fetchCommunities(db: SiaDb, ids: string[]): Promise<CommunityMembership[]> {
	if (ids.length === 0) return [];
	const list = inClause(ids);
	try {
		const { rows } = await db.execute(
			`SELECT cm.entity_id AS nodeId, cm.community_id AS communityId,
			        c.level AS communityLevel, COALESCE(c.summary, '') AS communitySummary
			 FROM community_members cm
			 JOIN communities c ON cm.community_id = c.id
			 WHERE cm.entity_id IN (${list})`,
		);
		return rows.map((r) => ({
			nodeId: r.nodeId as string,
			communityId: r.communityId as string,
			communityLevel: r.communityLevel as number,
			communitySummary: r.communitySummary as string,
		}));
	} catch {
		// Community tables may not exist yet — return empty
		return [];
	}
}

/**
 * Default extraction: top N nodes by importance with edges between them.
 * When maxNodes is undefined, load ALL active nodes (no cap).
 */
async function extractDefault(db: SiaDb, maxNodes?: number): Promise<SubgraphData> {
	const limitClause = maxNodes != null ? " ORDER BY importance DESC LIMIT ?" : "";
	const params = maxNodes != null ? [maxNodes] : [];
	const { rows } = await db.execute(
		`SELECT id, type, name, summary, importance, trust_tier FROM graph_nodes
		 WHERE t_valid_until IS NULL AND archived_at IS NULL${limitClause}`,
		params,
	);
	const nodes = rows.map(toVisNode);
	const nodeIds = nodes.map((n) => n.id);
	const edges = await edgesBetween(db, nodeIds);
	const communities = await fetchCommunities(db, nodeIds);
	return { nodes, edges, communities };
}

/**
 * Scope extraction: FileNode/CodeEntity under path + 2-hop neighbors.
 */
async function extractScoped(db: SiaDb, scope: string, maxNodes?: number): Promise<SubgraphData> {
	// Find seed entities whose file_paths contain the scope prefix
	const { rows: seedRows } = await db.execute(
		`SELECT id, type, name, summary, importance, trust_tier FROM graph_nodes
		 WHERE (type = 'FileNode' OR type = 'CodeEntity')
		   AND file_paths LIKE ?
		   AND t_valid_until IS NULL AND archived_at IS NULL`,
		[`%${scope}%`],
	);
	const seedNodes = seedRows.map(toVisNode);
	const seedIds = seedNodes.map((n) => n.id);

	// 1-hop neighbors
	const hop1Ids = await neighborIds(db, seedIds);
	// 2-hop neighbors
	const hop2Ids = await neighborIds(db, hop1Ids);

	// Combine all unique IDs, prioritising seeds
	const allIds = new Set<string>([...seedIds, ...hop1Ids, ...hop2Ids]);

	// Fetch entities for non-seed IDs
	const extraIds = [...allIds].filter((id) => !seedIds.includes(id));
	const extraNodes = await fetchEntitiesById(db, extraIds);

	// Merge and optionally cap
	const allNodes = maxNodes != null
		? [...seedNodes, ...extraNodes].slice(0, maxNodes)
		: [...seedNodes, ...extraNodes];
	const cappedIds = allNodes.map((n) => n.id);
	const edges = await edgesBetween(db, cappedIds);
	const communities = await fetchCommunities(db, cappedIds);

	return { nodes: allNodes, edges, communities };
}

/**
 * NodeType extraction: all nodes of that type + direct (1-hop) neighbors.
 */
async function extractByType(db: SiaDb, nodeType: string, maxNodes?: number): Promise<SubgraphData> {
	const { rows: typeRows } = await db.execute(
		`SELECT id, type, name, summary, importance, trust_tier FROM graph_nodes
		 WHERE type = ?
		   AND t_valid_until IS NULL AND archived_at IS NULL`,
		[nodeType],
	);
	const typeNodes = typeRows.map(toVisNode);
	const typeIds = typeNodes.map((n) => n.id);

	// 1-hop neighbors
	const hop1Ids = await neighborIds(db, typeIds);
	const extraIds = hop1Ids.filter((id) => !typeIds.includes(id));
	const extraNodes = await fetchEntitiesById(db, extraIds);

	// Merge and optionally cap
	const allNodes = maxNodes != null
		? [...typeNodes, ...extraNodes].slice(0, maxNodes)
		: [...typeNodes, ...extraNodes];
	const cappedIds = allNodes.map((n) => n.id);
	const edges = await edgesBetween(db, cappedIds);
	const communities = await fetchCommunities(db, cappedIds);

	return { nodes: allNodes, edges, communities };
}

/**
 * Extract a relevant subgraph for visualization.
 *
 * Three modes:
 * - Default (no scope/type): all active nodes (or top N if maxNodes set) + edges between them
 * - With scope: FileNode/CodeEntity under path + 2-hop neighbors, optionally capped at maxNodes
 * - With nodeType: all nodes of that type + direct neighbors, optionally capped at maxNodes
 */
export async function extractSubgraph(db: SiaDb, opts?: ExtractOpts): Promise<SubgraphData> {
	const maxNodes = opts?.maxNodes;

	if (opts?.scope) {
		return extractScoped(db, opts.scope, maxNodes);
	}

	if (opts?.nodeType) {
		return extractByType(db, opts.nodeType, maxNodes);
	}

	return extractDefault(db, maxNodes);
}
