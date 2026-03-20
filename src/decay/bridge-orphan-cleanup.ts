// Module: bridge-orphan-cleanup — invalidate cross-repo edges where source/target no longer active

import type { BatchResult } from "@/decay/types";
import type { SiaDb } from "@/graph/db-interface";

/**
 * Validate that a string is safe to use as a SQLite ATTACH alias.
 * Only allows alphanumeric characters and underscores (no injection vectors).
 */
function isSafeAlias(s: string): boolean {
	return /^[a-zA-Z0-9_]+$/.test(s);
}

/**
 * Derive a safe ATTACH alias from a repo id (UUID or hash).
 * Strips hyphens and takes the first 16 alphanumeric chars with a prefix.
 */
function repoAlias(repoId: string): string {
	const safe = repoId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 16);
	return `peer_${safe}`;
}

/**
 * Check whether an entity is "live" in a peer graph.db using ATTACH.
 *
 * Live = exists in entities table, archived_at IS NULL, t_valid_until IS NULL.
 *
 * Returns true if the entity is live, false if it's gone or the repo path isn't known.
 */
function checkEntityLivenessViaAttach(
	rawSqlite: {
		prepare: (sql: string) => {
			get: (...args: unknown[]) => unknown;
			run: (...args: unknown[]) => void;
		};
		exec?: (sql: string) => void;
	},
	graphDbPath: string,
	entityId: string,
	alias: string,
): boolean {
	if (!isSafeAlias(alias)) {
		return true; // be conservative — don't invalidate if alias is unsafe
	}

	try {
		// ATTACH database names cannot be parameterized in SQLite — use the validated alias
		rawSqlite.prepare(`ATTACH DATABASE ? AS ${alias}`).run(graphDbPath);

		const row = rawSqlite
			.prepare(
				`SELECT 1 FROM ${alias}.graph_nodes
				 WHERE id = ?
				   AND archived_at IS NULL
				   AND t_valid_until IS NULL`,
			)
			.get(entityId);

		rawSqlite.prepare(`DETACH DATABASE ${alias}`).run();

		return row !== undefined && row !== null;
	} catch {
		// If ATTACH fails (e.g., file doesn't exist), try to DETACH and be conservative
		try {
			rawSqlite.prepare(`DETACH DATABASE ${alias}`).run();
		} catch {
			// ignore DETACH error
		}
		return true; // be conservative — don't invalidate if we can't verify
	}
}

/**
 * Find and invalidate orphaned cross-repo edges in bridge.db.
 *
 * An edge is orphaned when its source or target entity is no longer active
 * in the respective repo's graph.db. We ATTACH each peer's graph.db to
 * check entity liveness, then invalidate dead edges.
 *
 * When `metaDb` is provided AND `bridgeDb.rawSqlite()` returns a handle,
 * this function uses SQLite's ATTACH to check entity liveness in each peer
 * repo's graph.db. The graph.db path is derived from the repo's `path` column
 * in metaDb's repos table (the path IS the graph.db file path as registered).
 *
 * Falls back to the simplified null-endpoint check when ATTACH isn't available
 * (e.g., LibSqlDb where rawSqlite() returns null).
 */
export async function bridgeOrphanBatch(
	bridgeDb: SiaDb,
	batchSize: number,
	metaDb?: SiaDb,
): Promise<BatchResult> {
	// Get active cross-repo edges that might be orphaned
	const { rows } = await bridgeDb.execute(
		`SELECT id, source_repo_id, source_entity_id, target_repo_id, target_entity_id
		 FROM cross_repo_edges
		 WHERE t_valid_until IS NULL
		 LIMIT ?`,
		[batchSize],
	);

	if (rows.length === 0) {
		return { processed: 0, remaining: false };
	}

	let processed = 0;
	const now = Date.now();

	// Determine if we can use ATTACH-based verification
	const rawSqlite = bridgeDb.rawSqlite();
	const canUseAttach = rawSqlite !== null && metaDb !== undefined;

	// Cache repo paths looked up from metaDb to avoid repeated queries
	const repoPathCache = new Map<string, string | null>();

	async function getRepoPath(repoId: string): Promise<string | null> {
		if (repoPathCache.has(repoId)) {
			return repoPathCache.get(repoId) ?? null;
		}
		const result = await metaDb?.execute("SELECT path FROM repos WHERE id = ?", [repoId]);
		const path = (result?.rows[0]?.path as string) ?? null;
		repoPathCache.set(repoId, path);
		return path;
	}

	for (const row of rows) {
		const edgeId = row.id as string;
		const sourceId = row.source_entity_id as string;
		const targetId = row.target_entity_id as string;
		const sourceRepoId = row.source_repo_id as string;
		const targetRepoId = row.target_repo_id as string;

		// Check if source/target are null or empty — these are definitely orphaned
		if (!sourceId || !targetId) {
			await bridgeDb.execute(
				"UPDATE cross_repo_edges SET t_valid_until = ?, t_expired = ? WHERE id = ?",
				[now, now, edgeId],
			);
			processed++;
			continue;
		}

		if (canUseAttach) {
			// ATTACH-based liveness verification
			const sourceRepoPath = await getRepoPath(sourceRepoId);
			const targetRepoPath = await getRepoPath(targetRepoId);

			let isOrphan = false;

			if (sourceRepoPath) {
				const sourceAlias = repoAlias(sourceRepoId);
				const sourceLive = checkEntityLivenessViaAttach(
					rawSqlite as Parameters<typeof checkEntityLivenessViaAttach>[0],
					sourceRepoPath,
					sourceId,
					sourceAlias,
				);
				if (!sourceLive) {
					isOrphan = true;
				}
			}

			if (!isOrphan && targetRepoPath) {
				const targetAlias = repoAlias(targetRepoId);
				// If source and target are in the same repo, generate a distinct alias
				const sourceAlias = repoAlias(sourceRepoId);
				const targetAliasResolved = targetAlias === sourceAlias ? `${targetAlias}t` : targetAlias;

				const targetLive = checkEntityLivenessViaAttach(
					rawSqlite as Parameters<typeof checkEntityLivenessViaAttach>[0],
					targetRepoPath,
					targetId,
					targetAliasResolved,
				);
				if (!targetLive) {
					isOrphan = true;
				}
			}

			if (isOrphan) {
				await bridgeDb.execute(
					"UPDATE cross_repo_edges SET t_valid_until = ?, t_expired = ? WHERE id = ?",
					[now, now, edgeId],
				);
			}
		}

		// Mark as processed
		processed++;
	}

	return { processed, remaining: processed === batchSize };
}

/**
 * Full cleanup pass: invalidate all orphaned cross-repo edges.
 * Processes in batches of 50.
 *
 * Optionally accepts a `metaDb` to enable ATTACH-based entity liveness
 * verification against peer graph.db files.
 */
export async function cleanupBridgeOrphans(bridgeDb: SiaDb, metaDb?: SiaDb): Promise<number> {
	let total = 0;

	for (;;) {
		const { processed, remaining } = await bridgeOrphanBatch(bridgeDb, 50, metaDb);
		total += processed;
		if (!remaining) break;
	}

	return total;
}
