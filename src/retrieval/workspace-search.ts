// Module: workspace-search — Workspace-scoped search via ATTACH

import type { SiaDb } from "@/graph/db-interface";
import type { SiaSearchResult } from "@/mcp/tools/sia-search";
import { SIA_HOME } from "@/shared/config";
import { getPeerRepos } from "@/workspace/cross-repo";

/** Options for workspaceSearch. */
export interface WorkspaceSearchOpts {
	primaryDb: SiaDb;
	metaDb: SiaDb;
	bridgeDb: SiaDb;
	workspaceId: string;
	primaryRepoId: string;
	query: string;
	siaHome?: string;
	limit?: number;
	paranoid?: boolean;
	node_types?: string[];
	package_path?: string;
}

/** Result of a workspace search. */
export interface WorkspaceSearchResult {
	entities: SiaSearchResult[];
	missingRepos: string[];
}

/** Max peer repos to ATTACH (SQLite limit of 10 - main - bridge = 8) */
const MAX_PEERS = 8;

/**
 * Perform workspace-scoped search across primary + peer repo databases.
 *
 * ATTACHes one peer at a time (ATTACH, query, DETACH, next) to stay safely
 * within SQLite limits and simplify error handling. Results are merged and
 * re-sorted after all peers are queried.
 *
 * Missing peers produce metadata entries, not errors.
 * Does NOT set WAL pragma on attached read-only databases.
 */
export async function workspaceSearch(opts: WorkspaceSearchOpts): Promise<WorkspaceSearchResult> {
	const siaHome = opts.siaHome ?? SIA_HOME;
	const limit = opts.limit ?? 15;
	const missingRepos: string[] = [];

	// Get peers from meta.db
	const allPeers = await getPeerRepos(opts.metaDb, opts.workspaceId, opts.primaryRepoId, siaHome);

	// Cap at MAX_PEERS
	const peers = allPeers.slice(0, MAX_PEERS);
	if (allPeers.length > MAX_PEERS) {
		for (let i = MAX_PEERS; i < allPeers.length; i++) {
			missingRepos.push(allPeers[i].name ?? allPeers[i].repoId);
		}
	}

	// Build WHERE clause
	const clauses: string[] = ["t_valid_until IS NULL", "archived_at IS NULL"];
	if (opts.paranoid) clauses.push("trust_tier != 4");
	if (opts.node_types && opts.node_types.length > 0) {
		const placeholders = opts.node_types.map(() => "?").join(", ");
		clauses.push(`type IN (${placeholders})`);
	}
	if (opts.package_path) {
		clauses.push("package_path = ?");
	}
	const whereClause = clauses.join(" AND ");

	// Build params for WHERE clause (without limit)
	const filterParams: unknown[] = [];
	if (opts.node_types) filterParams.push(...opts.node_types);
	if (opts.package_path) filterParams.push(opts.package_path);

	// Query primary
	const allEntities: SiaSearchResult[] = [];
	const primarySql = `SELECT * FROM entities WHERE ${whereClause} ORDER BY importance DESC LIMIT ?`;
	const primaryResult = await opts.primaryDb.execute(primarySql, [...filterParams, limit]);

	for (const row of primaryResult.rows) {
		allEntities.push(mapRow(row, null));
	}

	// Query each peer via ATTACH
	for (const peer of peers) {
		try {
			await opts.primaryDb.execute("ATTACH DATABASE ? AS peer_db", [peer.graphDbPath]);

			const peerSql = `SELECT * FROM peer_db.entities WHERE ${whereClause} ORDER BY importance DESC LIMIT ?`;
			const peerResult = await opts.primaryDb.execute(peerSql, [...filterParams, limit]);

			for (const row of peerResult.rows) {
				allEntities.push(mapRow(row, peer.name));
			}

			await opts.primaryDb.execute("DETACH DATABASE peer_db", []);
		} catch {
			missingRepos.push(peer.name ?? peer.repoId);
			try {
				await opts.primaryDb.execute("DETACH DATABASE peer_db", []);
			} catch {
				/* already detached or never attached */
			}
		}
	}

	// Sort all by importance DESC, take top `limit`
	allEntities.sort((a, b) => b.importance - a.importance);
	const capped = allEntities.slice(0, limit);

	return { entities: capped, missingRepos };
}

function mapRow(row: Record<string, unknown>, sourceRepoName: string | null): SiaSearchResult {
	return {
		id: row.id as string,
		type: row.type as string,
		name: row.name as string,
		summary: (row.summary as string) ?? "",
		content: (row.content as string) ?? "",
		trust_tier: row.trust_tier as number,
		confidence: row.confidence as number,
		importance: row.importance as number,
		tags: (row.tags as string) ?? "[]",
		file_paths: (row.file_paths as string) ?? "[]",
		conflict_group_id: (row.conflict_group_id as string | null) ?? null,
		t_valid_from: (row.t_valid_from as number | null) ?? null,
		source_repo_name: sourceRepoName,
	};
}
