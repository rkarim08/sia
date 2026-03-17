// Module: share — adjust entity visibility for sharing

import type { SiaDb } from "@/graph/db-interface";
import { updateEntity } from "@/graph/entities";
import { openMetaDb, resolveWorkspaceName } from "@/graph/meta-db";
import type { SyncConfig } from "@/shared/config";
import { pushChanges } from "@/sync/push";

export async function shareEntity(
	db: SiaDb,
	entityId: string,
	opts: { team?: boolean; project?: string | null; siaHome?: string; syncConfig?: SyncConfig } = {},
): Promise<void> {
	let workspaceScope: string | null = null;
	if (opts.project) {
		const metaDb = openMetaDb(opts.siaHome);
		try {
			const wsId = await resolveWorkspaceName(metaDb, opts.project);
			if (!wsId) throw new Error(`Workspace '${opts.project}' not found`);
			workspaceScope = wsId;
		} finally {
			await metaDb.close();
		}
	}

	const visibility = opts.team ? "team" : opts.project ? "project" : "private";
	await updateEntity(db, entityId, { visibility, workspace_scope: workspaceScope });

	// Trigger immediate push
	if (opts.syncConfig?.enabled) {
		await pushChanges(db, opts.syncConfig);
	}
}
