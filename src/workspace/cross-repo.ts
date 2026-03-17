// Module: cross-repo — ATTACH/DETACH helpers for workspace peer databases

import type { SiaDb } from "@/graph/db-interface";

/**
 * Attach a peer repository database under the given alias.
 *
 * Uses a plain ATTACH DATABASE statement. Does NOT set WAL pragma on the
 * attached connection — the caller opens it read-only.
 */
export async function attachPeerRepo(db: SiaDb, peerDbPath: string, alias: string): Promise<void> {
	await db.execute(`ATTACH DATABASE ? AS ${alias}`, [peerDbPath]);
}

/**
 * Detach a previously attached peer database.
 */
export async function detachPeerRepo(db: SiaDb, alias: string): Promise<void> {
	await db.execute(`DETACH DATABASE ${alias}`, []);
}
