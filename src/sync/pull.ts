// Module: pull — Pull remote changes via libSQL sync

import { writeAuditEntry } from "@/graph/audit";
import type { SiaDb } from "@/graph/db-interface";
import type { SyncConfig } from "@/shared/config";
import { hlcFromDb, hlcReceive } from "@/sync/hlc";

export interface PullResult {
	entitiesReceived: number;
	edgesReceived: number;
	vssRefreshed: number;
}

export async function pullChanges(
	db: SiaDb,
	_bridgeDb: SiaDb,
	config: SyncConfig,
): Promise<PullResult> {
	if (!config.enabled) {
		return { entitiesReceived: 0, edgesReceived: 0, vssRefreshed: 0 };
	}

	// Trigger replication if available.
	if (typeof (db as { sync?: () => Promise<void> }).sync === "function") {
		await (db as { sync: () => Promise<void> }).sync();
	}

	const entityRows = await db.execute(
		`SELECT * FROM entities
                 WHERE visibility != 'private'
                   AND hlc_modified IS NOT NULL
                   AND (synced_at IS NULL OR synced_at < hlc_modified)`,
	);
	const edgeRows = await db.execute(
		`SELECT id FROM edges
                 WHERE hlc_modified IS NOT NULL
                   AND (t_valid_until IS NULL)`,
	);

	// Update local HLC high-water based on the largest remote hlc_modified.
	const maxHlcRow = await db.execute(
		"SELECT MAX(hlc_modified) as max_hlc FROM entities WHERE hlc_modified IS NOT NULL",
	);
	const maxHlc = hlcFromDb((maxHlcRow.rows[0] as { max_hlc?: unknown })?.max_hlc ?? 0n);
	const localHlc = { wallMs: Date.now(), counter: 0, nodeId: config.developerId ?? "local" };
	if (maxHlc > 0n) {
		hlcReceive(localHlc, maxHlc);
	}

	// Audit the received items.
	for (const row of entityRows.rows as Array<{ id: string }>) {
		await writeAuditEntry(db, "SYNC_RECV", { entity_id: row.id });
	}

	// Post-sync VSS refresh when running on raw sqlite (libSQL client may not expose extension)
	let vssRefreshed = 0;
	const sqlite = db.rawSqlite();
	if (sqlite) {
		try {
			const embedRows = await db.execute(
				"SELECT rowid, embedding FROM entities WHERE embedding IS NOT NULL AND archived_at IS NULL",
			);
			for (const row of embedRows.rows as Array<{ rowid: number; embedding: Uint8Array }>) {
				await db.execute("INSERT OR REPLACE INTO entities_vss(rowid, embedding) VALUES (?, ?)", [
					row.rowid,
					row.embedding,
				]);
				vssRefreshed++;
			}
			if (vssRefreshed > 0) {
				for (const row of embedRows.rows as Array<{ rowid: number }>) {
					await writeAuditEntry(db, "VSS_REFRESH", { entity_id: String(row.rowid) });
				}
			}
		} catch {
			// Ignore if extension/table not available
		}
	}

	return {
		entitiesReceived: (entityRows.rows as Array<unknown>).length,
		edgesReceived: (edgeRows.rows as Array<unknown>).length,
		vssRefreshed,
	};
}
