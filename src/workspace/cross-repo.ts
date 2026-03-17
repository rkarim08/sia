// Module: cross-repo — ATTACH/DETACH helpers and peer repo discovery

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { SiaDb } from "@/graph/db-interface";
import { getWorkspaceRepos } from "@/graph/meta-db";
import { SIA_HOME } from "@/shared/config";

/** Info about a peer repo that can be ATTACHed for workspace search. */
export interface PeerRepo {
	repoId: string;
	graphDbPath: string;
	name: string | null;
}

/**
 * Attach a peer repository database under the given alias.
 *
 * Uses a plain ATTACH DATABASE statement. Does NOT set WAL pragma on the
 * attached connection — the caller opens it read-only.
 */
export async function attachPeerRepo(
	db: SiaDb,
	peerDbPath: string,
	alias: string,
): Promise<void> {
	await db.execute(`ATTACH DATABASE ? AS ${alias}`, [peerDbPath]);
}

/**
 * Detach a previously attached peer database.
 */
export async function detachPeerRepo(db: SiaDb, alias: string): Promise<void> {
	await db.execute(`DETACH DATABASE ${alias}`, []);
}

/**
 * Get peer repos for workspace search (all workspace repos except primaryRepoId).
 * Only returns peers whose graph.db file exists on disk.
 */
export async function getPeerRepos(
	metaDb: SiaDb,
	workspaceId: string,
	primaryRepoId: string,
	siaHome: string = SIA_HOME,
): Promise<PeerRepo[]> {
	const allRepos = await getWorkspaceRepos(metaDb, workspaceId);
	const peers: PeerRepo[] = [];

	for (const repo of allRepos) {
		const repoId = repo.id as string;
		if (repoId === primaryRepoId) continue;

		const graphDbPath = join(siaHome, "repos", repoId, "graph.db");
		if (existsSync(graphDbPath)) {
			peers.push({
				repoId,
				graphDbPath,
				name: (repo.name as string | null) ?? (repo.path as string | null) ?? null,
			});
		}
	}

	return peers;
}
