// Module: push — Push local changes to remote via libSQL sync

import { writeAuditEntry } from "@/graph/audit";
import type { SiaDb } from "@/graph/db-interface";
import type { SyncConfig } from "@/shared/config";

export interface PushResult {
        entitiesPushed: number;
        edgesPushed: number;
}

export async function pushChanges(db: SiaDb, config: SyncConfig): Promise<PushResult> {
        if (!config.enabled) {
                return { entitiesPushed: 0, edgesPushed: 0 };
        }

        const candidates = await db.execute(
                `SELECT id FROM entities
                 WHERE visibility != 'private'
                   AND (synced_at IS NULL OR (hlc_modified IS NOT NULL AND synced_at < hlc_modified))`,
        );

        const entityIds = (candidates.rows as Array<{ id: string }>).map((r) => r.id);
        const now = Date.now();

        if (entityIds.length > 0) {
                const placeholders = entityIds.map(() => "?").join(", ");
                await db.execute(`UPDATE entities SET synced_at = ? WHERE id IN (${placeholders})`, [now, ...entityIds]);
                for (const id of entityIds) {
                        await writeAuditEntry(db, "SYNC_SEND", { entity_id: id });
                }
        }

        // If the underlying adapter exposes sync(), trigger it (LibSqlDb implements this).
        if (typeof (db as { sync?: () => Promise<void> }).sync === "function") {
                await (db as { sync: () => Promise<void> }).sync();
        }

        return { entitiesPushed: entityIds.length, edgesPushed: 0 };
}
