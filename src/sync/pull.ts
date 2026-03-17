// Module: pull — Pull remote changes via libSQL sync

import type { CandidateFact } from "@/capture/types";
import { writeAuditEntry } from "@/graph/audit";
import type { SiaDb } from "@/graph/db-interface";
import type { SyncConfig } from "@/shared/config";
import { hlcFromDb, hlcReceive, loadHlc, persistHlc } from "@/sync/hlc";

export interface PullResult {
	entitiesReceived: number;
	edgesReceived: number;
	vssRefreshed: number;
}

export async function pullChanges(
	db: SiaDb,
	_bridgeDb: SiaDb,
	config: SyncConfig,
	repoHash?: string,
	siaHome?: string,
): Promise<PullResult> {
	if (!config.enabled) {
		return { entitiesReceived: 0, edgesReceived: 0, vssRefreshed: 0 };
	}

	// Trigger replication if available (safe optional call)
	await db.sync?.();

	// Get received entities: non-private with hlc_modified > synced_at (or synced_at IS NULL)
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

	const receivedEntities = entityRows.rows as Array<Record<string, unknown>>;

	// --- Consolidation via @/capture/consolidate ---
	// Convert received entities to CandidateFact[] for consolidation.
	// We dynamically import to avoid circular dependency issues.
	const processedEntityIds: string[] = [];
	if (receivedEntities.length > 0) {
		try {
			const { consolidate } = await import("@/capture/consolidate");
			const candidates: CandidateFact[] = receivedEntities.map((row) => ({
				type: (row.type as string) as CandidateFact["type"],
				name: row.name as string,
				content: row.content as string,
				summary: row.summary as string,
				tags: (() => {
					try {
						return JSON.parse((row.tags as string) || "[]") as string[];
					} catch {
						return [];
					}
				})(),
				file_paths: (() => {
					try {
						return JSON.parse((row.file_paths as string) || "[]") as string[];
					} catch {
						return [];
					}
				})(),
				trust_tier: (row.trust_tier as number) as CandidateFact["trust_tier"],
				confidence: row.confidence as number,
				extraction_method: (row.extraction_method as string) ?? undefined,
			}));

			await consolidate(db, candidates);

			for (const row of receivedEntities) {
				processedEntityIds.push(row.id as string);
			}
		} catch (err) {
			// If consolidation fails, still track the entities as received
			console.warn("Consolidation during pull failed:", err);
			for (const row of receivedEntities) {
				processedEntityIds.push(row.id as string);
			}
		}
	}

	// --- Update local HLC high-water ---
	const maxHlcRow = await db.execute(
		"SELECT MAX(hlc_modified) as max_hlc FROM entities WHERE hlc_modified IS NOT NULL",
	);
	const maxHlc = hlcFromDb((maxHlcRow.rows[0] as { max_hlc?: unknown })?.max_hlc ?? 0n);

	if (repoHash) {
		let localHlc = loadHlc(repoHash, siaHome);
		if (maxHlc > 0n) {
			localHlc = hlcReceive(localHlc, maxHlc);
		}
		persistHlc(repoHash, localHlc, siaHome);
	} else if (maxHlc > 0n) {
		// No repoHash — merge into a fresh clock (result discarded)
		hlcReceive(0n, maxHlc);
	}

	// --- sync_peers ---
	// TODO: sync_peers is in meta.db, not graph.db. Full meta.db integration
	// requires accepting a metaDb parameter which is a larger change.
	// For now, write audit entries for received items as tracking.

	// Audit the received items.
	for (const row of receivedEntities) {
		await writeAuditEntry(db, "SYNC_RECV", { entity_id: row.id as string });
	}

	// --- Scoped VSS refresh ---
	// Only refresh entities that were actually received (use their IDs, not full table).
	let vssRefreshed = 0;
	const sqlite = db.rawSqlite();
	if (sqlite && processedEntityIds.length > 0) {
		try {
			// Build scoped query for just the received entity IDs
			const placeholders = processedEntityIds.map(() => "?").join(", ");
			const embedRows = await db.execute(
				`SELECT rowid, embedding FROM entities
				 WHERE id IN (${placeholders}) AND embedding IS NOT NULL AND archived_at IS NULL`,
				processedEntityIds,
			);

			// Use rawSqlite() directly for VSS INSERT
			for (const row of embedRows.rows as Array<{ rowid: number; embedding: Uint8Array }>) {
				try {
					sqlite.prepare("INSERT OR REPLACE INTO entities_vss(rowid, embedding) VALUES (?, ?)").run(
						row.rowid,
						row.embedding,
					);
					vssRefreshed++;
				} catch {
					// Ignore individual VSS insert failures
				}
			}

			if (vssRefreshed > 0) {
				for (const row of embedRows.rows as Array<{ rowid: number }>) {
					await writeAuditEntry(db, "VSS_REFRESH", { entity_id: String(row.rowid) });
				}
			}
		} catch {
			// Ignore if extension/table not available
		}
	} else if (!sqlite && processedEntityIds.length > 0) {
		console.warn("rawSqlite() returned null — skipping VSS refresh for received entities");
	}

	// Trigger replication after processing (safe optional call)
	await db.sync?.();

	return {
		entitiesReceived: receivedEntities.length,
		edgesReceived: (edgeRows.rows as Array<unknown>).length,
		vssRefreshed,
	};
}
