// Module: push — Push local changes to remote via libSQL sync

import { writeAuditEntry } from "@/graph/audit";
import type { SiaDb } from "@/graph/db-interface";
import type { SyncConfig } from "@/shared/config";
import { hlcNow, loadHlc, persistHlc } from "@/sync/hlc";

export interface PushResult {
	entitiesPushed: number;
	edgesPushed: number;
	bridgeEdgesPushed: number;
}

export async function pushChanges(
	db: SiaDb,
	config: SyncConfig,
	bridgeDb?: SiaDb,
	repoHash?: string,
	siaHome?: string,
): Promise<PushResult> {
	if (!config.enabled) {
		return { entitiesPushed: 0, edgesPushed: 0, bridgeEdgesPushed: 0 };
	}

	// Determine the timestamp for synced_at — use HLC if repoHash is provided, else Date.now()
	let syncedAt: number;
	let hlc: bigint | undefined;
	if (repoHash) {
		hlc = loadHlc(repoHash, siaHome);
		hlc = hlcNow(hlc);
		syncedAt = Number(hlc >> 16n); // wall-clock ms from HLC
	} else {
		syncedAt = Date.now();
	}

	// --- Push entities ---
	const candidates = await db.execute(
		`SELECT id FROM graph_nodes
		 WHERE visibility != 'private'
		   AND (synced_at IS NULL OR (hlc_modified IS NOT NULL AND synced_at < hlc_modified))`,
	);

	const entityIds = (candidates.rows as Array<{ id: string }>).map((r) => r.id);
	const entityIdSet = new Set(entityIds);

	if (entityIds.length > 0) {
		// Batch update synced_at in chunks of 500
		for (let i = 0; i < entityIds.length; i += 500) {
			const chunk = entityIds.slice(i, i + 500);
			const placeholders = chunk.map(() => "?").join(", ");
			await db.execute(`UPDATE graph_nodes SET synced_at = ? WHERE id IN (${placeholders})`, [
				syncedAt,
				...chunk,
			]);
		}
		for (const id of entityIds) {
			await writeAuditEntry(db, "SYNC_SEND", { entity_id: id });
		}
	}

	// --- Push edges ---
	// Query edges where both from_id AND to_id are in pushed entity IDs set
	let edgesPushed = 0;
	if (entityIdSet.size > 0) {
		const allEdges = await db.execute(
			`SELECT id, from_id, to_id FROM graph_edges
			 WHERE t_valid_until IS NULL`,
		);

		const eligibleEdgeIds: string[] = [];
		for (const row of allEdges.rows as Array<{ id: string; from_id: string; to_id: string }>) {
			if (entityIdSet.has(row.from_id) && entityIdSet.has(row.to_id)) {
				eligibleEdgeIds.push(row.id);
			}
		}

		// Batch update hlc_modified on edges in chunks of 500
		for (let i = 0; i < eligibleEdgeIds.length; i += 500) {
			const chunk = eligibleEdgeIds.slice(i, i + 500);
			const placeholders = chunk.map(() => "?").join(", ");
			await db.execute(`UPDATE graph_edges SET hlc_modified = ? WHERE id IN (${placeholders})`, [
				syncedAt,
				...chunk,
			]);
		}
		for (const id of eligibleEdgeIds) {
			await writeAuditEntry(db, "SYNC_SEND", { edge_id: id });
		}
		edgesPushed = eligibleEdgeIds.length;
	}

	// --- Push bridge edges ---
	let bridgeEdgesPushed = 0;
	if (bridgeDb && entityIdSet.size > 0) {
		const bridgeEdges = await bridgeDb.execute(
			`SELECT id, source_entity_id, target_entity_id FROM cross_repo_edges
			 WHERE t_valid_until IS NULL`,
		);

		const eligibleBridgeIds: string[] = [];
		for (const row of bridgeEdges.rows as Array<{
			id: string;
			source_entity_id: string;
			target_entity_id: string;
		}>) {
			if (entityIdSet.has(row.source_entity_id) && entityIdSet.has(row.target_entity_id)) {
				eligibleBridgeIds.push(row.id);
			}
		}

		for (let i = 0; i < eligibleBridgeIds.length; i += 500) {
			const chunk = eligibleBridgeIds.slice(i, i + 500);
			const placeholders = chunk.map(() => "?").join(", ");
			await bridgeDb.execute(
				`UPDATE cross_repo_edges SET hlc_modified = ? WHERE id IN (${placeholders})`,
				[syncedAt, ...chunk],
			);
		}
		bridgeEdgesPushed = eligibleBridgeIds.length;
	}

	// Persist updated HLC after push
	if (repoHash && hlc !== undefined) {
		persistHlc(repoHash, hlc, siaHome);
	}

	// Trigger replication if available (safe optional call)
	await db.sync?.();

	return { entitiesPushed: entityIds.length, edgesPushed, bridgeEdgesPushed };
}
